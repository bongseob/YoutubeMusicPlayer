import { compact, sameArtist, sameTitle, validateMetadata, creditParts, videoVariant, withoutParens } from './video-link-utils.js';

export const CHANNELS = [
  { brand: 'TJ', id: 'UCZUhx8ClCv6paFW7qi3qljg' },
  { brand: 'KY', id: 'UCDqaUIUSJP5EVMEI178Zfag' },
];

export function catalogIndex(songs) {
  const byKey = new Map(songs.map(song => [song.song_key, song]));
  const byTitle = new Map();
  for (const song of songs) {
    const key = `${song.brand}:${compact(withoutParens(song.title))}`;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(song);
  }
  return { byKey, byTitle };
}

export function extractNumbers(brand, title, description) {
  const numbers = new Set();
  const patterns = brand === 'KY' ? [
    /\bKY[.\s]*(\d{1,10})\b/gi,
    /\bKY\s*(?:Karaoke\s*)?(?:No\.?\s*)?[.:]\s*(\d{1,10})\b/gi,
    /^\s*번호\s*[:：.]\s*(\d{1,10})\s*$/gm,
  ] : [
    /(?:TJ\s*(?:노래방\s*)?)?곡\s*번호\s*[.:：]?\s*(\d{1,10})\b/gi,
    /TJ\s*(?:Karaoke\s*)?Song\s*NO\.?\s*[:：.]?\s*(\d{1,10})\b/gi,
  ];
  for (const pattern of patterns) for (const match of `${title}\n${description}`.matchAll(pattern)) numbers.add(match[1].replace(/^0+(?=\d)/, ''));
  return [...numbers];
}

function titleFragments(title) {
  const content = title.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*\/\s*(?:TJ|KY)\s*Karaoke\s*$/i, '').replace(/\(KY\.?\s*\d+\)/gi, '');
  // Only split credits at separators outside parentheses (English translations can contain hyphens).
  return creditParts(content);
}

export function matchVideo(channel, video, index, region = 'KR', { allowMR = false } = {}) {
  const snippet = video.snippet || {};
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.id || '') || snippet.channelId !== channel.id) return { reason: 'wrong_channel_or_id' };
  const notEmbeddable = video.status?.privacyStatus !== 'public' || video.status?.embeddable !== true || snippet.liveBroadcastContent && snippet.liveBroadcastContent !== 'none';
  const restriction = video.contentDetails?.regionRestriction;
  const regionBlocked = restriction?.blocked?.includes(region) || restriction?.allowed && !restriction.allowed.includes(region);
  const numbers = extractNumbers(channel.brand, snippet.title || '', snippet.description || '');
  const variant = videoVariant(snippet.title || '');
  if (variant === 'melody_removed' && allowMR && numbers.length !== 1) return { reason: 'mr_requires_explicit_number' };
  const metadata = { provider_name: 'YouTube', title: snippet.title, author_url: `https://www.youtube.com/channel/${channel.id}`, url: `https://www.youtube.com/watch?v=${video.id}` };
  let candidates = [];
  if (numbers.length > 1) return { reason: 'conflicting_numbers', reviewKeys: numbers.map(number => `${channel.brand}:n:${number}`).filter(key => index.byKey.has(key)) };
  if (numbers.length === 1) {
    const key = `${channel.brand}:n:${numbers[0]}`;
    const row = index.byKey.get(key);
    if (!row) return { reason: 'number_not_in_catalog' };
    candidates = [row];
  } else {
    for (const [a, b] of titleFragments(snippet.title || '')) {
      for (const [name, artist] of [[a, b], [b, a]]) {
        const key = `${channel.brand}:${compact(withoutParens(name))}`;
        for (const row of index.byTitle.get(key) || []) if (sameTitle(row.title, name) && sameArtist(row.artist, artist)) candidates.push(row);
      }
    }
    candidates = [...new Map(candidates.map(row => [row.song_key, row])).values()];
    if (candidates.length > 1) return { reason: 'ambiguous_catalog_rows', reviewKeys: candidates.map(row => row.song_key) };
    if (!candidates.length) return { reason: 'no_catalog_match' };
  }
  const row = candidates[0];
  const validation = validateMetadata({ ...row, youtube_video_id: video.id }, metadata, { allowMR });
  if (!validation.ok) return { reason: validation.reason, reviewKeys: [row.song_key] };
  if (notEmbeddable) return { reason: 'not_public_embeddable_video', reviewKeys: [row.song_key] };
  if (regionBlocked) return { reason: 'region_restricted', reviewKeys: [row.song_key] };
  return { song_key: row.song_key, videoId: video.id, title: snippet.title, channelId: channel.id,
    publishedAt: snippet.publishedAt || '', numberVerified: numbers.length === 1, variant,
    checkedAt: video.checkedAt, source_url: metadata.url };
}

