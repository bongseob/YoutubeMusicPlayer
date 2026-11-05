import { test, expect } from '@playwright/test';

const songs = [
  { title: '첫 번째 노래', artist: '테스트 가수', tj_number: '00123', youtube_video_id: 'Abc_def-123' },
  { title: '두 번째 노래', artist: '다른 가수', tj_number: '00456', youtube_video_id: 'Bbc_def-123' },
];
test.beforeEach(async ({ page }) => {
  await page.route('**/api/songs?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    const matches = songs.filter(song => `${song.title} ${song.artist} ${song.tj_number}`.includes(query));
    return route.fulfill({ json: { songs: matches, total: matches.length, page: 1, pageSize: 30 } });
  });
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.YT = {PlayerState:{PLAYING:1,ENDED:0},Player:class {
      constructor(node, options){this.options=options;window.testPlayer=this;node.innerHTML='<div>테스트 플레이어</div>';setTimeout(()=>options.events.onReady({target:this}),0)}
      playVideo(){this.options.events.onStateChange({data:1})} pauseVideo(){this.options.events.onStateChange({data:2})} destroy(){}
    }};window.onYouTubeIframeAPIReady();
  ` }));
  await page.goto('/');
});
test('Mobile search, favorite, queue reorder/remove, persistence and player completion', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '오늘의 기분을, 한 곡에.' })).toBeVisible();
  await page.getByRole('button', { name: '첫 번째 노래 즐겨찾기 추가' }).click();
  await page.getByRole('button', { name: '첫 번째 노래 예약', exact: true }).click();
  await page.getByRole('button', { name: '두 번째 노래 예약', exact: true }).click();
  await page.getByRole('button', { name: '두 번째 노래 위로' }).click();
  await expect(page.locator('.queue-list li').first()).toContainText('두 번째 노래');
  await page.reload();
  await expect(page.locator('.queue-list li')).toHaveCount(2);
  await page.getByRole('button', { name: '첫 번째 노래 예약 취소' }).click();
  await page.getByRole('button', { name: '첫 번째 노래 예약', exact: true }).click();
  await page.getByRole('button', { name: '노래 시작하기' }).click();
  await expect(page.locator('.now-title h2')).toHaveText('두 번째 노래');
  await expect(page.getByRole('button', { name: '일시정지', exact: true })).toBeEnabled();
  await page.evaluate(() => window.testPlayer.options.events.onStateChange({ data: 0 }));
  await expect(page.locator('.now-title h2')).toHaveText('첫 번째 노래');
  await page.evaluate(() => window.testPlayer.options.events.onAutoplayBlocked());
  await expect(page.getByText('자동재생이 제한되었습니다.', { exact: false })).toBeVisible();
  await page.evaluate(() => window.testPlayer.options.events.onError({ data: 150 }));
  await expect(page.getByText('이 영상은 외부 재생을 허용하지 않습니다.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: /즐겨찾기/ }).click();
  await expect(page.locator('.song-row')).toHaveCount(1);
  await page.getByRole('tab', { name: '노래 찾기' }).click();
  await page.getByRole('textbox', { name: '곡 검색' }).fill('00456');
  await expect(page.locator('.song-row')).toHaveCount(1);
  await expect(page.locator('.song-row')).toContainText('두 번째 노래');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Admin link registration, CSV error report, token forgotten when closed', async ({ page }) => {
  await page.route('**/api/admin/songs', async route => {
    expect(route.request().headers().authorization).toBe('Bearer test-token');
    expect(route.request().postDataJSON().title).toBe('등록 테스트');
    await route.fulfill({ json: { created: 1, updated: 0 } });
  });
  await page.route('**/api/admin/import', route => route.fulfill({ status: 400, json: { error: '오류가 있어 가져오지 않았습니다.', details: [{ row: 2, message: '잘못된 영상 링크' }] } }));
  await page.getByRole('button', { name: '곡 관리 열기' }).click();
  await page.getByLabel('관리자 토큰').fill('test-token');
  await page.getByLabel('YouTube 링크 또는 영상 ID').fill('Abc_def-123');
  await page.getByLabel('노래 제목').fill('등록 테스트');
  await page.getByRole('button', { name: '곡 저장하기' }).click();
  await expect(page.locator('.admin-dialog .success-box')).toContainText('새 곡 1개 등록');
  await page.getByRole('button', { name: 'CSV 가져오기', exact: true }).first().click();
  await page.getByLabel('CSV 파일', { exact: true }).setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('title,youtube_url\n오류,bad') });
  await page.getByRole('button', { name: 'CSV 가져오기', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('데이터 행 2');
  await page.getByRole('button', { name: '곡 관리 닫기' }).click();
  await page.getByRole('button', { name: '곡 관리 열기' }).click();
  await expect(page.getByLabel('관리자 토큰')).toHaveValue('');
});
test('Empty catalogue and connection failure remain actionable', async ({ page }) => {
  await page.route('**/api/songs?**', route => route.fulfill({ json: { songs: [], total: 0 } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: '첫 번째 노래를 담아 보세요' })).toBeVisible();
  await page.screenshot({ path: 'docs/mobile-empty.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'docs/desktop-empty.png', fullPage: true });
  await page.route('**/api/songs?**', route => route.fulfill({ status: 503, json: { error: 'DB 연결 실패' } }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('DB 연결 실패');
  await expect(page.getByRole('button', { name: '다시 연결' })).toBeVisible();
});

test('Same-number metadata rows keep separate favorites and connect a KY video', async ({ page }) => {
  const metadata = [
    { brand: 'TJ', song_number: '123', title: '태진 테스트곡', artist: '가수', youtube_video_id: null },
    { brand: 'KY', song_number: '123', title: '금영 테스트곡', artist: '가수', youtube_video_id: null },
  ];
  await page.route('**/api/songs?**', route => route.fulfill({ json: { songs: metadata, total: 2 } }));
  await page.reload();
  await expect(page.getByRole('button', { name: '태진 테스트곡 예약', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '금영 테스트곡 예약', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '태진 테스트곡 즐겨찾기 추가' }).click();
  await page.getByRole('button', { name: '금영 테스트곡 즐겨찾기 추가' }).click();
  await page.getByRole('tab', { name: /즐겨찾기/ }).click();
  await expect(page.locator('.song-row')).toHaveCount(2);
  await page.reload();
  await page.getByRole('tab', { name: /즐겨찾기/ }).click();
  await expect(page.locator('.song-row')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/api/admin/songs', async route => {
    const body = route.request().postDataJSON();
    expect(body.brand).toBe('KY');
    expect(body.song_number).toBe('123');
    metadata[1] = { ...metadata[1], youtube_video_id: body.youtube_url };
    await route.fulfill({ json: { created: 0, updated: 1, song: metadata[1] } });
  });
  await page.getByRole('button', { name: '금영 테스트곡 영상 연결' }).click();
  await expect(page.getByLabel('브랜드', { exact: true })).toHaveValue('KY');
  await expect(page.getByLabel('곡 번호', { exact: true })).toHaveValue('123');
  await page.getByLabel('관리자 토큰').fill('test-token');
  await page.getByLabel('YouTube 링크 또는 영상 ID').fill('Abc_def-123');
  await page.getByRole('button', { name: '곡 저장하기' }).click();
  await expect(page.locator('.admin-dialog .success-box')).toContainText('기존 1개 처리');
  await page.getByRole('button', { name: '곡 관리 닫기' }).click();
  await expect(page.getByRole('button', { name: '금영 테스트곡 예약', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '태진 테스트곡 예약', exact: true })).toBeDisabled();
});

test('Room management opens as a focused modal and returns focus when dismissed', async ({ page }) => {
  await page.route('**/api/rooms/?**', route => route.fulfill({ json: { rooms: [], hasMore: false, page: 1 } }));
  await expect(page.getByLabel('방 닉네임')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '방 찾기', exact: true })).toHaveCount(0);
  const opener = page.getByRole('button', { name: '방 관리 열기', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog', { name: '방 관리', exact: true })).toBeVisible();
  await expect(page.getByLabel('방 닉네임')).toBeFocused();
  await page.screenshot({ path: 'test-results/room-management.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '방 관리', exact: true })).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click(); await page.getByRole('button', { name: '방 관리 닫기', exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click(); await page.mouse.click(1, 1);
  await expect(page.getByRole('dialog', { name: '방 관리', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
