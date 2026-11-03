import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, extractNumbers, catalogIndex, matchVideo, chooseCandidate, scanChannel } from '../../scripts/youtube-catalog.js';
import { normalizeSong } from '../src/songs.js';
import { sameTitle } from '../../scripts/video-link-utils.js';

const channel = CHANNELS[0];
const tj = normalizeSong({ brand: 'TJ', song_number: '123', title: '노래', artist: '가수' });
const ky = normalizeSong({ brand: 'KY', song_number: '123', title: '금영 노래', artist: '가수' });
const makeVideo = patch => ({ id: 'Abc_def-123', snippet: { channelId: channel.id, title: '[TJ노래방] 노래 - 가수 / TJ Karaoke', description: 'TJ 노래방 곡번호.123', publishedAt: '2026-01-01T00:00:00Z', liveBroadcastContent: 'none' }, status: { privacyStatus: 'public', embeddable: true }, ...patch });

test('Parse official TJ/KY number formats without reading unrelated numbers', () => {
  assert.deepEqual(extractNumbers('TJ', '', 'TJ 노래방 곡번호.00123\nTJ Karaoke Song NO.123'), ['123']);
  assert.deepEqual(extractNumbers('KY', '노래 (KY.123)', '번호 : 123\n전화 : 12345'), ['123']);
  assert.deepEqual(extractNumbers('KY', '노래 (KY Karaoke No.KY1479)', ''), ['1479']);
  assert.deepEqual(extractNumbers('TJ', '2026년 메들리', '12345개의 영상\n2026-01-01'), []);
});
test('Match official number/title/artist while keeping same-number brands separate', () => {
  const index = catalogIndex([tj, ky]);
  const match = matchVideo(channel, makeVideo(), index);
  assert.equal(match.song_key, 'TJ:n:123');
  assert.equal(match.numberVerified, true);
  assert.equal(matchVideo(CHANNELS[1], makeVideo(), index).reason, 'wrong_channel_or_id');
  const wrongNumber = makeVideo(); wrongNumber.snippet.description = 'TJ 노래방 곡번호.456';
  assert.equal(matchVideo(channel, wrongNumber, index).reason, 'number_not_in_catalog');
});
test('Reject disabled embeds, regional restrictions, alternate singers and conflicting numbers', () => {
  const index = catalogIndex([tj, ky]);
  assert.equal(matchVideo(channel, makeVideo({ status: { privacyStatus: 'public', embeddable: false } }), index).reason, 'not_public_embeddable_video');
  assert.equal(matchVideo(channel, makeVideo({ contentDetails: { regionRestriction: { blocked: ['KR'] } } }), index).reason, 'region_restricted');
  const singer = makeVideo(); singer.snippet.title = '[TJ노래방] 노래 - 다른가수 / TJ Karaoke';
  assert.equal(matchVideo(channel, singer, index).reason, 'title_or_artist_mismatch');
  const conflict = makeVideo(); conflict.snippet.description += '\nTJ 노래방 곡번호.456';
  assert.equal(matchVideo(channel, conflict, index).reason, 'conflicting_numbers');
});
test('Without a number, only a unique catalog title/artist can be linked', () => {
  const video = makeVideo(); video.snippet.description = '';
  assert.equal(matchVideo(channel, video, catalogIndex([tj])).numberVerified, false);
  const other = normalizeSong({ brand: 'TJ', song_number: '456', title: '노래', artist: '가수' });
  assert.equal(matchVideo(channel, video, catalogIndex([tj, other])).reason, 'ambiguous_catalog_rows');
  assert.equal(sameTitle('초혼(2015 Ver.)', '초혼'), false);
});
test('Prefer a number-verified video then the most recent matching normal upload', () => {
  const old = { videoId: 'Abc_def-123', numberVerified: true, publishedAt: '2025-01-01' };
  assert.equal(chooseCandidate(old, { ...old, numberVerified: false, publishedAt: '2026-01-01' }), old);
  const newer = { ...old, videoId: 'abc_def-123', publishedAt: '2026-01-01' };
  assert.equal(chooseCandidate(old, newer), newer);
  assert.equal(chooseCandidate(old, { ...newer, variant: 'melody_removed' }), old);
});
test('MR requires explicit permission and number, and changed keys stay excluded', () => {
  const video = makeVideo(); video.snippet.title = '[TJ노래방 / 멜로디제거] 노래 - 가수 / TJ Karaoke';
  const index = catalogIndex([tj]);
  assert.equal(matchVideo(channel, video, index).reason, 'alternate_version');
  assert.equal(matchVideo(channel, video, index, 'KR', { allowMR: true }).variant, 'melody_removed');
  const withoutNumber = { ...video, snippet: { ...video.snippet, description: '' } };
  assert.equal(matchVideo(channel, withoutNumber, index, 'KR', { allowMR: true }).reason, 'mr_requires_explicit_number');
  const changed = { ...video, snippet: { ...video.snippet, title: '[TJ노래방 / 여자키] 노래 - 가수 / TJ Karaoke' } };
  assert.equal(matchVideo(channel, changed, index, 'KR', { allowMR: true }).reason, 'alternate_version');
});
test('Channel pagination retrieves all pages and can resume after a quota interruption', async () => {
  const state = {}, calls = [], stored = [];
  let fail = true;
  const api = async (method, params) => {
    calls.push({ method, params });
    if (method === 'channels') return { items: [{ id: channel.id, contentDetails: { relatedPlaylists: { uploads: 'uploads-playlist' } } }] };
    if (method === 'playlistItems') return { items: [{ contentDetails: { videoId: params.pageToken ? 'abc_def-123' : 'Abc_def-123' } }], ...(params.pageToken ? {} : { nextPageToken: 'page-two' }) };
    if (fail) throw new Error('quota exhausted');
    return { items: [makeVideo({ id: params.id })] };
  };
  const options = { channel, state, api, save: async () => {}, append: async rows => stored.push(...rows) };
  await assert.rejects(scanChannel(options), /quota/);
  assert.equal(state.complete, undefined);
  assert.equal(state.pendingPage.nextPageToken, 'page-two');
  const playlistCalls = calls.filter(call => call.method === 'playlistItems').length;
  fail = false;
  await scanChannel(options);
  assert.equal(state.complete, true);
  assert.equal(state.pages, 2);
  assert.deepEqual(stored.map(video => video.id), ['Abc_def-123', 'abc_def-123']);
  assert.equal(calls.filter(call => call.method === 'playlistItems').length, playlistCalls);
  assert.equal(calls.filter(call => call.method === 'playlistItems' && !call.params.pageToken).length, 1);
  const count = calls.length;
  await scanChannel(options);
  assert.equal(calls.length, count);
});
