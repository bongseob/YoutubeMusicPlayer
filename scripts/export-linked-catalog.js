import dotenv from 'dotenv';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { createPool } from '../server/src/db.js';
import { parseSongsCsv } from '../server/src/songs.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const pool = createPool();
try {
  const [songs] = await pool.query('SELECT * FROM karaoke_songs ORDER BY brand, song_number, id');
  const linked = songs.filter(song => song.youtube_video_id);
  const statusRows = parse(await readFile('.local/youtube-sync/all-songs-status.csv', 'utf8'), { columns: true, bom: true });
  const key = row => `${row.brand}:n:${String(row.song_number).replace(/^0+(?=\d)/, '')}`;
  const status = new Map(statusRows.map(row => [key(row), row]));
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const columns = ['brand', 'song_number', 'title', 'artist', 'youtube_url'];
  const serialize = rows => '\uFEFF' + [columns.join(','), ...rows.map(song => [song.brand, song.song_number, song.title, song.artist,
    song.youtube_video_id ? `https://www.youtube.com/watch?v=${song.youtube_video_id}` : ''].map(quote).join(','))].join('\r\n') + '\r\n';
  const full = serialize(songs), playable = serialize(linked);
  if (Buffer.byteLength(full) > 20 * 1024 * 1024) throw new Error('전체 CSV가 앱 업로드 한도를 넘습니다.');
  if (parseSongsCsv(full).songs.length !== songs.length || parseSongsCsv(playable).songs.length !== linked.length) throw new Error('CSV 행 수 검증에 실패했습니다.');
  await mkdir('examples/import', { recursive: true });
  await writeFile('examples/import/tj-ky-songs-with-videos.csv', full);
  await writeFile('examples/import/linked-songs-only.csv', playable);
  const count = {};
  const statusFields = [...columns, 'status', 'reason', 'video_variant'];
  const lines = [statusFields.join(',')];
  for (const song of songs) {
    const found = status.get(key(song)) || {};
    const state = song.youtube_video_id ? 'linked' : found.status || 'pending_scan';
    count[state] = (count[state] || 0) + 1;
    lines.push([song.brand, song.song_number, song.title, song.artist, song.youtube_video_id ? `https://www.youtube.com/watch?v=${song.youtube_video_id}` : '',
      state, song.youtube_video_id ? '' : found.reason || '', found.video_variant || ''].map(quote).join(','));
  }
  await writeFile('examples/import/tj-ky-video-link-status.csv', '\uFEFF' + lines.join('\r\n') + '\r\n');
  const report = JSON.parse(await readFile('.local/youtube-sync/report.json', 'utf8'));
  const summary = { exportedAt: new Date().toISOString(), total: songs.length, linked: linked.length,
    unlinked: songs.length - linked.length, statusCounts: count, scanComplete: report.scanComplete,
    allCatalogSongsLinked: report.allCatalogSongsLinked, allPublicVideosCovered: report.allPublicVideosCovered,
    stopReason: report.stopReason, coverage: report.coverage, searchRequests: report.searchRequests,
    playbackTested: false, primarySource: 'YouTube Data API v3',
    files: ['examples/import/tj-ky-songs-with-videos.csv', 'examples/import/linked-songs-only.csv', 'examples/import/tj-ky-video-link-status.csv'] };
  await writeFile('examples/video-links/full-sync-summary.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally { await pool.end(); }
