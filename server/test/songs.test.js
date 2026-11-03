import test from 'node:test';
import assert from 'node:assert/strict';
import { videoId, normalizeSong, parseSongsCsv, searchParams, MAX_IMPORT_ROWS } from '../src/songs.js';

const id = 'Abc_def-123';
test('YouTube URL variants preserve the case-sensitive video ID', () => {
  for (const url of [id, `https://youtu.be/${id}?si=xyz`, `https://www.youtube.com/watch?v=${id}&t=9`, `https://m.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) assert.equal(videoId(url), id);
});
test('Reject impostor hosts, playlists, invalid IDs and non-http URLs', () => {
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test/${id}`, 'https://youtube.com/playlist?list=123', 'not-an-id', `ftp://youtube.com/watch?v=${id}`, `https://evil@youtube.com/watch?v=${id}`]) assert.throws(() => videoId(url));
});
test('Normalize fields without dropping leading zeros in TJ number', () => {
  const song = normalizeSong({ title: '  노래  ', artist: ' 가수 ', tj_number: '00123', youtube_url: id });
  assert.equal(song.title, '노래'); assert.equal(song.artist, '가수'); assert.equal(song.tj_number, '00123');
  assert.equal(song.source_url, `https://www.youtube.com/watch?v=${id}`);
  for (const change of [{ title: '' }, { title: 'a'.repeat(201) }, { tj_number: '1e4' }, { artist: {} }]) assert.throws(() => normalizeSong({ ...song, ...change }));
});
test('CSV handles BOM, commas, quoted fields, blank lines and duplicate brand numbers', () => {
  const result = parseSongsCsv(`\uFEFFtitle,artist,tj_number,youtube_url\r\n"노래, 하나",가수,001,${id}\r\n\r\n갱신,가수,1,https://youtu.be/${id}\r\n`);
  assert.equal(result.rows, 2); assert.equal(result.duplicates, 1); assert.equal(result.songs[0].title, '갱신');
});
test('CSV validation is atomic and identifies bad rows', () => {
  assert.throws(() => parseSongsCsv(`title,youtube_url\n정상,${id}\n오류,invalid`), err => err.details[0].row === 3);
  for (const csv of ['', 'title,title,youtube_url\na,b,c', 'artist,youtube_url\na,b', 'title,youtube_url']) assert.throws(() => parseSongsCsv(csv));
  assert.throws(() => parseSongsCsv(`title,youtube_url\n${Array(MAX_IMPORT_ROWS + 1).fill(`노래,${id}`).join('\n')}`), /120,000/);
});
test('Metadata-only catalog keeps TJ and KY numbers separate and preserves supplied video', () => {
  const result = parseSongsCsv(`brand,song_number,title,artist,youtube_url\nTJ,123,태진,가수,${id}\nKY,123,금영,가수,\nTJ,00123,태진 갱신,가수,`);
  assert.equal(result.songs.length, 2);
  assert.equal(result.duplicates, 1);
  const tj = result.songs.find(song => song.brand === 'TJ');
  const ky = result.songs.find(song => song.brand === 'KY');
  assert.equal(tj.song_key, 'TJ:n:123');
  assert.equal(tj.youtube_video_id, id);
  assert.equal(ky.song_key, 'KY:n:123');
  assert.equal(ky.youtube_video_id, null);
  assert.equal(ky.tj_number, null);
  assert.equal(ky.ky_number, '123');
  assert.throws(() => normalizeSong({ title: '오류', brand: 'KY', tj_number: '123' }));
  assert.throws(() => normalizeSong({ title: '오류', brand: 'other', song_number: '123' }));
  assert.throws(() => normalizeSong({ title: '오류', song_number: '123', tj_number: '456' }));
  assert.throws(() => normalizeSong({ title: '오류', youtube_url: {} }));
});
test('Search rejects unsafe pagination and excessive input', () => {
  assert.deepEqual(searchParams({ q: ' 가수 ', page: '2' }), { q: '가수', page: 2, limit: 30, offset: 30 });
  for (const page of ['0', '-1', 'abc', '1.5', 'Infinity']) assert.throws(() => searchParams({ page }));
  assert.throws(() => searchParams({ q: 'a'.repeat(201) }));
});
