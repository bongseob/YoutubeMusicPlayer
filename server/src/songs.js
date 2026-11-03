import { parse } from 'csv-parse/sync';

export class InputError extends Error {
  constructor(message, details) { super(message); this.status = 400; this.details = details; }
}

export function videoId(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  let url;
  try { url = new URL(input); } catch { throw new InputError('올바른 YouTube 영상 링크 또는 11자리 영상 ID를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new InputError('YouTube 영상 링크를 확인해 주세요.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new InputError('지원하는 YouTube 영상 링크가 아닙니다.');
  return id;
}

function text(value, field, max, required = false) {
  if (value != null && typeof value !== 'string') throw new InputError(`${field}은 문자열이어야 합니다.`);
  const result = (value || '').normalize('NFC').trim();
  if ((required && !result) || [...result].length > max || /[\u0000-\u001f\u007f]/.test(result)) throw new InputError(`${field}: ${required ? '1' : '0'}~${max}자로 입력해 주세요.`);
  return result;
}

export function normalizeSong(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new InputError('곡 정보를 확인해 주세요.');
  const title = text(row.title, '제목', 200, true);
  const artist = text(row.artist, '가수', 200);
  const suppliedBrand = text(row.brand, '브랜드', 20).toUpperCase();
  const aliases = { TJ: 'TJ', '태진': 'TJ', KY: 'KY', KUMYOUNG: 'KY', '금영': 'KY' };
  const brand = suppliedBrand ? aliases[suppliedBrand] : row.ky_number ? 'KY' : 'TJ';
  if (!brand) throw new InputError('브랜드는 TJ 또는 KY로 입력해 주세요.');
  if (row.tj_number && brand !== 'TJ' || row.ky_number && brand !== 'KY') throw new InputError('브랜드와 번호 열이 일치하지 않습니다.');
  const legacyNumber = text(brand === 'TJ' ? row.tj_number : row.ky_number, '곡 번호', 10);
  const number = text(row.song_number, '곡 번호', 10) || legacyNumber;
  if (number && !/^\d{1,10}$/.test(number)) throw new InputError('곡 번호는 숫자 1~10자리로 입력해 주세요.');
  const canonical = value => value.replace(/^0+(?=\d)/, '');
  if (legacyNumber && canonical(legacyNumber) !== canonical(number)) throw new InputError('곡 번호 열의 값이 서로 다릅니다.');
  const video = text(row.youtube_url || row.youtube_video_id, '영상 링크', 500);
  const id = video ? videoId(video) : null;
  if (!number && !id) throw new InputError('곡 번호 또는 YouTube 영상 링크가 필요합니다.');
  const song_key = `${brand}:${number ? `n:${canonical(number)}` : `v:${id}`}`;
  return { song_key, brand, song_number: number || null, title, artist,
    tj_number: brand === 'TJ' ? number || null : null,
    ky_number: brand === 'KY' ? number || null : null,
    youtube_video_id: id, source_url: id ? `https://www.youtube.com/watch?v=${id}` : '' };
}

export const MAX_IMPORT_ROWS = 120000;

export function parseSongsCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw new InputError('CSV 파일이 비어 있습니다.');
  let rows;
  try {
    rows = parse(csv, {
      bom: true, skip_empty_lines: true, trim: true, max_record_size: 10000,
      columns(headers) {
        const clean = headers.map(h => h.trim());
        if (new Set(clean).size !== clean.length || !clean.includes('title') || !['song_number', 'tj_number', 'ky_number', 'youtube_url', 'youtube_video_id'].some(key => clean.includes(key))) throw new Error('제목과 곡 번호 또는 영상 링크 열이 필요합니다.');
        return clean;
      },
      to: MAX_IMPORT_ROWS + 1,
    });
  } catch { throw new InputError('CSV 형식을 확인해 주세요. 헤더: brand,song_number,title,artist,youtube_url'); }
  if (!rows.length) throw new InputError('등록할 데이터 행이 없습니다.');
  if (rows.length > MAX_IMPORT_ROWS) throw new InputError('CSV는 한 번에 최대 120,000행까지 가져올 수 있습니다.');
  const songs = new Map();
  const errors = [];
  rows.forEach((row, i) => {
    try {
      const song = normalizeSong(row);
      const previous = songs.get(song.song_key);
      // Metadata-only reimports must not erase a video supplied earlier.
      if (!song.youtube_video_id && previous?.youtube_video_id) {
        song.youtube_video_id = previous.youtube_video_id; song.source_url = previous.source_url;
      }
      songs.set(song.song_key, song);
    }
    catch (err) { errors.push({ row: i + 2, message: err.message }); }
  });
  if (errors.length) throw new InputError('오류가 있어 가져오지 않았습니다. 표시된 데이터 행을 수정해 주세요.', errors.slice(0, 50));
  return { songs: [...songs.values()], rows: rows.length, duplicates: rows.length - songs.size };
}

export function searchParams(query) {
  const q = typeof query.q === 'string' ? query.q.trim().normalize('NFC') : '';
  if (q.length > 200) throw new InputError('검색어는 200자 이하로 입력해 주세요.');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new InputError('페이지 번호가 올바르지 않습니다.');
  return { q, page, limit: 30, offset: (page - 1) * 30 };
}
