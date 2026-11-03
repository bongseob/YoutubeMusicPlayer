import dotenv from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { createPool } from '../server/src/db.js';
import { normalizeSong } from '../server/src/songs.js';
import { sameTitle, sameArtist, validateMetadata } from './video-link-utils.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const apply = process.argv.includes('--apply');
const inputPath = process.argv.find(arg => arg.endsWith('.json')) || 'examples/video-links/candidates-batch-02.json';
const stem = inputPath.replace(/\.json$/, '');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const pool = createPool();
const results = [];
let connection;
try {
  const candidates = input.songs.map(row => ({ ...normalizeSong(row), discovery_source: row.discovery_source }));
  const unique = [...new Map(candidates.map(song => [song.song_key, song])).values()];
  const [rows] = await pool.query('SELECT * FROM karaoke_songs WHERE song_key IN (?)', [unique.map(song => song.song_key)]);
  const existing = new Map(rows.map(song => [song.song_key, song]));
  const pending = [];
  for (const song of unique) {
    const row = existing.get(song.song_key);
    let reason;
    if (!row) reason = 'catalog_row_missing';
    else if (row.youtube_video_id) reason = 'already_linked';
    else if (!sameTitle(row.title, song.title) || !sameArtist(row.artist, song.artist)) reason = 'catalog_title_or_artist_mismatch';
    if (reason) results.push({ song, status: 'skipped', reason });
    else pending.push({ song, before: row });
  }
  console.log(`Candidates ${unique.length}; to verify ${pending.length}; skipped ${results.length}`);
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      try {
        const url = `https://noembed.com/embed?url=${encodeURIComponent(item.song.source_url)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const validation = validateMetadata(item.song, data);
        results.push({ ...item, status: validation.ok ? 'verified' : 'skipped', reason: validation.reason,
          checked_at: new Date().toISOString(), metadata_source: url,
          metadata: { title: data.title, author_name: data.author_name, author_url: data.author_url, url: data.url, error: data.error } });
      } catch (error) { results.push({ ...item, status: 'skipped', reason: `metadata_request_failed: ${error.message}` }); }
      console.log(`Checked ${results.length}/${unique.length}; verified ${results.filter(row => row.status === 'verified').length}`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  await Promise.all([worker(), worker()]);
  const verified = results.filter(row => row.status === 'verified');
  // Persist provenance and original rows before touching any video links.
  const report = { mode: apply ? 'apply' : 'dry-run', checked_at: new Date().toISOString(), playback_verified: false, results };
  await writeFile(`${stem}-report.json`, JSON.stringify(report, null, 2) + '\n');
  if (apply && verified.length) {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      for (const item of verified) {
        const [result] = await connection.execute(`UPDATE karaoke_songs SET youtube_video_id=?, source_url=? WHERE song_key=? AND youtube_video_id IS NULL AND title=? AND artist=?`,
          [item.song.youtube_video_id, item.song.source_url, item.song.song_key, item.before.title, item.before.artist]);
        item.applied = result.affectedRows === 1;
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    const [linked] = await pool.query('SELECT song_key, youtube_video_id FROM karaoke_songs WHERE song_key IN (?)', [verified.map(row => row.song.song_key)]);
    for (const item of verified.filter(row => row.applied)) {
      if (!linked.some(row => row.song_key === item.song.song_key && row.youtube_video_id === item.song.youtube_video_id)) throw new Error(`Post-write mismatch: ${item.song.song_key}`);
    }
  }
  report.applied_count = verified.filter(row => row.applied).length;
  await writeFile(`${stem}-report.json`, JSON.stringify(report, null, 2) + '\n');
  const fields = ['brand', 'song_number', 'title', 'artist', 'youtube_url'];
  const quote = value => `"${String(value || '').replaceAll('"', '""')}"`;
  const csv = [fields.join(','), ...verified.map(({ song }) => fields.map(field => quote(field === 'youtube_url' ? song.source_url : song[field])).join(','))].join('\r\n') + '\r\n';
  await writeFile(`${stem}-matched.csv`, '\uFEFF' + csv);
  const [[counts]] = await pool.query('SELECT COUNT(*) AS total, SUM(youtube_video_id IS NOT NULL) AS linked FROM karaoke_songs');
  console.log(JSON.stringify({ verified: verified.length, applied: report.applied_count, total: Number(counts.total), linked: Number(counts.linked) }));
} finally { connection?.release(); await pool.end(); }
