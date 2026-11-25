import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function memoryStore() {
  const rooms = new Map(); let pending = Promise.resolve();
  return {
    async create(code, state) { rooms.set(code, structuredClone(state)); },
    async listPublic(q, offset, limit) {
      return [...rooms.values()].filter(s => s.isPublic === true && `${s.title} ${s.members[0].name}`.includes(q)).slice(offset, offset + limit).map(s => ({ code: s.code, title: s.title, hostName: s.members[0].name, memberCount: s.members.length }));
    },
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

test('Only an absent host can be replaced, and host transfers preserve the room and revoke old privileges', async t => {
  const roomStore = memoryStore();
  const repository = { getSong: async id => ({ id, brand: 'TJ', title: '노래', artist: '가수', youtube_video_id: 'Abc_def-123' }) };
  const server = createApp({ repository, roomStore, adminToken: 'test-token-with-more-than-24-characters', staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  async function call(path, body, token) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...(await response.json()) };
  }
  const host = await call('/', { nickname: '원래 방장' });
  const code = host.room.code, path = `/${code}`;
  const guest = await call(`${path}/join`, { nickname: '친구' });
  const other = await call(`${path}/join`, { nickname: '다른 친구' });
  const guestId = guest.room.members.find(m => m.name === '친구').id;
  const otherId = other.room.members.find(m => m.name === '다른 친구').id;
  const action = (token, fields) => call(`${path}/actions`, fields, token);
  const view = async token => (await call(path, null, token)).room;
  assert.equal((await view(guest.token)).canClaimHost, false);
  assert.equal((await action(guest.token, { action: 'claimHost', lastSeen: 0 })).status, 409);
  assert.equal((await action(guest.token, { action: 'transferHost', memberId: otherId })).status, 403);
  for (const memberId of [undefined, {}, 'missing', host.room.members[0].id]) assert.equal((await action(host.token, { action: 'transferHost', memberId })).status, 409);
  await action(host.token, { action: 'reserve', songId: '1' });
  await action(host.token, { action: 'next', currentId: null });
  await action(guest.token, { action: 'reserve', songId: '1' });
  const before = await view(guest.token);
  await action(guest.token, { action: 'vote', queueId: before.queue[0].queueId });
  // Simulate a closed host tab, without using sleeps or touching an actual DB.
  await roomStore.transact(code, state => { state.members.find(m => m.host).lastSeen = Date.now() - 61000; });
  assert.equal((await view(guest.token)).canClaimHost, true);
  // A successful authenticated host heartbeat makes the room unavailable again.
  await view(host.token);
  assert.equal((await action(guest.token, { action: 'claimHost' })).status, 409);
  await roomStore.transact(code, state => { state.members.find(m => m.host).lastSeen = Date.now() - 61000; });
  assert.equal((await action('f'.repeat(64), { action: 'claimHost' })).status, 401);
  const claims = await Promise.all([action(guest.token, { action: 'claimHost' }), action(other.token, { action: 'claimHost' })]);
  assert.deepEqual(claims.map(result => result.status).sort(), [200, 409]);
  const winner = claims[0].status === 200 ? guest : other;
  const winnerView = await view(winner.token);
  assert.equal(winnerView.isHost, true);
  assert.equal(winnerView.members.filter(m => m.host).length, 1);
  assert.equal(winnerView.members[0].host, true);
  assert.equal(winnerView.current.queueId, before.current.queueId);
  assert.equal(winnerView.queue[0].queueId, before.queue[0].queueId);
  assert.equal(winnerView.queue[0].voteCount, 1);
  assert.equal((await action(host.token, { action: 'close' })).status, 403);
  assert.equal((await action(host.token, { action: 'next', currentId: before.current.queueId })).status, 403);
  assert.equal((await action(host.token, { action: 'playback', currentId: before.current.queueId, status: 'playing' })).status, 403);
  const target = winner === guest ? other : guest;
  const targetId = winner === guest ? otherId : guestId;
  await roomStore.transact(code, state => { state.members.find(m => m.id === targetId).lastSeen = Date.now() - 61000; });
  assert.equal((await action(winner.token, { action: 'transferHost', memberId: targetId })).status, 409);
  await view(target.token);
  const transferred = await action(winner.token, { action: 'transferHost', memberId: targetId });
  assert.equal(transferred.status, 200);
  assert.equal(transferred.room.isHost, false);
  assert.equal((await view(target.token)).isHost, true);
  assert.equal((await call('/?q=' + encodeURIComponent(target.room.nickname))).rooms[0].hostName, target.room.nickname);
  assert.equal((await action(winner.token, { action: 'close' })).status, 403);
  assert.doesNotMatch(JSON.stringify(await view(target.token)), /lastSeen|secret|token/);
  // Existing persisted rooms receive a grace period rather than immediate takeover.
  await roomStore.transact(code, state => { delete state.members.find(m => m.host).lastSeen; });
  assert.equal((await view(winner.token)).canClaimHost, false);
  await roomStore.transact(code, state => { state.members = state.members.filter(m => !m.host); });
  assert.equal((await action(winner.token, { action: 'claimHost' })).status, 200);
  assert.equal((await action(winner.token, { action: 'close' })).status, 200);
});

test('Queue votes are private, single-choice, transactional and cleared as reservations end', async t => {
  const roomStore = memoryStore();
  const repository = { getSong: async id => ({ id, brand: 'TJ', title: '같은 노래', artist: '가수', youtube_video_id: 'Abc_def-123' }) };
  const server = createApp({ repository, roomStore, adminToken: 'test-token-with-more-than-24-characters', staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  async function call(path, body, token) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...(await response.json()) };
  }
  const host = await call('/', { nickname: '방장' });
  const path = `/${host.room.code}`;
  const guest = await call(`${path}/join`, { nickname: '친구' });
  const action = (body, token = guest.token) => call(`${path}/actions`, body, token);
  const view = async token => (await call(path, null, token)).room;
  for (let i = 0; i < 3; i++) await action({ action: 'reserve', songId: '1' });
  const original = await view(host.token);
  const [a, b, c] = original.queue.map(song => song.queueId);
  assert.deepEqual(original.queue.map(song => song.voteCount), [0, 0, 0]);
  assert.equal((await action({ action: 'vote', queueId: a }, 'f'.repeat(64))).status, 401);
  for (const queueId of [undefined, {}, 1, '']) assert.equal((await action({ action: 'vote', queueId })).status, 400);
  assert.equal((await action({ action: 'vote', queueId: 'missing' })).status, 409);
  await Promise.all([action({ action: 'vote', queueId: b }), action({ action: 'vote', queueId: b }, host.token)]);
  assert.deepEqual((await view(guest.token)).queue.map(song => song.voteCount), [0, 2, 0]);
  // Retrying the same explicit selection cannot add another vote.
  await action({ action: 'vote', queueId: b, voteCount: 99, memberId: original.members[0].id });
  assert.equal((await view(host.token)).queue[1].voteCount, 2);
  await action({ action: 'vote', queueId: c });
  assert.deepEqual((await view(host.token)).queue.map(song => song.voteCount), [0, 1, 1]);
  assert.deepEqual((await view(guest.token)).queue.map(song => song.votedByMe), [false, false, true]);
  assert.deepEqual((await view(host.token)).queue.map(song => song.votedByMe), [false, true, false]);
  assert.doesNotMatch(JSON.stringify((await view(host.token)).members), /voteQueueId|secret|token/);
  // Votes never reorder the queue or change playback, even in a tie.
  assert.deepEqual((await view(host.token)).queue.map(song => song.queueId), [a, b, c]);
  assert.equal((await view(host.token)).current, null);
  assert.equal((await action({ action: 'chooseNext', queueId: c })).status, 403);
  assert.equal((await action({ action: 'chooseNext', queueId: 'stale' }, host.token)).status, 409);
  await action({ action: 'chooseNext', queueId: c }, host.token);
  assert.deepEqual((await view(guest.token)).queue.map(song => song.queueId), [c, a, b]);
  assert.equal((await view(guest.token)).queue[0].votedByMe, true);
  await action({ action: 'next', currentId: null }, host.token);
  assert.equal((await view(host.token)).current.queueId, c);
  assert.equal((await view(guest.token)).queue.some(song => song.votedByMe), false);
  assert.equal((await action({ action: 'vote', queueId: c })).status, 409);
  await action({ action: 'chooseNext', queueId: b }, host.token);
  assert.equal((await view(host.token)).current.queueId, c);
  await action({ action: 'vote', queueId: a });
  await action({ action: 'vote', queueId: null });
  assert.equal((await view(guest.token)).queue.some(song => song.votedByMe), false);
  await action({ action: 'vote', queueId: a });
  await action({ action: 'remove', queueId: a }, host.token);
  assert.equal((await view(guest.token)).queue.some(song => song.votedByMe), false);
  await action({ action: 'vote', queueId: b });
  await action({ action: 'leave' });
  assert.equal((await view(host.token)).queue[0].voteCount, 1);
  const returning = await call(`${path}/join`, { nickname: '친구' });
  assert.equal((await view(returning.token)).queue[0].votedByMe, false);
  await action({ action: 'clear' }, host.token);
  await action({ action: 'reserve', songId: '1' }, host.token);
  assert.equal((await view(host.token)).queue[0].voteCount, 0);
});
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
  assert.equal(host.room.isPublic, true);
  let listed = (await call('/?q=방장')).body.rooms;
  assert.equal(listed[0].code, code);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['code', 'hostName', 'memberCount', 'title']);
  assert.equal((await call('/?page=0')).status, 400);
  assert.equal((await call('/', { nickname: '검사', isPublic: 'false' })).status, 400);
  assert.doesNotMatch(JSON.stringify(host.room), /secret|token/);
  const guest = (await call(`/${code}/join`, { nickname: '친구' })).body;
  assert.equal(guest.room.isHost, false);
  assert.equal((await call(`/${code}/actions`, { action: 'visibility', isPublic: 'false' }, host.token)).status, 400);
  await call(`/${code}/actions`, { action: 'visibility', isPublic: false }, host.token);
  assert.equal((await call('/?q=방장')).body.rooms.length, 0);
  assert.equal((await call(`/${code}`, null, guest.token)).body.room.isPublic, false);
  const privateJoin = await call(`/${code}/join`, { nickname: '코드 입장' });
  assert.equal(privateJoin.status, 200);
  await call(`/${code}/actions`, { action: 'visibility', isPublic: true }, host.token);
  assert.equal((await call('/?q=방장')).body.rooms.length, 1);
  await roomStore.create('AABBCCDD', { code: 'AABBCCDD', title: '기존 방', members: [{ name: '옛 방장' }] });
  assert.equal((await call('/?q=기존')).body.rooms.length, 0);
  assert.equal((await call(`/${code}`)).status, 401);
  assert.equal((await call(`/${code}`, null, 'f'.repeat(64))).status, 401);
  for (const action of ['close', 'clear', 'remove', 'next', 'playback', 'fallback', 'visibility', 'chooseNext']) assert.equal((await call(`/${code}/actions`, { action }, guest.token)).status, 403);
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
  assert.equal((await call('/?q=방장')).body.rooms.length, 0);
  assert.equal((await call(`/${other.room.code}`, null, other.token)).status, 200);
});
