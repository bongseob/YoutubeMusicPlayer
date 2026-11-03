import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const adminToken = 'test-admin-token-with-more-than-24-chars';
test('HTTP API enforces auth, validates import before writing, and hides server errors', async t => {
  const writes = [];
  const repository = {
    health: async () => {}, list: async () => ({ songs: [], total: 0 }),
    upsert: async songs => { writes.push(songs); return { created: songs.length, updated: 0 }; },
  };
  const server = createApp({ repository, adminToken, staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token = adminToken, type = 'application/json') => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body });
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/songs?page=0')).status, 400);
  const song = { title: '테스트', youtube_url: 'Abc_def-123' };
  assert.equal((await post('/api/admin/songs', JSON.stringify(song), 'wrong')).status, 401);
  assert.equal(writes.length, 0);
  assert.equal((await post('/api/admin/songs', JSON.stringify(song))).status, 200);
  assert.equal(writes.length, 1);
  const invalid = await post('/api/admin/import', 'title,youtube_url\n정상,Abc_def-123\n오류,bad', adminToken, 'text/csv');
  assert.equal(invalid.status, 400); assert.equal(writes.length, 1);
  assert.equal((await invalid.json()).details[0].row, 3);
  const imported = await post('/api/admin/import', 'title,youtube_url\n정상,Abc_def-123', adminToken, 'text/csv');
  assert.equal((await imported.json()).processed, 1);
  repository.list = async () => { throw new Error('password should not appear'); };
  const failed = await fetch(base + '/api/songs');
  assert.equal(failed.status, 500); assert.doesNotMatch(await failed.text(), /password/);
});

test('A local trusted proxy preserves individual client rate limits', async t => {
  const repository = { health: async () => {}, list: async () => ({ songs: [], total: 0 }), upsert: async () => ({}) };
  const app = createApp({ repository, adminToken, trustProxy: 'loopback', staticDir: '/nonexistent' });
  app.get('/inspect-client', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const inspected = await fetch(base + '/inspect-client', { headers: { 'X-Forwarded-For': '198.51.100.99, 203.0.113.10', 'X-Forwarded-Proto': 'https' } });
  assert.deepEqual(await inspected.json(), { ip: '203.0.113.10', protocol: 'https' });
  const post = ip => fetch(base + '/api/admin/songs', { method: 'POST', headers: { 'X-Forwarded-For': ip, Authorization: 'Bearer invalid' } });
  for (let i = 0; i < 30; i++) assert.equal((await post('203.0.113.10')).status, 401);
  assert.equal((await post('203.0.113.10')).status, 429);
  assert.equal((await post('203.0.113.11')).status, 401);
});