export function chooseCandidate(previous, candidate) {
  if (!previous) return candidate;
  if ((candidate.variant || 'normal') !== (previous.variant || 'normal')) return candidate.variant === 'melody_removed' ? previous : candidate;
  if (candidate.numberVerified !== previous.numberVerified) return candidate.numberVerified ? candidate : previous;
  return `${candidate.publishedAt}:${candidate.videoId}` > `${previous.publishedAt}:${previous.videoId}` ? candidate : previous;
}

// A page is checkpointed only after its videos have been durably stored. If a
// quota/network error occurs between the two requests, pendingPage survives.
export async function scanChannel({ channel, state, api, save, append, progress = () => {} }) {
  if (state.complete) return;
  if (!state.playlistId) {
    const data = await api('channels', { part: 'contentDetails', id: channel.id });
    const actual = data.items?.find(item => item.id === channel.id);
    state.playlistId = actual?.contentDetails?.relatedPlaylists?.uploads;
    if (!state.playlistId) throw new Error(`Official channel uploads unavailable: ${channel.brand}`);
    await save();
  }
  const playlistPage = async token => {
    const data = await api('playlistItems', { part: 'contentDetails', playlistId: state.playlistId, maxResults: '50', ...(token ? { pageToken: token } : {}) });
    if (!Array.isArray(data.items)) throw new Error('Invalid playlist response');
    return { ids: data.items.map(item => item.contentDetails?.videoId).filter(id => /^[\w-]{11}$/.test(id || '')), nextPageToken: data.nextPageToken || null };
  };
  while (!state.complete) {
    if (!state.pendingPage) {
      state.pendingPage = await playlistPage(state.nextPageToken);
      await save();
    }
    const page = state.pendingPage;
    const [details, next] = await Promise.allSettled([
      page.ids.length ? api('videos', { part: 'snippet,status,contentDetails', id: page.ids.join(',') }) : Promise.resolve({ items: [] }),
      state.prefetchedPage ? Promise.resolve(state.prefetchedPage) : page.nextPageToken ? playlistPage(page.nextPageToken) : Promise.resolve(null),
    ]);
    if (details.status === 'rejected') {
      if (next.status === 'fulfilled' && next.value) state.prefetchedPage = next.value;
      await save();
      throw details.reason;
    }
    const data = details.value;
    if (!Array.isArray(data.items)) throw new Error('Invalid video response');
    const checkedAt = new Date().toISOString();
    await append(data.items.map(video => ({ ...video, checkedAt })), channel);
    state.pages = (state.pages || 0) + 1;
    state.nextPageToken = page.nextPageToken;
    state.complete = !page.nextPageToken;
    if (next.status === 'fulfilled' && next.value) state.pendingPage = next.value;
    else delete state.pendingPage;
    delete state.prefetchedPage;
    await save();
    progress(channel, state, data.items.length);
    if (next.status === 'rejected') throw next.reason;
  }
}
