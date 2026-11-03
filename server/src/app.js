import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeSong, parseSongsCsv, searchParams } from './songs.js';

export function createApp({ repository, adminToken, trustProxy = false, staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url)) }) {
  if (!adminToken || adminToken.length < 24) throw new Error('ADMIN_TOKEN을 24자 이상으로 설정해 주세요.');
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
      frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
      imgSrc: ["'self'", 'data:', 'https://i.ytimg.com'],
      connectSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, crossOriginEmbedderPolicy: false }));
  const hash = value => createHash('sha256').update(value).digest();
  const adminLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' } });
  function admin(req, res, next) {
    const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (!timingSafeEqual(hash(supplied), hash(adminToken))) return res.status(401).json({ error: '관리자 토큰을 확인해 주세요.' });
    next();
  }
  app.get('/api/health', async (req, res) => {
    try { await repository.health(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ error: 'DB에 연결할 수 없습니다. 서버 설정을 확인해 주세요.' }); }
  });
  app.get('/api/songs', async (req, res) => {
    const params = searchParams(req.query);
    res.json({ ...await repository.list(params), page: params.page, pageSize: params.limit });
  });
  app.post('/api/admin/songs', adminLimit, admin, express.json({ limit: '16kb' }), async (req, res) => {
    const song = normalizeSong(req.body);
    res.json({ ...await repository.upsert([song]), song });
  });
  app.post('/api/admin/import', adminLimit, admin, express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }), async (req, res) => {
    const { songs, rows, duplicates } = parseSongsCsv(req.body);
    res.json({ ...await repository.upsert(songs), rows, duplicates, processed: songs.length });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' }));
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (req, res) => res.sendFile(`${staticDir}/index.html`));
  }
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('API request failed:', err.code || err.name);
    res.status(status).json({ error: status >= 500 ? '서버 처리에 실패했습니다. DB 연결을 확인하고 다시 시도해 주세요.' : status === 413 ? '파일 크기가 허용 범위를 넘었습니다. CSV는 20MB 이하여야 합니다.' : err.message, ...(err.details ? { details: err.details } : {}) });
  });
  return app;
}
