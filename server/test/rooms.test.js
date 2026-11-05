import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function memoryStore() {
  const rooms = new Map(); let pending = Promise.resolve();
  return {
    async create(code, state) { rooms.set(code, structuredClone(state)); },
    transact(code, fn) {
      const result = pending.then(async () => {
        if (!rooms.has(code)) throw Object.assign(new Error('방이 종료되었습니다.'), { status: 404 });
        const state = structuredClone(rooms.get(code));
        const value = await fn(state);
        if (state.closed) rooms.delete(code); else rooms.set(code, state);
        return value;
      }); pending = result.catch(() => {}); return result;
    },
  };
}
test('Rooms share ordered reservations, enforce host permissions, survive re-entry and close atomically', async t => {
  const roomStore = memoryStore();
  const repository = { getSong: async id => id === '1' ? { id: '1', brand: 'TJ', title: '가거라 삼팔선', artist: '남인수', youtube_video_id: 'Abc_def-123' } : null, getSongsByKeys: async () => [{ brand: 'KY', song_key: 'KY:n:101', song_number: '101', title: '가거라 삼팔선', artist: '남인수', youtube_video_id: '7JDG2kxepz8' }] };
  const server = createApp({ repository, roomStore, adminToken: 'test-token-with-more-than-24-characters', staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  async function call(path, body, token) {
    const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  }
  const lookup = await fetch(base.replace('/rooms', '/songs/1/fallback'));
  assert.equal(lookup.status, 200); assert.equal((await lookup.json()).playback.playback_brand, 'KY');
  assert.equal((await call('/', { nickname: '' })).status, 400);
  const host = (await call('/', { nickname: '방장' })).body;
  const code = host.room.code;
  assert.equal(host.room.isHost, true);
  assert.doesNotMatch(JSON.stringify(host.room), /secret|token/);
  const guest = (await call(`/${code}/join`, { nickname: '친구' })).body;
  assert.equal(guest.room.isHost, false);
  assert.equal((await call(`/${code}`)).status, 401);
  assert.equal((await call(`/${code}`, null, 'f'.repeat(64))).status, 401);
  for (const action of ['close', 'clear', 'remove', 'next', 'playback', 'fallback']) assert.equal((await call(`/${code}/actions`, { action }, guest.token)).status, 403);
  assert.equal((await call(`/${code}/actions`, { action: 'reserve', songId: '2', title: 'forged', youtube_video_id: 'fake' }, guest.token)).status, 400);
  await Promise.all(Array.from({ length: 8 }, () => call(`/${code}/actions`, { action: 'reserve', songId: '1' }, guest.token)));
  let room = (await call(`/${code}`, null, host.token)).body.room;
  assert.equal(room.queue.length, 8); assert.equal(new Set(room.queue.map(s => s.queueId)).size, 8);
  assert.equal(room.queue[0].reservedBy, '친구');
  const expected = room.queue[0].queueId;
  room = (await call(`/${code}/actions`, { action: 'next', currentId: null }, host.token)).body.room;
  assert.equal(room.current.queueId, expected); assert.equal(room.queue.length, 7);
  assert.equal((await call(`/${code}/actions`, { action: 'fallback', currentId: 'stale' }, host.token)).status, 409);
  const fallback = (await call(`/${code}/actions`, { action: 'fallback', currentId: expected }, host.token)).body.room;
  assert.equal(fallback.current.playback_brand, 'KY');
  assert.equal(fallback.current.youtube_video_id, 'Abc_def-123');
  assert.equal(fallback.current.queueId, expected);
  assert.equal((await call(`/${code}`, null, guest.token)).body.room.current.playback_video_id, '7JDG2kxepz8');
  assert.equal((await call(`/${code}/actions`, { action: 'fallback', currentId: expected }, host.token)).status, 409);
  assert.equal((await call(`/${code}/actions`, { action: 'next', currentId: null }, host.token)).status, 409);
  await call(`/${code}/actions`, { action: 'playback', currentId: expected, status: 'paused' }, host.token);
  const reentered = (await call(`/${code}`, null, guest.token)).body.room;
  assert.equal(reentered.playback, 'paused'); assert.equal(reentered.current.queueId, expected);
  await call(`/${code}/actions`, { action: 'remove', queueId: reentered.queue[0].queueId }, host.token);
  assert.equal((await call(`/${code}`, null, guest.token)).body.room.queue.length, 6);
  await call(`/${code}/actions`, { action: 'leave' }, guest.token);
  assert.equal((await call(`/${code}`, null, guest.token)).status, 401);
  const other = (await call('/', { nickname: '다른 방' })).body;
  assert.equal((await call(`/${code}`, null, other.token)).status, 401);
  await call(`/${code}/actions`, { action: 'close' }, host.token);
  assert.equal((await call(`/${code}`, null, host.token)).status, 404);
  assert.equal((await call(`/${code}/join`, { nickname: '친구' })).status, 404);
  assert.equal((await call(`/${other.room.code}`, null, other.token)).status, 200);
});
