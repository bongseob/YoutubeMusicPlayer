export const isPlayable = song => /^[A-Za-z0-9_-]{11}$/.test(song?.youtube_video_id || '');
export const songBrand = song => song.brand || 'TJ';
export const songNumber = song => song.song_number || (songBrand(song) === 'KY' ? song.ky_number : song.tj_number) || '';
export const songKey = song => {
  const number = songNumber(song).replace(/^0+(?=\d)/, '');
  return `${songBrand(song)}:${number ? `n:${number}` : `v:${song.youtube_video_id}`}`;
};
export const songLabel = song => `${songBrand(song)} ${songNumber(song) || '미등록'}`;
export const isSong = song => song && typeof song.title === 'string' && (!song.brand || ['TJ', 'KY'].includes(song.brand)) &&
  (isPlayable(song) || /^\d{1,10}$/.test(songNumber(song))) &&
  (song.artist == null || typeof song.artist === 'string') &&
  ['song_number', 'tj_number', 'ky_number'].every(key => song[key] == null || typeof song[key] === 'string');
export function readSongs(storage, key, queue = false) {
  try {
    const value = JSON.parse(storage.getItem(key));
    if (!Array.isArray(value)) return [];
    return value.filter(song => isSong(song) && (!queue || isPlayable(song) && typeof song.queueId === 'string')).slice(0, 5000);
  } catch { return []; }
}
export function moveSong(queue, index, delta) {
  const next = [...queue];
  if (index < 0 || index >= next.length || index + delta < 0 || index + delta >= next.length) return next;
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
}
