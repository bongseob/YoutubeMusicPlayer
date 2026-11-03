import test from 'node:test';
import assert from 'node:assert/strict';
import { readSongs, moveSong, songKey, isPlayable } from '../src/storage.js';
test('Corrupt or unavailable local storage recovers safely', () => {
  for (const value of ['bad json', '{}', 'null', '[{}]']) assert.deepEqual(readSongs({ getItem: () => value }, 'key'), []);
  assert.deepEqual(readSongs({ getItem: () => { throw new Error('disabled'); } }, 'key'), []);
  const song = { title: '노래', youtube_video_id: 'Abc_def-123' };
  assert.equal(readSongs({ getItem: () => JSON.stringify([song]) }, 'key').length, 1);
  assert.equal(readSongs({ getItem: () => JSON.stringify([song]) }, 'key', true).length, 0);
});
test('Same number across brands has distinct favorites; metadata cannot restore into playable queue', () => {
  const tj = { brand: 'TJ', song_number: '00123', title: '태진', youtube_video_id: null, queueId: 'a' };
  const ky = { ...tj, brand: 'KY', song_number: '123', title: '금영' };
  assert.notEqual(songKey(tj), songKey(ky));
  assert.equal(songKey(tj), songKey({ ...tj, song_number: '123' }));
  assert.equal(isPlayable(tj), false);
  const storage = { getItem: () => JSON.stringify([tj, ky]) };
  assert.equal(readSongs(storage, 'favorites').length, 2);
  assert.equal(readSongs(storage, 'queue', true).length, 0);
});
test('Queue can reorder duplicate songs independently and preserve original array', () => {
  const queue = [{ queueId: 'a' }, { queueId: 'b' }, { queueId: 'c' }];
  assert.deepEqual(moveSong(queue, 0, 1).map(s => s.queueId), ['b', 'a', 'c']);
  assert.deepEqual(queue.map(s => s.queueId), ['a', 'b', 'c']);
  assert.deepEqual(moveSong(queue, 0, -1), queue);
  assert.deepEqual(moveSong(queue, 2, 1), queue);
});
