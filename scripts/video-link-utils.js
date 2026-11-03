export const compact = value => String(value || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function withoutParens(value) {
  let previous;
  do { previous = value; value = value.replace(/\([^()]*\)/g, ''); } while (value !== previous);
  return value.trim();
}
export function sameTitle(a, b) {
  const versions = value => [...value.matchAll(/\(([^()]*(?:\bver\b|version|remix|\blive\b|\bmr\b|20\d{2})[^()]*)\)/gi)].map(match => compact(match[1])).sort().join(':');
  return versions(a) === versions(b) && compact(withoutParens(a)) === compact(withoutParens(b));
}
export function sameArtist(a, b) {
  const aliases = { iu: '아이유', tei: '테이' };
  const norm = value => { const key = compact(withoutParens(value)); return aliases[key] || key; };
  return !!norm(a) && norm(a) === norm(b);
}
export function creditParts(content) {
  const pairs = []; let depth = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '(') depth++;
    if (content[i] === ')') depth = Math.max(0, depth - 1);
    const separator = depth === 0 && /^\s+--?\s+/.exec(content.slice(i));
    if (separator) {
      pairs.push([content.slice(0, i).trim(), content.slice(i + separator[0].length).trim()]);
      i += separator[0].length - 1;
    }
  }
  return pairs;
}
export function videoVariant(title) {
  if (/여자키|남자키|여성키|남성키|반키|한키|메들리|MR\s*Live|SEMI\s*LIVE|키올림|키내림|\bKEY\s*[+-]\s*[1-9]/i.test(title)) return 'excluded';
  return /멜로디\s*제거|\[MR\s*\//i.test(title) ? 'melody_removed' : 'normal';
}
export function validateMetadata(song, metadata, { allowMR = false } = {}) {
  if (metadata.error) return { ok: false, reason: `metadata_unavailable: ${metadata.error}` };
  let author;
  try { author = new URL(metadata.author_url); } catch { return { ok: false, reason: 'missing_author_url' }; }
  const official = {
    TJ: ['/@TJ노래방TJKaraoke', '/user/ziller', '/channel/UCZUhx8ClCv6paFW7qi3qljg'],
    KY: ['/@KARAOKEKY', '/channel/UCDqaUIUSJP5EVMEI178Zfag'],
  };
  let authorPath;
  try { authorPath = decodeURIComponent(author.pathname.replace(/\/$/, '')); } catch { return { ok: false, reason: 'invalid_author_url' }; }
  if (!['www.youtube.com', 'youtube.com'].includes(author.hostname) ||
      !official[song.brand]?.includes(authorPath)) return { ok: false, reason: 'unrecognized_official_channel' };
  if (metadata.provider_name !== 'YouTube') return { ok: false, reason: 'wrong_provider' };
  try {
    if (new URL(metadata.url).searchParams.get('v') !== song.youtube_video_id) return { ok: false, reason: 'video_id_mismatch' };
  } catch { return { ok: false, reason: 'missing_video_url' }; }
  const title = metadata.title || '';
  const variant = videoVariant(title);
  if (variant === 'excluded' || variant === 'melody_removed' && !allowMR) return { ok: false, reason: 'alternate_version' };
  const prefix = song.brand === 'TJ' ? /^\[TJ노래방\]\s*/ : /^\[KY (?:ENTERTAINMENT|금영노래방)\]\s*/;
  const mrPrefix = song.brand === 'TJ' ? /^\[TJ노래방\s*\/\s*멜로디\s*제거\]\s*/ : /^\[(?:MR\s*\/\s*노래방\s*멜로디\s*제거|멜로디\s*제거)\]\s*/;
  // Newer KY uploads may omit the bracket prefix.
  if (song.brand === 'TJ' && !prefix.test(title) && !(allowMR && mrPrefix.test(title))) return { ok: false, reason: 'unexpected_title_prefix' };
  const content = title.replace(prefix, '').replace(allowMR ? mrPrefix : /$^/, '').replace(/\s*\/\s*(?:TJ|KY)\s*Karaoke\s*$/i, '').replace(/\(KY\.?\s*\d+\)/gi, '').replace(/\[KY (?:ENTERTAINMENT|금영노래방)\]/g, '').trim();
  const pairs = creditParts(content);
  if (!pairs.length) return { ok: false, reason: 'unexpected_title_format' };
  const matches = (name, artist) => sameTitle(name, song.title) && sameArtist(artist, song.artist);
  if (!pairs.some(([name, artist]) => matches(name, artist) || matches(artist, name))) return { ok: false, reason: 'title_or_artist_mismatch' };
  return { ok: true };
}
