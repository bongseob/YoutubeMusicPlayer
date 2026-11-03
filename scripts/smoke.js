import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = process.env.APP_URL || 'http://127.0.0.1:3001';
const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const response = await fetch(`${origin}/api/songs?q=&page=1`);
assert.equal(response.status, 200);
assert.ok(Array.isArray((await response.json()).songs));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin);
  await page.getByRole('heading', { name: '나의 노래 라이브러리' }).waitFor();
  await page.getByRole('button', { name: '곡 관리 열기' }).click();
  await page.getByLabel('관리자 토큰').waitFor();
  await page.getByRole('button', { name: '곡 관리 닫기' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'docs/mobile-running.png', fullPage: true });
  console.log('실행 검증 통과: 프로덕션 웹, 실제 MySQL API, 모바일 화면, 관리자 창, 브라우저 오류 없음.');
} finally { await browser.close(); }
