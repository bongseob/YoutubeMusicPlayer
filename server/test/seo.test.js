import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

test('public pages remain accessible while missing paths return a real 404', async t => {
  const staticDir = await mkdtemp(join(tmpdir(), 'karaoke-seo-'));
  for (const [file, source] of [['index.html', 'web/index.html'], ['guide.html', 'web/public/guide.html'], ['404.html', 'web/public/404.html'], ['robots.txt', 'web/public/robots.txt'], ['sitemap.xml', 'web/public/sitemap.xml']]) {
    await writeFile(join(staticDir, file), await readFile(new URL(`../../${source}`, import.meta.url)));
  }
  const server = createApp({ repository: {}, adminToken: 'test-admin-token-more-than-24-characters', staticDir }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(staticDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(`${base}/?room=ABC123`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /rel="canonical" href="https:\/\/www.kbigstar.kr\/"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /한곡같이/);
  const guide = await fetch(`${base}/guide.html`);
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /친구들과 함께 부르기/);
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Sitemap:/);
  assert.match(await (await fetch(`${base}/sitemap.xml`)).text(), /guide.html/);
  for (const path of ['/missing-page', '/missing.jpg']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /content="noindex"/);
  }
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
});
