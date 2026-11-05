import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { normalizeSong } from './songs.js';

// Only use official-channel links already verified in the committed catalogue.
// Deliberately preserve punctuation and credits: fuzzy matches can be different songs.
const normalized = value => String(value || '').normalize('NFC').trim().toLowerCase();
const identity = song => `${normalized(song.title).replace(/\s+/gu, '')}\u0000${normalized(song.artist).replace(/\s+/gu, ' ')}`;
let approvedPromise;
async function approvedKyIndex() {
  if (!approvedPromise) approvedPromise = readFile(new URL('../../examples/import/linked-songs-only.csv', import.meta.url), 'utf8').then(csv => {
    const index = new Map();
    for (const row of parse(csv, { columns: true, bom: true })) {
      if (row.brand !== 'KY') continue;
      const song = normalizeSong(row), key = identity(song);
      const list = index.get(key) || []; list.push(song); index.set(key, list);
    }
    return index;
  }).catch(error => { approvedPromise = null; throw error; });
  return approvedPromise;
}
export async function findKyFallback(source, repository, connection) {
  if (source?.brand !== 'TJ' || !source.title?.trim() || !source.artist?.trim()) return null;
  const approved = (await approvedKyIndex()).get(identity(source)) || [];
  if (!approved.length || approved.length > 20) return null;
  const candidates = await repository.getSongsByKeys(approved.map(s => s.song_key), connection);
  const matches = candidates.filter(song => song.brand === 'KY' && identity(song) === identity(source) &&
    approved.some(a => a.song_key === song.song_key && a.youtube_video_id === song.youtube_video_id));
  // If more than one distinct video matches, leave the choice to a human.
  if (new Set(matches.map(s => s.youtube_video_id)).size !== 1) return null;
  const match = matches[0];
  return { playback_video_id: match.youtube_video_id, playback_brand: 'KY', playback_song_number: match.song_number };
}
