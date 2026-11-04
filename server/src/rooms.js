import { randomBytes, randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const nickname = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 30) fail(400, '닉네임을 1~30자로 입력하세요.'); return value.trim(); };
const lifetime = 24 * 60 * 60 * 1000;
export function mysqlRoomStore(pool) {
  return {
    async ensure() { await pool.query(`CREATE TABLE IF NOT EXISTS karaoke_rooms (code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, state JSON NOT NULL, expires_at DATETIME NOT NULL, INDEX (expires_at)) ENGINE=InnoDB`); },
    async create(code, state) { await pool.query('DELETE FROM karaoke_rooms WHERE expires_at < NOW() LIMIT 100'); await pool.execute('INSERT INTO karaoke_rooms VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))', [code, JSON.stringify(state)]); },
    async transact(code, change) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.execute('SELECT state FROM karaoke_rooms WHERE code=? AND expires_at > NOW() FOR UPDATE', [code]);
        if (!rows.length) fail(404, '방이 종료되었거나 만료되었습니다.');
        const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state;
        const result = await change(state, c);
        if (state.closed) await c.execute('DELETE FROM karaoke_rooms WHERE code=?', [code]);
        else await c.execute('UPDATE karaoke_rooms SET state=?, expires_at=DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE code=?', [JSON.stringify(state), code]);
        await c.commit(); return result;
      } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
    },
  };
}
export function roomRouter({ store, repository }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '4kb' }));
  router.use((req, res, next) => {
    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return next(Object.assign(new Error('요청 형식을 확인하세요.'), { status: 400 }));
    next();
  });
  const entryLimit = rateLimit({ windowMs: 60000, limit: 30 });
  const writeLimit = rateLimit({ windowMs: 60000, limit: 120 });
  function view(state, member) {
    return { code: state.code, title: state.title, isHost: member.host, nickname: member.name, members: state.members.map(m => ({ id: m.id, name: m.name, host: m.host })), queue: state.queue, current: state.current, playback: state.playback, revision: state.revision };
  }
  router.post('/', entryLimit, async (req, res) => {
    const name = nickname(req.body.nickname), token = randomBytes(32).toString('hex');
    const code = randomBytes(4).toString('hex').toUpperCase();
    const member = { id: randomUUID(), name, host: true, secret: hash(token) };
    const state = { code, title: `${name}의 노래방`, members: [member], queue: [], current: null, playback: 'ready', revision: 0, createdAt: Date.now(), expiresAt: Date.now() + lifetime };
    await store.create(code, state); res.status(201).json({ token, room: view(state, member) });
  });
  router.param('code', (req, res, next, code) => { if (!/^[A-F0-9]{8}$/.test(code)) return next(Object.assign(new Error('방 코드를 확인하세요.'), { status: 400 })); next(); });
  router.post('/:code/join', entryLimit, async (req, res) => {
    const name = nickname(req.body.nickname), token = randomBytes(32).toString('hex');
    const result = await store.transact(req.params.code, state => {
      if (state.members.length >= 50) fail(409, '방은 최대 50명까지 입장할 수 있습니다.');
      const member = { id: randomUUID(), name, host: false, secret: hash(token) }; state.members.push(member); state.revision++;
      return { token, room: view(state, member) };
    }); res.json(result);
  });
  async function authenticated(req, action) {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) fail(401, '방에 다시 입장하세요.');
    return store.transact(req.params.code, async (state, connection) => {
      const member = state.members.find(m => m.secret === hash(token));
      if (!member) fail(401, '방에 다시 입장하세요.');
      await action(state, member, connection); return view(state, member);
    });
  }
  router.get('/:code', async (req, res) => res.json({ room: await authenticated(req, () => {}) }));
  router.post('/:code/actions', writeLimit, async (req, res) => {
    const room = await authenticated(req, async (state, member, connection) => {
      const { action } = req.body;
      if (action === 'reserve') {
        if (state.queue.length >= 500) fail(409, '예약은 최대 500곡입니다.');
        const id = String(req.body.songId || ''); if (!/^\d{1,20}$/.test(id)) fail(400, '곡 번호를 확인하세요.');
        const song = await repository.getSong(id, connection);
        if (!song?.youtube_video_id) fail(400, '영상이 연결된 곡만 예약할 수 있습니다.');
        state.queue.push({ ...song, queueId: randomUUID(), reservedBy: member.name });
      } else if (action === 'leave') {
        if (member.host) fail(403, '방장은 방 종료를 사용하세요.');
        state.members = state.members.filter(m => m.id !== member.id);
      } else {
        if (!member.host) fail(403, '방장만 재생과 예약 목록을 관리할 수 있습니다.');
        if (action === 'next') {
          // A stale video-ended event must not skip a newly selected song.
          if (req.body.currentId !== (state.current?.queueId || null)) fail(409, '재생 곡이 변경되었습니다.');
          state.current = state.queue.shift() || null; state.playback = state.current ? 'loading' : 'ready';
        } else if (action === 'remove') state.queue = state.queue.filter(s => s.queueId !== req.body.queueId);
        else if (action === 'clear') state.queue = [];
        else if (action === 'playback') {
          if (req.body.currentId !== state.current?.queueId) fail(409, '재생 곡이 변경되었습니다.');
          if (!['playing', 'paused', 'loading', 'blocked', 'error'].includes(req.body.status)) fail(400, '재생 상태가 올바르지 않습니다.');
          state.playback = req.body.status;
        } else if (action === 'close') { state.closed = true; state.queue = []; state.current = null; }
        else fail(400, '지원하지 않는 동작입니다.');
      }
      state.revision++;
    }); res.json({ room });
  });
  return router;
}
