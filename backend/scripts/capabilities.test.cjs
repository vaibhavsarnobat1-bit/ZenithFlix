const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const frontend = path.resolve(__dirname, '../../frontend/src/lib');
const importFile = (name) => import(pathToFileURL(path.join(frontend, name)).href);
const { titleLanguages } = require('../lib/tmdb');
const backendProviders = require('../lib/providers');
const roomId = 'a1'.repeat(16);

// Production helpers are exercised directly. Only the Vite config import is
// replaced for providers.js, since Node has no import.meta.env/browser origin.
async function browserProviders() {
  const audioUrl = pathToFileURL(path.join(frontend, 'audio.js')).href;
  const code = fs.readFileSync(path.join(frontend, 'providers.js'), 'utf8')
    .replace("import { API } from './config';", "const API = 'https://api.example.com/api';")
    .replace("from './audio.js'", `from '${audioUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('iframe audio stays unknown/unselected even with legacy Hindi claims', async () => {
  const { iframeAudioState } = await importFile('audio.js');
  const state = iframeAudioState({ ok: true, provider: { audio: ['hi'], langParam: 'lang' } });
  assert.equal(state.status, 'unsupported');
  assert.deepEqual(state.tracks, []);
  assert.equal(state.selectedTrackId, null);
  assert.equal(state.selectedLanguage, null);
  assert.equal(state.canSelect, false);
  assert.match(state.reason, /cannot be verified/);
});
test('unavailable source has distinct audio and quality state', async () => {
  const { iframeAudioState, iframeQualityState } = await importFile('audio.js');
  for (const helper of [iframeAudioState, iframeQualityState]) {
    assert.equal(helper({ ok: false }).status, 'unavailable');
    assert.equal(helper(null).canSelect, false);
  }
});
test('advertised 4K does not fabricate stream levels or Auto', async () => {
  const { iframeQualityState } = await importFile('audio.js');
  const state = iframeQualityState({ ok: true, provider: { tier: 3 } });
  assert.deepEqual(state.levels, []);
  assert.equal(state.selectedLevel, null);
  assert.equal(state.supportsAuto, false);
  assert.equal(state.canSelect, false);
});
test('legacy dub endpoint payload is rejected as stream evidence', async () => {
  const { titleLanguageMetadata } = await importFile('audio.js');
  assert.equal(titleLanguageMetadata({ audio: ['hi'], dubs: ['hi'] }).status, 'unavailable');
  assert.deepEqual(titleLanguageMetadata(null).languages, []);
});
test('title metadata preserves catalogue languages without audio selection', async () => {
  const { titleLanguageMetadata } = await importFile('audio.js');
  const metadata = titleLanguageMetadata(titleLanguages({ original_language: 'hi', spoken_languages: [{ iso_639_1: 'en' }] }, { id: 550 }));
  assert.deepEqual(metadata.languages.map((r) => r.code), ['hi', 'en']);
  assert.deepEqual(metadata.audio, []);
  assert.equal(metadata.trackAvailability, 'unknown');
});
test('India releases, Hindi translated titles and trailers do not infer Hindi dubbing', () => {
  const metadata = titleLanguages({ original_language: 'en', spoken_languages: [{ iso_639_1: 'en' }],
    release_dates: { results: [{ iso_3166_1: 'IN' }] }, alternative_titles: { titles: [{ iso_3166_1: 'IN', title: 'Hindi title' }] },
    videos: { results: [{ iso_639_1: 'hi', type: 'Trailer' }] } }, { id: 550 });
  assert.deepEqual(metadata.languages.map((r) => r.code), ['en']);
  assert.deepEqual(metadata.dubs, []);
});
test('metadata deduplicates valid original and spoken ISO languages', () => {
  const metadata = titleLanguages({ original_language: 'EN', spoken_languages: [{ iso_639_1: 'en' }, { iso_639_1: 'hi' }, { iso_639_1: 'xx' }, { iso_639_1: 'hindi' }, null] }, { type: 'tv', id: '1396' });
  assert.deepEqual(metadata.languages.map((r) => r.code), ['en', 'hi']);
  assert.deepEqual(metadata.languages[0].evidence, ['original-language', 'spoken-language']);
  assert.equal(metadata.id, 1396);
  assert.equal(metadata.type, 'tv');
});
test('backend providers expose no guessed audio capabilities', () => {
  for (const p of backendProviders.serialize()) {
    assert.deepEqual(p.audio, []);
    assert.equal(p.langParam, null);
    assert.equal(p.ownAudioMenu, false);
    assert.equal(p.audioControl.canSelect, false);
  }
});
test('backend direct/proxy movie and episode URLs ignore language requests', () => {
  for (const p of backendProviders.PROVIDERS.filter((p) => p.kind !== 'trailer')) {
    for (const type of ['movie', 'tv']) {
      const args = { tmdbId: 550, type, season: 2, episode: 3 };
      assert.equal(backendProviders.resolve(p.id, args).url, backendProviders.resolve(p.id, { ...args, lang: 'hi' }).url);
    }
  }
});
test('frontend source URL ignores guessed lang but retains episode parameters', async () => {
  const p = await browserProviders();
  for (const provider of p.providersSync().filter((row) => row.kind !== 'trailer')) {
    const args = { tmdbId: 550, type: 'tv', season: 2, episode: 3 };
    assert.deepEqual(p.buildSource(provider.id, args), p.buildSource(provider.id, { ...args, lang: 'hi' }));
    assert.equal(p.buildSource(provider.id, args).langApplied, false);
  }
  assert.match(p.buildSource('vidlink', { tmdbId: 1396, type: 'tv', season: 2, episode: 3 }).url, /1396\/2\/3/);
  assert.equal(p.buildSource('unknown', {}).ok, false);
});
test('metadata failures remain retryable, concurrent requests deduplicate, success caches', async () => {
  const p = await browserProviders();
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? { ok: false } : { ok: true, json: async () => titleLanguages({ original_language: 'en' }, { id: 991234 }) }; };
  try {
    const failed = await p.loadDubs('movie', 991234);
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.id, 991234);
    assert.equal(failed.type, 'movie');
    const [a, b] = await Promise.all([p.loadDubs('movie', 991234), p.loadDubs('movie', 991234)]);
    assert.deepEqual(a, b);
    assert.equal(calls, 2);
    await p.loadDubs('movie', 991234);
    assert.equal(calls, 2);
    await p.loadDubs('tv', 991234);
    assert.equal(calls, 3);
  } finally { global.fetch = previous; }
});
test('invitation validates server-generated room ID format', async () => {
  const { validRoomId, partyInvite } = await importFile('invite.js');
  assert.equal(validRoomId(roomId), true);
  for (const id of ['short', 'A'.repeat(32), '', null]) assert.equal(partyInvite(id, 'https://example.com').url, '');
});
test('invitation uses public configured HTTPS origin and includes no private query', async () => {
  const { partyInvite } = await importFile('invite.js');
  const invite = partyInvite(roomId, 'http://localhost:5173', 'https://watch.example.com');
  assert.equal(invite.url, `https://watch.example.com/room/${roomId}`);
  assert.equal(invite.isPublic, true);
  assert.equal(new URL(invite.url).search, '');
});
test('local/LAN/http invitations cannot be advertised as remote-ready', async () => {
  const { partyInvite } = await importFile('invite.js');
  for (const origin of ['http://localhost:5173', 'https://127.0.0.1', 'https://10.0.0.1', 'https://192.168.1.5', 'https://172.16.0.1', 'https://[::1]', 'https://watch.internal', 'http://watch.example.com']) {
    assert.equal(partyInvite(roomId, origin).isPublic, false, origin);
  }
});
test('invalid configured origins reject paths, credentials, fragments and queries', async () => {
  const { partyInvite } = await importFile('invite.js');
  for (const origin of ['https://user:password@example.com', 'https://example.com/path', 'https://example.com?token=test', 'https://example.com#fragment', 'javascript:alert(1)']) {
    assert.equal(partyInvite(roomId, 'http://localhost:5173', origin).url, '');
  }
});
test('standalone YouTube without TMDB ID does not request invalid catalogue metadata', async () => {
  const p = await browserProviders();
  const previous = global.fetch;
  global.fetch = () => { throw new Error('Unexpected fetch'); };
  try {
    const metadata = await p.loadDubs('movie', 0);
    assert.equal(metadata.status, 'unavailable');
    assert.equal(metadata.id, 0);
    assert.equal(metadata.type, 'movie');
  } finally { global.fetch = previous; }
});

