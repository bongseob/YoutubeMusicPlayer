import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';

export function createPool(env = process.env) {
  return mysql.createPool({
    host: env.MYSQL_HOST || '127.0.0.1', port: Number(env.MYSQL_PORT || 3307),
    user: env.MYSQL_USER || 'karaoke', password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE || 'tj_karaoke', connectionLimit: 5,
    charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true,
  });
}

export async function initSchema(pool) {
  const connection = await pool.getConnection();
  try {
    const [[{ acquired }]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':catalog-schema'), 256), 30) AS acquired");
    if (Number(acquired) !== 1) throw new Error('DB 스키마 잠금을 기다리는 중입니다. 잠시 후 다시 시작하세요.');
    await connection.query(await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
    const [columns] = await connection.query('SHOW COLUMNS FROM karaoke_songs');
    if (!columns.some(column => column.Field === 'song_key')) {
      // Do not merge or delete ambiguous legacy rows during an upgrade.
      const [duplicates] = await connection.query("SELECT CAST(tj_number AS UNSIGNED) FROM karaoke_songs WHERE tj_number IS NOT NULL GROUP BY CAST(tj_number AS UNSIGNED) HAVING COUNT(*) > 1 LIMIT 1");
      if (duplicates.length) throw new Error('기존 DB에 같은 TJ 번호의 여러 영상이 있습니다. 번호 중복을 정리한 후 다시 시작하세요.');
      await connection.query(`ALTER TABLE karaoke_songs
        ADD COLUMN song_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
        ADD COLUMN brand VARCHAR(2) NOT NULL DEFAULT 'TJ',
        ADD COLUMN song_number VARCHAR(10) NULL,
        ADD COLUMN ky_number VARCHAR(10) NULL,
        MODIFY COLUMN youtube_video_id CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NULL,
        DROP INDEX uk_video,
        ADD INDEX idx_video (youtube_video_id),
        ADD INDEX idx_brand_number (brand, song_number)`);
    }
    // Also resumes safely if a previous startup stopped after the ALTER.
    await connection.query(`UPDATE karaoke_songs SET brand='TJ', song_number=tj_number,
      song_key=CASE WHEN tj_number IS NOT NULL AND tj_number <> ''
        THEN CONCAT('TJ:n:', CAST(tj_number AS UNSIGNED))
        ELSE CONCAT('TJ:v:', youtube_video_id) END WHERE song_key IS NULL`);
    const [indexes] = await connection.query('SHOW INDEX FROM karaoke_songs');
    if (!indexes.some(index => index.Key_name === 'uk_song_key')) {
      await connection.query('ALTER TABLE karaoke_songs MODIFY COLUMN song_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, ADD UNIQUE KEY uk_song_key (song_key)');
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':catalog-schema'), 256))").catch(() => {});
    connection.release();
  }
}

export function songRepository(pool) {
  return {
    async health() { await pool.query('SELECT 1'); },
    async list({ q, limit, offset }) {
      // Escape LIKE metacharacters with an explicit escape character.
      const term = `%${q.replace(/[!%_]/g, '!$&')}%`;
      const where = q ? "WHERE title LIKE ? ESCAPE '!' OR artist LIKE ? ESCAPE '!' OR song_number LIKE ? ESCAPE '!'" : '';
      const args = q ? [term, term, term] : [];
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM karaoke_songs ${where}`, args);
      const [songs] = await pool.query(`SELECT * FROM karaoke_songs ${where} ORDER BY title, id LIMIT ? OFFSET ?`, [...args, limit, offset]);
      return { songs, total: Number(total) };
    },
    async upsert(songs) {
      const connection = await pool.getConnection();
      let created = 0, updated = 0;
      try {
        await connection.beginTransaction();
        const ordered = [...songs].sort((a, b) => a.song_key.localeCompare(b.song_key));
        for (let offset = 0; offset < ordered.length; offset += 500) {
          const batch = ordered.slice(offset, offset + 500);
          const [existing] = await connection.query('SELECT song_key FROM karaoke_songs WHERE song_key IN (?) FOR UPDATE', [batch.map(song => song.song_key)]);
          updated += existing.length; created += batch.length - existing.length;
          await connection.query(
            `INSERT INTO karaoke_songs (song_key, brand, song_number, title, artist, tj_number, ky_number, youtube_video_id, source_url)
             VALUES ? AS new ON DUPLICATE KEY UPDATE title=new.title, artist=new.artist,
             song_number=new.song_number, tj_number=new.tj_number, ky_number=new.ky_number,
             youtube_video_id=COALESCE(new.youtube_video_id, karaoke_songs.youtube_video_id),
             source_url=IF(new.youtube_video_id IS NULL, karaoke_songs.source_url, new.source_url)`,
            [batch.map(song => [song.song_key, song.brand, song.song_number, song.title, song.artist, song.tj_number, song.ky_number, song.youtube_video_id, song.source_url])],
          );
        }
        await connection.commit();
        return { created, updated };
      } catch (err) { await connection.rollback(); throw err; }
      finally { connection.release(); }
    },
  };
}
