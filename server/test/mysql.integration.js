import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createPool, initSchema, songRepository } from '../src/db.js';
import { normalizeSong } from '../src/songs.js';
import { createApp } from '../src/app.js';
import { readFile } from 'node:fs/promises';

dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });
test('MySQL: Korean search, literal wildcard, case-sensitive IDs, upsert and transaction rollback', async () => {
  // Isolated database: never write test songs to the user's catalogue.
  const database = `tj_test_${Date.now()}`;
  const adminPool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD });
  let pool;
  try {
    await adminPool.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD, MYSQL_DATABASE: database });
    await initSchema(pool);
    const repo = songRepository(pool);
    const a = normalizeSong({ title: '한글%노래', artist: '가수', tj_number: '00123', youtube_url: 'Abc_def-123' });
    const b = normalizeSong({ title: '두 번째', artist: '가수', brand: 'KY', song_number: '00123' });
    assert.equal((await repo.upsert([a, b])).created, 2);
    assert.equal((await repo.list({ q: '가수', limit: 30, offset: 0 })).total, 2);
    assert.equal((await repo.list({ q: '%', limit: 30, offset: 0 })).total, 1);
    assert.equal((await repo.list({ q: '00123', limit: 30, offset: 0 })).total, 2);
    await repo.upsert([{ ...a, title: '갱신됨', youtube_video_id: null, source_url: '' }]);
    assert.equal((await repo.list({ q: '갱신', limit: 30, offset: 0 })).songs[0].youtube_video_id, a.youtube_video_id);
    const listed = (await repo.list({ q: '00123', limit: 30, offset: 0 })).songs;
    assert.equal(listed.find(song => song.brand === 'KY').tj_number, null);
    assert.equal(listed.find(song => song.brand === 'KY').ky_number, '00123');
    assert.equal((await repo.list({ q: '갱신', limit: 30, offset: 0 })).songs[0].title, '갱신됨');
    await assert.rejects(repo.upsert([{ ...a, song_key: 'TJ:n:999', song_number: '999', youtube_video_id: 'rollback123' }, { ...b, title: null }]));
    assert.equal((await repo.list({ q: '', limit: 30, offset: 0 })).total, 2);
    // Exercise the real HTTP parser, bulk transaction and complete generated CSV.
    const token = 'integration-admin-token-at-least-24';
    const server = createApp({ repository: repo, adminToken: token }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const csv = await readFile(new URL('../../examples/import/tj-ky-songs-import.csv', import.meta.url), 'utf8');
      const imported = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/import`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' }, body: csv,
      });
      assert.equal(imported.status, 200);
      const result = await imported.json();
      assert.equal(result.processed, 114968);
      assert.equal(result.duplicates, 0);
      const [[{ collisions }]] = await pool.query("SELECT COUNT(*) AS collisions FROM karaoke_songs a JOIN karaoke_songs b ON a.song_number=b.song_number AND a.brand='TJ' AND b.brand='KY'");
      assert.ok(Number(collisions) >= 29326);
      assert.equal((await repo.list({ q: '사랑했지만', limit: 30, offset: 0 })).songs.some(song => song.brand === 'TJ' && song.youtube_video_id), true);
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally {
    await pool?.end();
    await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await adminPool.end();
  }
});

test('Legacy schema upgrade keeps IDs and videos and is safe to run twice', async () => {
  const database = `tj_legacy_test_${Date.now()}`;
  const adminPool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD });
  let pool;
  try {
    await adminPool.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD, MYSQL_DATABASE: database });
    await pool.query(`CREATE TABLE karaoke_songs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, tj_number VARCHAR(10) NULL,
      title VARCHAR(200) NOT NULL, artist VARCHAR(200) NOT NULL DEFAULT '',
      youtube_video_id CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_url VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_video (youtube_video_id), INDEX idx_tj_number (tj_number), INDEX idx_title (title), INDEX idx_artist (artist)
    )`);
    await pool.query("INSERT INTO karaoke_songs (title, artist, tj_number, youtube_video_id, source_url) VALUES ('기존 곡','가수','00123','Abc_def-123','https://youtu.be/Abc_def-123'),('번호 없는 곡','가수',NULL,'abc_def-123','https://youtu.be/abc_def-123')");
    await initSchema(pool);
    await initSchema(pool);
    const [rows] = await pool.query('SELECT * FROM karaoke_songs ORDER BY id');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, '1');
    assert.equal(rows[0].song_key, 'TJ:n:123');
    assert.equal(rows[0].youtube_video_id, 'Abc_def-123');
    assert.equal(rows[1].song_key, 'TJ:v:abc_def-123');
    await songRepository(pool).upsert([normalizeSong({ brand: 'KY', song_number: '123', title: '금영 신규' })]);
    assert.equal((await songRepository(pool).list({ q: '', limit: 30, offset: 0 })).total, 3);
  } finally {
    await pool?.end();
    await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await adminPool.end();
  }
});

test('MySQL rooms persist across store instances, serialize concurrent queues, rollback and expire', async () => {
  const { mysqlRoomStore } = await import('../src/rooms.js');
  const database = `tj_rooms_test_${Date.now()}`;
  const adminPool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD });
  let pool;
  try {
    await adminPool.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = createPool({ ...process.env, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_ROOT_PASSWORD, MYSQL_DATABASE: database });
    await initSchema(pool);
    const repo = songRepository(pool);
    await repo.upsert([normalizeSong({ title: '공유 노래', song_number: '123', youtube_url: 'Abc_def-123' })]);
    const store = mysqlRoomStore(pool); await store.ensure(); await store.ensure();
    await store.create('AABBCCDD', { title: '공개100%방', isPublic: true, members: [{ name: '방장', secret: 'hidden' }], queue: [], revision: 0, createdAt: Date.now() });
    const publicList = await store.listPublic('%', 0, 21);
    assert.equal(publicList.length, 1); assert.equal(publicList[0].hostName, '방장');
    assert.equal(publicList[0].memberCount, 1); assert.equal('state' in publicList[0], false);
    assert.equal((await store.listPublic('_', 0, 21)).length, 0);
    await store.transact('AABBCCDD', state => { state.isPublic = false; });
    assert.equal((await store.listPublic('', 0, 21)).length, 0);
    await store.transact('AABBCCDD', state => { state.isPublic = true; });
    // More operations than pool connections catches nested pool-acquisition deadlocks.
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.transact('AABBCCDD', async (state, connection) => {
      const song = await repo.getSong('1', connection); state.queue.push({ id: song.id, reservation: i }); state.revision++;
    })));
    const fresh = mysqlRoomStore(pool);
    await fresh.transact('AABBCCDD', state => { assert.equal(state.queue.length, 12); assert.equal(state.revision, 12); });
    await assert.rejects(store.transact('AABBCCDD', state => { state.queue = []; throw new Error('rollback'); }));
    await fresh.transact('AABBCCDD', state => assert.equal(state.queue.length, 12));
    await pool.query("UPDATE karaoke_rooms SET expires_at=DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE code='AABBCCDD'");
    await assert.rejects(store.transact('AABBCCDD', () => {}), { status: 404 });
    assert.equal((await store.listPublic('', 0, 21)).length, 0);
    await store.create('11223344', { queue: [] });
    await store.transact('11223344', state => { state.closed = true; });
    await assert.rejects(store.transact('11223344', () => {}), { status: 404 });
  } finally { await pool?.end(); await adminPool.query(`DROP DATABASE IF EXISTS \`${database}\``); await adminPool.end(); }
});