function browserGlobals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
}

test('copy helper uses successful native clipboard without fallback', async (t) => {
  const { copyText } = await importFile('invite.js');
  let copied = null;
  browserGlobals(t, { navigator: { clipboard: { writeText: async (text) => { copied = text; } } }, document: {} });
  await copyText('https://watch.example.com/room/test');
  assert.equal(copied, 'https://watch.example.com/room/test');
});

test('copy helper falls back after native denial and always cleans temporary textarea', async (t) => {
  const { copyText } = await importFile('invite.js');
  let removed = 0;
  let selected = 0;
  const field = { style: {}, setAttribute() {}, select() { selected++; }, remove() { removed++; } };
  const doc = { createElement: () => field, body: { append() {} }, execCommand: () => true };
  browserGlobals(t, { navigator: { clipboard: { writeText: async () => { throw new Error('Denied'); } } }, document: doc });
  await copyText('https://watch.example.com/room/test');
  assert.equal(selected, 1);
  assert.equal(removed, 1);
  doc.execCommand = () => { throw new Error('Blocked'); };
  await assert.rejects(copyText('https://watch.example.com/room/test'), /Select and copy/);
  assert.equal(removed, 2);
});

test('YouTube API loader deduplicates loads and resolves its real ready callback', async (t) => {
  let appended = 0;
  let previousCalled = 0;
  const win = { onYouTubeIframeAPIReady: () => { previousCalled++; } };
  const script = { dataset: {}, remove() {} };
  browserGlobals(t, { window: win, document: { querySelector: () => null, createElement: () => script, head: { append() { appended++; } } } });
  const { loadYouTubeApi } = await import(`${pathToFileURL(path.join(frontend, 'youtube.js')).href}?loader-success`);
  const first = loadYouTubeApi();
  assert.equal(loadYouTubeApi(), first);
  assert.equal(appended, 1);
  win.YT = { Player: function TestPlayer() {} };
  win.onYouTubeIframeAPIReady();
  assert.equal(await first, win.YT);
  assert.equal(previousCalled, 1);
  assert.equal(script.src, 'https://www.youtube.com/iframe_api');
});

