import { test, expect } from '@playwright/test';
import { createApp } from '../server/src/app.js';

let server, origin;
const song = { id: '1', brand: 'TJ', song_number: '123', title: '가거라 삼팔선', artist: '남인수', youtube_video_id: 'Abc_def-123' };
test.beforeAll(async () => {
  const states = new Map();
  const store = { async listPublic(q, offset, limit) { return [...states.values()].filter(s => s.isPublic === true && `${s.title} ${s.members[0].name}`.includes(q)).slice(offset, offset + limit).map(s => ({ code: s.code, title: s.title, hostName: s.members[0].name, memberCount: s.members.length })); }, async create(code, state) { states.set(code, state); }, async transact(code, fn) { const state = states.get(code); if (!state) throw Object.assign(new Error('방이 종료되었습니다.'), { status: 404 }); const result = await fn(state); if (state.closed) states.delete(code); return result; } };
  server = createApp({ repository: { getSong: async () => song, getSongsByKeys: async () => [{ brand: 'KY', song_key: 'KY:n:101', song_number: '101', title: song.title, artist: song.artist, youtube_video_id: '7JDG2kxepz8' }], list: async () => ({ songs: [song], total: 1 }) }, roomStore: store, adminToken: 'room-browser-admin-token-at-least-24', staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  // Polling clients can leave pooled HTTP connections alive during teardown.
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
async function setup(context) {
  await context.route('**/api/**', async route => { const url = new URL(route.request().url()); const response = await route.fetch({ url: origin + url.pathname + url.search }); await route.fulfill({ response }); });
  await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `window.YT={PlayerState:{PLAYING:1,ENDED:0},Player:class {constructor(node,o){this.o=o;window.testPlayer=this;window.testVideoId=o.videoId;node.innerHTML='<div>공동 플레이어</div>';setTimeout(()=>o.events.onReady({target:this}),0)}playVideo(){this.o.events.onStateChange({data:1})}pauseVideo(){this.o.events.onStateChange({data:2})}destroy(){}}};window.onYouTubeIframeAPIReady();` }));
}

test('Reservation confirmation appears after room success and pending clicks cannot duplicate requests', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let session;
  try {
    const response = await fetch(origin + '/api/rooms/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '예약 확인' }) });
    const created = await response.json();
    session = { code: created.room.code, token: created.token };
    await setup(context);
    await context.addInitScript(value => sessionStorage.setItem('tj.room', JSON.stringify(value)), session);
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByLabel('현재 방', { exact: true })).toContainText(session.code);
    const reserve = page.getByRole('button', { name: '가거라 삼팔선 예약', exact: true });
    await reserve.click();
    await expect(page.locator('.queue-list li')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('예약했어요');
    await expect(reserve.locator('svg')).toBeVisible();
    await expect(reserve).toHaveClass(/reserved/);
    await expect(reserve).toBeEnabled();
    await expect(page.locator('.toast')).toHaveCount(0);
    let release, requests = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const actions = '**/api/rooms/*/actions';
    await page.route(actions, async route => {
      if (route.request().postDataJSON().action === 'reserve') { requests++; await gate; }
      await route.fallback();
    });
    await reserve.click();
    await expect(reserve).toBeDisabled();
    await expect(reserve).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.toast')).toHaveCount(0);
    await reserve.evaluate(button => { button.click(); button.click(); });
    expect(requests).toBe(1);
    release();
    await expect(page.locator('.queue-list li')).toHaveCount(2);
    await expect(page.locator('.toast')).toContainText('가거라 삼팔선');
    await expect(page.locator('.toast')).toContainText('예약했어요');
    await expect(reserve).toBeEnabled();
    // A rejected request must stay retryable and never show success.
    await page.unroute(actions);
    await page.route(actions, route => route.request().postDataJSON().action === 'reserve'
      ? route.fulfill({ status: 409, json: { error: '테스트 예약 실패' } }) : route.fallback());
    await reserve.click();
    await expect(page.locator('.toast')).toContainText('예약하지 못했습니다');
    await expect(reserve).toBeEnabled();
    await expect(reserve).not.toHaveClass(/reserved/);
    await expect(page.locator('.queue-list li')).toHaveCount(2);
    await page.unroute(actions);
    await reserve.click();
    await expect(page.locator('.queue-list li')).toHaveCount(3);
    await expect(page.locator('.toast')).toContainText('예약했어요');
  } finally {
    await context.close();
    if (session) await fetch(`${origin}/api/rooms/${session.code}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action: 'close' }) });
  }
});

test('Queue voting syncs across members, supports keyboard selection and leaves the host in control', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let code, hostToken;
  async function call(path, body, token) {
    const response = await fetch(origin + '/api/rooms' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(response.ok).toBe(true);
    return response.json();
  }
  try {
    const created = await call('/', { nickname: '투표 방장' });
    code = created.room.code; hostToken = created.token;
    const joined = await call(`/${code}/join`, { nickname: '투표 친구' });
    for (let i = 0; i < 3; i++) await call(`/${code}/actions`, { action: 'reserve', songId: '1' }, hostToken);
    await setup(hostContext); await setup(guestContext);
    await hostContext.addInitScript(session => sessionStorage.setItem('tj.room', JSON.stringify(session)), { code, token: hostToken });
    await guestContext.addInitScript(session => sessionStorage.setItem('tj.room', JSON.stringify(session)), { code, token: joined.token });
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    await host.goto('/'); await guest.goto('/');
    const hostRows = host.locator('.queue-list li'), guestRows = guest.locator('.queue-list li');
    await expect(hostRows).toHaveCount(3); await expect(guestRows).toHaveCount(3);
    await expect(guest.getByRole('button', { name: /다음 곡으로 지정/ })).toHaveCount(0);
    const vote = guestRows.nth(1).getByRole('button', { name: /다음 곡 투표/ });
    await vote.focus(); await guest.keyboard.press('Space');
    await expect(vote).toHaveAttribute('aria-pressed', 'true');
    await expect(hostRows.nth(1).locator('.queue-vote-button')).toContainText('1표');
    await expect(hostRows.first().locator('.queue-vote-button')).toContainText('0표');
    await guest.reload();
    await expect(guestRows.nth(1).locator('.queue-vote-button')).toHaveAttribute('aria-pressed', 'true');
    // Another click cancels, while choosing a different reservation moves the vote.
    await guestRows.nth(1).locator('.queue-vote-button').click();
    await expect(guestRows.nth(1).locator('.queue-vote-button')).toHaveAttribute('aria-pressed', 'false');
    await guestRows.first().locator('.queue-vote-button').click();
    await guestRows.nth(1).locator('.queue-vote-button').click();
    await expect(guestRows.first().locator('.queue-vote-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(guestRows.nth(1).locator('.queue-vote-button')).toHaveAttribute('aria-pressed', 'true');
    await hostRows.nth(1).getByRole('button', { name: /다음 곡으로 지정/ }).click();
    await expect(guestRows.first().locator('.queue-vote-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(host.getByRole('button', { name: '노래 시작하기' })).toBeVisible();
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const box = await page.locator('.queue-vote-button').first().boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await host.locator('#queue').screenshot({ path: 'test-results/queue-voting-host-mobile.png' });
    await guest.locator('#queue').screenshot({ path: 'test-results/queue-voting-guest-mobile.png' });
    await host.getByRole('button', { name: '노래 시작하기' }).click();
    await expect(hostRows).toHaveCount(2);
    await expect(guest.locator('.queue-vote-button[aria-pressed="true"]')).toHaveCount(0);
    await expect(host.getByRole('button', { name: '일시정지', exact: true })).toBeEnabled();
    await hostRows.nth(1).getByRole('button', { name: /다음 곡으로 지정/ }).click();
    await expect(host.getByRole('button', { name: '일시정지', exact: true })).toBeEnabled();
  } finally {
    await hostContext.close(); await guestContext.close();
    if (code) await call(`/${code}/actions`, { action: 'close' }, hostToken);
  }
});
test('Host and guest share queue, restore sessions, restrict playback and clean up microphone on close', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await setup(hostContext); await setup(guestContext);
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    // Use a generated audio stream; this checks routing lifecycle, not USB hardware.
    await host.addInitScript(() => {
      navigator.share = async data => { window.sharedInvitation = data; };
      navigator.clipboard.writeText = async text => { window.copiedInvitation = text; };
      navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const oscillator = c.createOscillator(); const output = c.createMediaStreamDestination(); oscillator.connect(output); oscillator.start(); window.mockMic = output.stream; window.mockSource = c; return output.stream; };
      navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'usb-test', label: 'USB 테스트 마이크' }];
    });
    await host.goto('/'); await guest.goto('/');
    await host.getByRole('button', { name: '방 관리 열기', exact: true }).click();
    await host.getByLabel('방 닉네임').fill('방장'); await host.getByRole('button', { name: '새 방 만들기' }).click();
    const code = await host.locator('.room-code').innerText();
    const invitation = await host.getByLabel('초대 링크', { exact: true }).inputValue();
    expect(new URL(invitation).search).toBe(`?room=${code}`);
    await expect(host.getByRole('button', { name: '카카오톡으로 초대' })).toHaveCount(0);
    await expect(host.locator('#room-dialog-title')).toContainText('방장의 노래방');
    await expect(host.locator('.room-members')).toContainText('방장 (방장)');
    await host.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
    expect(await host.evaluate(() => window.copiedInvitation)).toBe(invitation);
    await guest.goto(invitation);
    await expect(guest.getByLabel('방 코드', { exact: true })).toHaveValue(code);
    await guest.getByLabel('방 닉네임').fill('친구'); await guest.getByRole('button', { name: '방 입장' }).click();
    await host.getByRole('button', { name: '방 관리 닫기', exact: true }).click();
    await guest.getByRole('button', { name: '방 관리 닫기', exact: true }).click();
    await guest.getByRole('button', { name: '가거라 삼팔선 예약', exact: true }).click();
    await expect(host.locator('.queue-list li')).toHaveCount(1);
    await expect(guest.getByRole('button', { name: '노래 시작하기' })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '가거라 삼팔선 예약 취소' })).toHaveCount(0);
    await host.getByRole('button', { name: '노래 시작하기' }).click();
    await expect(host.locator('.now-title h2')).toHaveText(song.title);
    await host.evaluate(() => window.testPlayer.o.events.onError({ data: 150 }));
    await expect(host.getByText('금영 KY 101 영상으로 대체 재생합니다.', { exact: false })).toBeVisible();
    expect(await host.evaluate(() => window.testVideoId)).toBe('7JDG2kxepz8');
    await expect(guest.getByText('금영 KY 101 대체 영상', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(guest.getByText('재생 상태: 재생 중')).toBeVisible({ timeout: 10000 });
    await expect(guest.locator('.youtube-host')).toHaveCount(0);
    await host.getByRole('button', { name: '일시정지', exact: true }).click();
    await expect(guest.getByText('재생 상태: 일시정지')).toBeVisible({ timeout: 10000 });
    await guest.reload(); await expect(guest.locator('.room-code')).toHaveText(code);
    await guest.getByRole('button', { name: '방 관리 닫기', exact: true }).click();
    await host.reload(); await expect(host.getByLabel('현재 방', { exact: true })).toContainText(code);
    await expect(host.locator('.now-title h2')).toHaveText(song.title);
    await expect(host.getByText('금영 KY 101 영상으로 대체 재생합니다.', { exact: false })).toBeVisible();
    await host.getByRole('button', { name: '마이크 켜기', exact: true }).click();
    await expect(host.getByRole('button', { name: '마이크 끄기', exact: true })).toBeVisible();
    await host.getByLabel('마이크 볼륨', { exact: true }).fill('0.2'); await host.getByLabel('에코', { exact: true }).fill('0.25');
    await host.getByRole('button', { name: '마이크 끄기', exact: true }).click();
    expect(await host.evaluate(() => window.mockMic.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    await host.getByLabel('입력 마이크', { exact: true }).selectOption('usb-test');
    await host.getByRole('button', { name: '마이크 켜기', exact: true }).click();
    await expect(host.getByRole('button', { name: '마이크 끄기', exact: true })).toBeVisible();
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await host.getByRole('button', { name: '방 관리 열기', exact: true }).click();
    host.once('dialog', d => d.accept()); await host.getByRole('button', { name: '방 종료', exact: true }).click();
    await expect(host.getByRole('button', { name: '새 방 만들기' })).toBeVisible();
    expect(await host.evaluate(() => window.mockMic.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    await expect(guest.getByLabel('현재 방', { exact: true })).toHaveCount(0, { timeout: 10000 });
    await expect(guest.getByRole('alert')).toContainText('방이 종료되었습니다.');
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('Personal playback falls back once and retains the original TJ identity', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await setup(context); const page = await context.newPage(); let lookups = 0;
    page.on('request', req => { if (req.url().includes('/songs/1/fallback')) lookups++; });
    await page.goto('/'); await page.getByRole('button', { name: '가거라 삼팔선 예약', exact: true }).click();
    await page.getByRole('button', { name: '노래 시작하기' }).click();
    await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeEnabled();
    await page.evaluate(() => window.testPlayer.o.events.onError({ data: 101 }));
    await expect(page.getByText('금영 KY 101 영상으로 대체 재생합니다.', { exact: false })).toBeVisible();
    await expect(page.locator('.now-title .small-label')).toHaveText('TJ 123');
    expect(await page.evaluate(() => window.testVideoId)).toBe('7JDG2kxepz8');
    await page.evaluate(() => window.testPlayer.o.events.onError({ data: 150 }));
    await expect(page.getByRole('alert')).toContainText('이 영상은 외부 재생을 허용하지 않습니다.');
    await expect(page.getByRole('link', { name: 'YouTube에서 열기' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=7JDG2kxepz8');
    expect(lookups).toBe(1);
  } finally { await context.close(); }
});

test('Public rooms can be found and selected, host alone can hide them and private codes still work', async ({ browser }) => {
  const hostContext = await browser.newContext(), guestContext = await browser.newContext();
  try {
    await setup(hostContext); await setup(guestContext);
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    await host.goto('/');
    await host.getByRole('button', { name: '방 관리 열기', exact: true }).click();
    await expect(host.getByLabel('새 방 공개', { exact: true })).toBeChecked();
    await host.getByLabel('방 닉네임').fill('목록 방장');
    await host.getByLabel('새 방 이름').fill('공개 모임 테스트');
    await host.getByRole('button', { name: '새 방 만들기' }).click();
    const code = await host.locator('.room-code').innerText();
    await guest.goto('/'); await guest.getByRole('button', { name: '방 관리 열기', exact: true }).click(); await guest.getByLabel('공개 방 검색').fill('공개 모임');
    await expect(guest.getByRole('button', { name: '공개 모임 테스트 방 선택' })).toBeVisible();
    await host.getByLabel('방 공개', { exact: true }).uncheck();
    await expect(host.getByLabel('방 공개', { exact: true })).not.toBeChecked();
    await guest.getByRole('button', { name: '목록 새로고침' }).click();
    await expect(guest.getByText('검색된 공개 방이 없습니다.')).toBeVisible();
    await host.getByLabel('방 공개', { exact: true }).check();
    await guest.getByRole('button', { name: '목록 새로고침' }).click();
    await guest.getByRole('button', { name: '공개 모임 테스트 방 선택' }).click();
    await expect(guest.getByLabel('방 코드', { exact: true })).toHaveValue(code);
    await host.getByLabel('방 공개', { exact: true }).uncheck();
    await expect(host.getByLabel('방 공개', { exact: true })).not.toBeChecked();
    await guest.getByLabel('방 닉네임').fill('참가자');
    await guest.getByRole('button', { name: '방 입장', exact: true }).click();
    await expect(guest.locator('.room-code')).toHaveText(code);
    await expect(guest.getByLabel('방 공개', { exact: true })).toHaveCount(0);
    host.once('dialog', d => d.accept()); await host.getByRole('button', { name: '방 종료', exact: true }).click();
  } finally { await hostContext.close(); await guestContext.close(); }
});
