import dotenv from 'dotenv';
import { createPool, initSchema, songRepository } from './db.js';
import { createApp } from './app.js';

dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });
const pool = createPool();
const app = createApp({ repository: songRepository(pool), adminToken: process.env.ADMIN_TOKEN,
  trustProxy: process.env.TRUST_PROXY === 'loopback' ? 'loopback' : false });
try {
  await initSchema(pool);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(Number(process.env.PORT || 3001), host, () => console.log(`TJ 노래방: http://${host}:${process.env.PORT || 3001}`));
  const stop = () => server.close(async () => { await pool.end(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (err) { console.error('서버 시작 실패. .env와 MySQL 실행 상태를 확인해 주세요.', err.code || err.message); await pool.end(); process.exitCode = 1; }
