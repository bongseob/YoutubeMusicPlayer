import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSong } from '../src/songs.js';
import { validateMetadata } from '../../scripts/video-link-utils.js';

const song = normalizeSong({ brand: 'TJ', song_number: '29460', title: '보릿고개', artist: '진성', youtube_url: '2q-NPEdG7EQ' });
const metadata = { provider_name: 'YouTube', title: '[TJ노래방] 보릿고개 - 진성 / TJ Karaoke', author_url: 'https://www.youtube.com/@TJ%EB%85%B8%EB%9E%98%EB%B0%A9TJKaraoke', url: song.source_url };
test('Video matching validates official channel identity, title, singer and ID', () => {
  assert.equal(validateMetadata(song, metadata).ok, true);
  for (const patch of [
    { author_url: 'https://www.youtube.com/@impostor', author_name: 'TJ노래방 공식 유튜브채널' },
    { author_url: 'https://www.youtube.com.evil.test/@TJ노래방TJKaraoke' },
    { title: '[TJ노래방] 보릿고개 - 김호중 / TJ Karaoke' },
    { title: '[TJ노래방 / 여자키] 보릿고개 - 진성 / TJ Karaoke' },
    { url: 'https://www.youtube.com/watch?v=Abc_def-123' },
    { error: '404 Not Found' },
  ]) assert.equal(validateMetadata(song, { ...metadata, ...patch }).ok, false);
});
test('KY and TJ cannot share channel identity; normal KY title matches number suffix', () => {
  const ky = normalizeSong({ brand: 'KY', song_number: '27438', title: '막걸리 한잔', artist: '영탁', youtube_url: '6Da6eP5mcJM' });
  const record = { provider_name: 'YouTube', title: '막걸리 한잔 - 영탁 (KY.27438) / KY Karaoke', author_url: 'https://www.youtube.com/@KARAOKEKY', url: ky.source_url };
  assert.equal(validateMetadata(ky, record).ok, true);
  assert.equal(validateMetadata(ky, { ...record, author_url: metadata.author_url }).ok, false);
});
test('English translations containing hyphens do not split the song credit', () => {
  const translated = { ...metadata, title: '[TJ노래방] 보릿고개 (Hill - Of Barley) - 진성 (Jin - Sung) / TJ Karaoke' };
  assert.equal(validateMetadata(song, translated).ok, true);
});
test('KY MR prefix and trailing badge support the verified melody-removed format', () => {
  const ky = normalizeSong({ brand: 'KY', song_number: '85830', title: '반쪽', artist: 'V.O.S', youtube_url: 'Abc_def-123' });
  const record = { provider_name: 'YouTube', title: '[멜로디제거] 반쪽 - V.O.S (KY.85830) [KY 금영노래방] / KY Karaoke', author_url: 'https://www.youtube.com/@KARAOKEKY', url: ky.source_url };
  assert.equal(validateMetadata(ky, record).ok, false);
  assert.equal(validateMetadata(ky, record, { allowMR: true }).ok, true);
});
test('Nested transliteration annotations leave the same credited artist', () => {
  const a = normalizeSong({ brand: 'TJ', song_number: '48803', title: '부담이돼', artist: '정키(Feat.휘인)', youtube_url: 'Abc_def-123' });
  assert.equal(validateMetadata(a, { ...metadata, url: a.source_url, title: '[TJ노래방] 부담이 돼 - 정키(Feat.휘인(Whee In)) / TJ Karaoke' }).ok, true);
});

test('Known trailing genre annotation matches without stripping artist identity brackets', () => {
  const ky = normalizeSong({ brand: 'KY', song_number: '1102', title: '타타타', artist: '김국환[성인가요]', youtube_url: 'BcxMuVc1bAs' });
  const record = { provider_name: 'YouTube', title: '[멜로디제거] 타타타 - 김국환 (KY.1102) / KY Karaoke', author_url: 'https://www.youtube.com/@KARAOKEKY', url: ky.source_url };
  assert.equal(validateMetadata(ky, record, { allowMR: true }).ok, true);
  assert.equal(validateMetadata(ky, { ...record, title: record.title.replace('김국환', '다른가수') }, { allowMR: true }).ok, false);
  assert.equal(validateMetadata({ ...ky, artist: '김국환[다른그룹]' }, record, { allowMR: true }).ok, false);
});