test('YouTube API script failure is retryable and removes its failed script', async (t) => {
  let removed = 0;
  let appended = 0;
  const win = {};
  const script = { dataset: {}, remove() { removed++; } };
  browserGlobals(t, { window: win, document: { querySelector: () => null, createElement: () => script, head: { append() { appended++; } } } });
  const { loadYouTubeApi } = await import(`${pathToFileURL(path.join(frontend, 'youtube.js')).href}?loader-retry`);
  const first = loadYouTubeApi();
  const rejected = assert.rejects(first, /blocked or unavailable/);
  script.onerror();
  await rejected;
  assert.equal(removed, 1);
  const retried = loadYouTubeApi();
  assert.equal(appended, 2);
  win.YT = { Player: function TestPlayer() {} };
  win.onYouTubeIframeAPIReady();
  assert.equal(await retried, win.YT);
});

function fakePlayer(time = 5) {
  const calls = [];
  return { calls, getCurrentTime: () => time, seekTo: (...args) => calls.push(['seek', ...args]), playVideo: () => calls.push(['play']), pauseVideo: () => calls.push(['pause']) };
}
test('YouTube adapter applies play and pause without re-seeking aligned playback', async () => {
  const { applyYouTubeSync } = await importFile('youtube.js');
  const player = fakePlayer(10);
  assert.equal(applyYouTubeSync(player, { action: 'play', currentTime: 11 }), true);
  applyYouTubeSync(player, { action: 'pause', currentTime: 11 });
  assert.deepEqual(player.calls, [['play'], ['pause']]);
});
test('YouTube seek and late snapshot preserve authoritative playback state', async () => {
  const { applyYouTubeSync } = await importFile('youtube.js');
  const player = fakePlayer();
  applyYouTubeSync(player, { action: 'seek', currentTime: 20, isPlaying: false });
  applyYouTubeSync(player, { action: 'snapshot', currentTime: 42, isPlaying: true });
  assert.deepEqual(player.calls, [['seek', 20, true], ['pause'], ['seek', 42, true], ['play']]);
});
test('YouTube adapter rejects unknown actions, missing player and invalid times', async () => {
  const { applyYouTubeSync } = await importFile('youtube.js');
  const player = fakePlayer();
  for (const currentTime of [-1, Infinity, NaN, 'bad', null, '5', 604801]) assert.equal(applyYouTubeSync(player, { action: 'seek', currentTime }), false);
  assert.equal(applyYouTubeSync(player, { action: 'invalid', currentTime: 0 }), false);
  assert.equal(applyYouTubeSync(null, { action: 'play', currentTime: 0 }), false);
  assert.deepEqual(player.calls, []);
});
