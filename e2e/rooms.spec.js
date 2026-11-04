import { test, expect } from '@playwright/test';
import { createApp } from '../server/src/app.js';

let server, origin;
const song = { id: '1', brand: 'TJ', song_number: '123', title: '함께 부르는 노래', artist: '우리', youtube_video_id: 'Abc_def-123' };
test.beforeAll(async () => {
  const states = new Map();
  const store = { async create(code, state) { states.set(code, state); }, async transact(code, fn) { const state = states.get(code); if (!state) throw Object.assign(new Error('방이 종료되었습니다.'), { status: 404 }); const result = await fn(state); if (state.closed) states.delete(code); return result; } };
  server = createApp({ repository: { getSong: async () => song, list: async () => ({ songs: [song], total: 1 }) }, roomStore: store, adminToken: 'room-browser-admin-token-at-least-24', staticDir: '/nonexistent' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function setup(context) {
  await context.route('**/api/**', async route => { const url = new URL(route.request().url()); const response = await route.fetch({ url: origin + url.pathname + url.search }); await route.fulfill({ response }); });
  await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `window.YT={PlayerState:{PLAYING:1,ENDED:0},Player:class {constructor(node,o){this.o=o;window.testPlayer=this;node.innerHTML='<div>공동 플레이어</div>';setTimeout(()=>o.events.onReady({target:this}),0)}playVideo(){this.o.events.onStateChange({data:1})}pauseVideo(){this.o.events.onStateChange({data:2})}destroy(){}}};window.onYouTubeIframeAPIReady();` }));
}
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
    await host.getByLabel('방 닉네임').fill('방장'); await host.getByRole('button', { name: '새 방 만들기' }).click();
    const code = await host.locator('.room-code').innerText();
    const invitation = await host.getByLabel('초대 링크', { exact: true }).inputValue();
    expect(new URL(invitation).search).toBe(`?room=${code}`);
    await host.getByRole('button', { name: '카카오톡으로 초대' }).click();
    expect(await host.evaluate(() => window.sharedInvitation.url)).toBe(invitation);
    await host.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
    expect(await host.evaluate(() => window.copiedInvitation)).toBe(invitation);
    await guest.goto(invitation);
    await expect(guest.getByLabel('방 코드', { exact: true })).toHaveValue(code);
    await guest.getByLabel('방 닉네임').fill('친구'); await guest.getByRole('button', { name: '방 입장' }).click();
    await guest.getByRole('button', { name: '함께 부르는 노래 예약', exact: true }).click();
    await expect(host.locator('.queue-list li')).toHaveCount(1);
    await expect(guest.getByRole('button', { name: '노래 시작하기' })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '함께 부르는 노래 예약 취소' })).toHaveCount(0);
    await host.getByRole('button', { name: '노래 시작하기' }).click();
    await expect(host.locator('.now-title h2')).toHaveText(song.title);
    await expect(guest.getByText('재생 상태: 재생 중')).toBeVisible({ timeout: 10000 });
    await expect(guest.locator('.youtube-host')).toHaveCount(0);
    await host.getByRole('button', { name: '일시정지', exact: true }).click();
    await expect(guest.getByText('재생 상태: 일시정지')).toBeVisible({ timeout: 10000 });
    await guest.reload(); await expect(guest.locator('.room-code')).toHaveText(code);
    await host.reload(); await expect(host.locator('.room-code')).toHaveText(code);
    await expect(host.locator('.now-title h2')).toHaveText(song.title);
    await host.getByRole('button', { name: '마이크 켜기', exact: true }).click();
    await expect(host.getByRole('button', { name: '마이크 끄기', exact: true })).toBeVisible();
    await host.getByLabel('마이크 볼륨', { exact: true }).fill('0.2'); await host.getByLabel('에코', { exact: true }).fill('0.25');
    await host.getByRole('button', { name: '마이크 끄기', exact: true }).click();
    expect(await host.evaluate(() => window.mockMic.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    await host.getByLabel('입력 마이크', { exact: true }).selectOption('usb-test');
    await host.getByRole('button', { name: '마이크 켜기', exact: true }).click();
    await expect(host.getByRole('button', { name: '마이크 끄기', exact: true })).toBeVisible();
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    host.once('dialog', d => d.accept()); await host.getByRole('button', { name: '방 종료', exact: true }).click();
    await expect(host.getByRole('button', { name: '새 방 만들기' })).toBeVisible();
    expect(await host.evaluate(() => window.mockMic.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
    await expect(guest.getByRole('button', { name: '방 입장', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(guest.getByRole('alert')).toContainText('방이 종료되었습니다.');
  } finally { await hostContext.close(); await guestContext.close(); }
});
