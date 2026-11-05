import test from 'node:test';
import assert from 'node:assert/strict';
import { findKyFallback } from '../src/playback-fallback.js';
import { normalizeSong } from '../src/songs.js';

const approved = normalizeSong({ brand: 'KY', song_number: '101', title: '가거라 삼팔선', artist: '남인수', youtube_url: '7JDG2kxepz8' });
test('TJ fallback requires exact title/artist and an official KY ID from the verified catalogue', async () => {
  let candidates = [approved];
  const repository = { getSongsByKeys: async () => candidates };
  const source = { brand: 'TJ', title: '가거라 삼팔선', artist: '남인수' };
  assert.deepEqual(await findKyFallback(source, repository), { playback_video_id: approved.youtube_video_id, playback_brand: 'KY', playback_song_number: '101' });
  assert.equal((await findKyFallback({ ...source, title: '가거라삼팔선' }, repository)).playback_brand, 'KY');
  assert.equal(await findKyFallback({ ...source, brand: 'KY' }, repository), null);
  assert.equal(await findKyFallback({ ...source, artist: '' }, repository), null);
  assert.equal(await findKyFallback({ ...source, artist: '다른 가수' }, repository), null);
  candidates = [{ ...approved, youtube_video_id: 'Abc_def-123' }];
  assert.equal(await findKyFallback(source, repository), null);
  candidates = [{ ...approved, title: '다른 곡' }]; assert.equal(await findKyFallback(source, repository), null);
  candidates = []; assert.equal(await findKyFallback(source, repository), null);
});
