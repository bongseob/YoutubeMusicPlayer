import dotenv from 'dotenv';
import { mkdir, readFile, writeFile, rename, appendFile, open, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createPool } from '../server/src/db.js';
import { CHANNELS, catalogIndex, matchVideo, chooseCandidate, scanChannel } from './youtube-catalog.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const args = process.argv.slice(2);
const plan = args.includes('--plan'), apply = args.includes('--apply');
const allowMR = args.includes('--allow-mr');
const searchBackfill = args.includes('--search-backfill');
const option = (name, fallback) => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const budget = Number(option('--max-requests', '9000'));
const region = option('--region', 'KR').toUpperCase();
const cacheDir = resolve(option('--cache-dir', '.local/youtube-sync'));
const key = process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY;
const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const statePath = `${cacheDir}/state.json`, videosPath = `${cacheDir}/videos.jsonl`;
let pool, lock;
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function main() {
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000 || !/^[A-Z]{2}$/.test(region)) throw new Error('실행 옵션을 확인하세요. 요청 한도: 1~10,000, 지역: KR 등의 국가 코드.');
  if (!plan && !key) throw new Error('.env의 YOUTUBE_DATA_API_KEY가 비어 있습니다. 키를 설정한 뒤 다시 실행하세요. 키 없이 npm run videos:plan 으로 준비 상태를 확인할 수 있습니다.');
  pool = createPool();
  const [songs] = await pool.query('SELECT * FROM karaoke_songs ORDER BY brand, song_number, id');
  const existing = songs.filter(song => song.youtube_video_id).length;
  await mkdir(cacheDir, { recursive: true });
  if (plan) {
    const report = { total: songs.length, alreadyLinked: existing, unlinked: songs.length - existing,
      youtubeKeyConfigured: !!key, channels: CHANNELS, requestBudget: budget,
      method: 'channels.list → uploads playlist → playlistItems.list(50) → videos.list(50)',
      writesToDatabase: false, guaranteesAllSongsHaveVideos: false };
    await writeFile(`${cacheDir}/plan.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  try { lock = await open(`${cacheDir}/run.lock`, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('같은 캐시에서 영상 대조가 이미 실행 중입니다. 중단된 작업이면 실행 프로세스 확인 후 run.lock을 정리하세요.'); throw error; }
  await lock.writeFile(String(process.pid));
  const state = await readJson(statePath, { version: 1, startedAt: new Date().toISOString(), channels: {}, requests: {} });
  if (state.version !== 1) throw new Error('캐시 버전이 다릅니다. 새 --cache-dir을 지정하세요.');
  if (Date.now() - Date.parse(state.startedAt) > 29 * 86400000) throw new Error('캐시가 29일을 넘었습니다. 이전 API 캐시를 정리하고 새 --cache-dir에서 다시 조회하세요.');
  let saveTail = Promise.resolve(), appendTail = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(state, null, 2) + '\n';
    const next = saveTail.then(async () => { await writeFile(`${statePath}.tmp`, snapshot); await rename(`${statePath}.tmp`, statePath); });
    saveTail = next.catch(() => {});
    return next;
  }
  function append(items, source) {
    const text = JSON.stringify({ brand: source.brand, items }) + '\n';
    const next = appendTail.then(() => appendFile(videosPath, text));
    appendTail = next.catch(() => {});
    return next;
  }
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  async function api(resource, parameters) {
    const today = day();
    if (resource === 'search') {
      state.searchRequests ||= {};
      if ((state.searchRequests[today] || 0) >= 100) { const error = new Error('오늘의 영상 검색 한도 100회에 도달했습니다. 다음 할당량 날짜에 같은 명령으로 이어서 조회할 수 있습니다.'); error.code = 'search_limit'; throw error; }
    }
    if ((state.requests[today] || 0) >= budget) { const error = new Error('설정한 일일 요청 한도에 도달했습니다.'); error.code = 'quota'; throw error; }
    if (resource === 'search') state.searchRequests[today] = (state.searchRequests[today] || 0) + 1;
    state.requests[today] = (state.requests[today] || 0) + 1;
    await save();
    const url = `https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams(parameters)}`;
    let response;
    try { response = await fetch(url, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('YouTube API 네트워크 연결에 실패했습니다. 저장된 위치에서 재실행할 수 있습니다.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      const error = new Error(`YouTube API 요청 실패: HTTP ${response.status}${/^[A-Za-z]+$/.test(reason || '') ? ` (${reason})` : ''}. 키의 API 활성화·사용 제한·할당량을 확인하세요.`);
      error.httpStatus = response.status;
      if (['quotaExceeded', 'dailyLimitExceeded', 'dailyLimitExceededUnreg'].includes(reason)) error.code = 'quota';
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    return data;
  }
  let stopReason = null;
  {
    const scans = await Promise.allSettled(CHANNELS.map(async channel => {
      const progress = state.channels[channel.brand] ||= { id: channel.id, complete: false, pages: 0 };
      if (progress.id !== channel.id) throw new Error('캐시 채널 ID가 설정과 다릅니다.');
      await scanChannel({ channel, state: progress, api, save,
        append,
        progress: (source, snapshot, count) => console.log(`${source.brand}: ${snapshot.pages}페이지 저장 (${count}영상), ${snapshot.complete ? '채널 조회 완료' : '계속 조회 중'}`),
      });
    }));
    const failures = scans.filter(result => result.status === 'rejected');
    if (failures.length) { stopReason = failures.map(result => result.reason.message).join('; '); await save(); }
  }
  // The uploads endpoint may terminate before the channel's public video count.
  // Enumerate every public playlist as a supplemental, explicitly scoped source.
  const cachedIds = new Set(), channelIdsSeen = new Map(CHANNELS.map(channel => [channel.id, new Set()])), uploadCutoffs = new Map();
  async function readCached(consume) {
    try {
      for await (const line of createInterface({ input: createReadStream(videosPath), crlfDelay: Infinity })) {
        if (line.trim()) for (const video of JSON.parse(line).items) consume(video);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await readCached(video => {
    cachedIds.add(video.id);
    const ids = channelIdsSeen.get(video.snippet?.channelId);
    if (video.status?.privacyStatus === 'public') ids?.add(video.id);
    if (ids && ids.size <= 20000 && video.snippet.publishedAt && (!uploadCutoffs.has(video.snippet.channelId) || video.snippet.publishedAt < uploadCutoffs.get(video.snippet.channelId))) uploadCutoffs.set(video.snippet.channelId, video.snippet.publishedAt);
  });
  state.publicPlaylists ||= {};
  state.archiveTasks ||= {};
  if (!stopReason) {
    try {
      const statistics = await api('channels', { part: 'statistics,snippet', id: CHANNELS.map(channel => channel.id).join(',') });
      state.publicVideoCounts = Object.fromEntries((statistics.items || []).map(channel => [channel.id, Number(channel.statistics?.videoCount || 0)]));
      state.channelCreatedAt = Object.fromEntries((statistics.items || []).map(channel => [channel.id, channel.snippet?.publishedAt]));
      const discoveries = await Promise.allSettled(CHANNELS.map(async channel => {
        const listing = state.publicPlaylists[channel.brand] ||= { items: {}, complete: false };
        while (!listing.complete) {
          const data = await api('playlists', { part: 'snippet,contentDetails', channelId: channel.id, maxResults: '50', ...(listing.nextPageToken ? { pageToken: listing.nextPageToken } : {}) });
          if (!Array.isArray(data.items)) throw new Error('Invalid public playlist response');
          for (const playlist of data.items) {
            if (playlist.snippet?.channelId !== channel.id) continue;
            listing.items[playlist.id] = { id: playlist.id, title: playlist.snippet.title, count: playlist.contentDetails?.itemCount || 0 };
          }
          listing.nextPageToken = data.nextPageToken || null;
          listing.complete = !data.nextPageToken;
          await save();
        }
        console.log(`${channel.brand}: 공개 재생목록 ${Object.keys(listing.items).length}개 발견`);
      }));
      const discoveryFailures = discoveries.filter(result => result.status === 'rejected');
      if (discoveryFailures.length) throw discoveryFailures[0].reason;
      const tasks = CHANNELS.flatMap(channel => Object.values(state.publicPlaylists[channel.brand].items).map(playlist => ({ channel, playlist }))).sort((a, b) => b.playlist.count - a.playlist.count);
      let cursor = 0, archiveFailure;
      async function archiveWorker() {
        while (cursor < tasks.length && !archiveFailure) {
          const { channel, playlist } = tasks[cursor++];
          const task = state.archiveTasks[playlist.id] ||= { playlistId: playlist.id, brand: channel.brand, complete: playlist.count === 0, pages: 0 };
          if (task.complete || task.unavailable) continue;
          try {
            await scanChannel({ channel, state: task, save,
              api: async (resource, parameters) => {
                if (resource !== 'videos') return api(resource, parameters);
                const ids = parameters.id.split(',').filter(id => !cachedIds.has(id));
                return ids.length ? api(resource, { ...parameters, id: ids.join(',') }) : { items: [] };
              },
              append: async (items, source) => {
                await append(items, source);
                for (const video of items) { cachedIds.add(video.id); if (video.status?.privacyStatus === 'public') channelIdsSeen.get(video.snippet?.channelId)?.add(video.id); }
              },
            });
            console.log(`${channel.brand}: 재생목록 완료 (${cursor}/${tasks.length}) ${playlist.title}`);
          } catch (error) {
            if ([403, 404].includes(error.httpStatus) && error.code !== 'quota') { task.unavailable = error.message; await save(); }
            else archiveFailure = error;
          }
        }
      }
      await Promise.all([archiveWorker(), archiveWorker(), archiveWorker(), archiveWorker()]);
      if (archiveFailure) throw archiveFailure;
    } catch (error) { stopReason = error.message; await save(); }
  }
  const scopeComplete = channel => state.channels[channel.brand]?.complete && state.publicPlaylists[channel.brand]?.complete &&
    Object.keys(state.publicPlaylists[channel.brand]?.items || {}).every(id => state.archiveTasks[id]?.complete || state.archiveTasks[id]?.unavailable);
  if (searchBackfill && !stopReason) {
    state.searchWindows ||= [];
    if (!state.searchWindows.length) {
      for (const channel of CHANNELS) {
        const start = Date.parse(state.channelCreatedAt[channel.id]);
        const end = Date.parse(uploadCutoffs.get(channel.id)) + 1000;
        if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('과거 검색 기간을 확인할 수 없습니다.');
        for (let year = new Date(start).getUTCFullYear(); year <= new Date(end).getUTCFullYear(); year++) {
          const from = Math.max(start, Date.UTC(year, 0, 1)), until = Math.min(end, Date.UTC(year + 1, 0, 1));
          if (from < until) state.searchWindows.push({ brand: channel.brand, from, until, depth: 0, pages: 0 });
        }
      }
      await save();
    }
    try {
      while (true) {
        const window = state.searchWindows.filter(item => !item.complete && !item.split).sort((a, b) => a.depth - b.depth || a.pages - b.pages || a.from - b.from)[0];
        if (!window) break;
        const channel = CHANNELS.find(item => item.brand === window.brand);
        if (!window.pending) {
          const data = await api('search', { part: 'snippet', type: 'video', channelId: channel.id, maxResults: '50',
            videoEmbeddable: 'true', publishedAfter: new Date(window.from).toISOString(), publishedBefore: new Date(window.until).toISOString(),
            ...(window.nextPageToken ? { pageToken: window.nextPageToken } : {}) });
          if (!Array.isArray(data.items)) throw new Error('Invalid search response');
          window.pending = { ids: data.items.filter(item => item.snippet?.channelId === channel.id).map(item => item.id?.videoId).filter(id => /^[\w-]{11}$/.test(id || '')),
            nextPageToken: data.nextPageToken || null, total: Number(data.pageInfo?.totalResults || 0) };
          await save();
        }
        const pending = window.pending;
        const ids = pending.ids.filter(id => !cachedIds.has(id));
        const data = ids.length ? await api('videos', { part: 'snippet,status,contentDetails', id: ids.join(',') }) : { items: [] };
        if (!Array.isArray(data.items)) throw new Error('Invalid backfill video response');
        const items = data.items.map(video => ({ ...video, checkedAt: new Date().toISOString() }));
        await append(items, channel);
        for (const video of items) { cachedIds.add(video.id); if (video.status?.privacyStatus === 'public') channelIdsSeen.get(video.snippet?.channelId)?.add(video.id); }
        window.pages++;
        if ((pending.total > 450 || window.pages >= 10) && window.until - window.from > 1000) {
          // Split date ranges before the search endpoint's 500-result ceiling.
          const middle = Math.floor((window.from + window.until) / 2);
          state.searchWindows.push({ brand: window.brand, from: window.from, until: middle, depth: window.depth + 1, pages: 0 },
            { brand: window.brand, from: middle, until: window.until, depth: window.depth + 1, pages: 0 });
          window.split = true;
        } else { window.nextPageToken = pending.nextPageToken; window.complete = !pending.nextPageToken; }
        delete window.pending;
        await save();
        console.log(`${channel.brand}: 과거 검색 ${state.searchRequests[day()]}/100회, 신규 영상 ${items.length}개 저장`);
      }
    } catch (error) { stopReason = error.message; await save(); }
  }
  const index = catalogIndex(songs), candidates = new Map(), review = new Map(), videoReasons = {}, seen = new Set();
  try {
    for await (const line of createInterface({ input: createReadStream(videosPath), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const page = JSON.parse(line), channel = CHANNELS.find(item => item.brand === page.brand);
      if (!channel) throw new Error('알 수 없는 캐시 채널입니다.');
      for (const video of page.items) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        const result = matchVideo(channel, video, index, region, { allowMR });
        if (result.song_key) candidates.set(result.song_key, chooseCandidate(candidates.get(result.song_key), result));
        else {
          videoReasons[result.reason] = (videoReasons[result.reason] || 0) + 1;
          for (const songKey of result.reviewKeys || []) {
            if (!review.has(songKey)) review.set(songKey, new Set());
            review.get(songKey).add(result.reason);
          }
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (Object.values(state.channels).some(channel => channel.pages > 0)) throw new Error('저장된 영상 캐시가 없습니다. 새 --cache-dir로 다시 조회하세요.');
  }
  const verified = songs.filter(song => !song.youtube_video_id && candidates.has(song.song_key));
  const beforeApply = JSON.stringify({ date: new Date().toISOString(), songs: verified.map(song => ({ before: song, candidate: candidates.get(song.song_key) })) }, null, 2) + '\n';
  await mkdir(`${cacheDir}/history`, { recursive: true });
  await writeFile(`${cacheDir}/history/${new Date().toISOString().replaceAll(':', '-')}-before-apply.json`, beforeApply);
  await writeFile(`${cacheDir}/before-apply.json`, beforeApply);
  const applied = new Set();
  if (apply && verified.length) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const song of verified) {
        const candidate = candidates.get(song.song_key);
        const [result] = await connection.execute('UPDATE karaoke_songs SET youtube_video_id=?, source_url=? WHERE song_key=? AND youtube_video_id IS NULL AND title=? AND artist=?',
          [candidate.videoId, candidate.source_url, song.song_key, song.title, song.artist]);
        if (result.affectedRows === 1) applied.add(song.song_key);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  const [currentRows] = await pool.query('SELECT song_key, youtube_video_id FROM karaoke_songs');
  const current = new Map(currentRows.map(song => [song.song_key, song.youtube_video_id]));
  const statusCounts = {};
  const lines = ['brand,song_number,title,artist,youtube_url,status,reason,video_variant'];
  for (const song of songs) {
    const candidate = candidates.get(song.song_key), videoId = current.get(song.song_key);
    let status = videoId ? 'linked' : candidate ? 'verified_candidate' : review.has(song.song_key) ? 'needs_review' : scopeComplete(CHANNELS.find(channel => channel.brand === song.brand)) ? 'not_found_in_indexed_public_videos' : 'pending_scan';
    const reason = review.has(song.song_key) && !videoId ? [...review.get(song.song_key)].join(';') : '';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    lines.push([song.brand, song.song_number, song.title, song.artist, videoId ? `https://www.youtube.com/watch?v=${videoId}` : candidate?.source_url || '', status, reason, candidate && (!videoId || videoId === candidate.videoId) ? candidate.variant : videoId ? 'existing' : ''].map(csv).join(','));
  }
  await writeFile(`${cacheDir}/all-songs-status.csv`, '\uFEFF' + lines.join('\r\n') + '\r\n');
  const fields = ['brand', 'song_number', 'title', 'artist', 'youtube_url'];
  await writeFile(`${cacheDir}/matched-import.csv`, '\uFEFF' + [fields.join(','), ...verified.map(song => [song.brand, song.song_number, song.title, song.artist, candidates.get(song.song_key).source_url].map(csv).join(','))].join('\r\n') + '\r\n');
  const coverage = CHANNELS.map(channel => ({ brand: channel.brand, publicVideoCount: state.publicVideoCounts?.[channel.id] || null,
    uniqueVideosIndexed: channelIdsSeen.get(channel.id).size,
    publicPlaylists: Object.keys(state.publicPlaylists[channel.brand]?.items || {}).length,
    unavailablePlaylists: Object.values(state.archiveTasks).filter(task => task.brand === channel.brand && task.unavailable).length }));
  const backfillComplete = !searchBackfill || state.searchWindows.every(window => window.complete || window.split);
  const report = { checkedAt: new Date().toISOString(), scanComplete: CHANNELS.every(scopeComplete) && backfillComplete,
    scope: searchBackfill ? 'public_uploads_public_playlists_and_date_search' : 'public_uploads_and_channel_public_playlists', coverage,
    allPublicVideosCovered: coverage.every(channel => channel.publicVideoCount > 0 && channel.uniqueVideosIndexed >= channel.publicVideoCount),
    allCatalogSongsLinked: statusCounts.linked === songs.length,
    stopReason, uniqueVideosChecked: seen.size, candidates: verified.length, applied: applied.size, statusCounts, videoReasons,
    region, allowMR, melodyRemovedCandidates: verified.filter(song => candidates.get(song.song_key).variant === 'melody_removed').length,
    playbackTested: false, requests: state.requests, searchRequests: state.searchRequests || {}, searchBackfill, backfillComplete, mode: apply ? 'apply' : 'dry-run' };
  await writeFile(`${cacheDir}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (stopReason) { console.error('대조가 중단되었습니다. 원인을 해결한 뒤 같은 명령으로 이어서 실행하세요.'); process.exitCode = 2; }
}
try { await main(); }
catch (error) { console.error(error.code && !error.message ? error.code : error.message); process.exitCode = 1; }
finally {
  await pool?.end();
  if (lock) { await lock.close(); await unlink(`${cacheDir}/run.lock`); }
}
