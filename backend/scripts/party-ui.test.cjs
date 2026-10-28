const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const sourcePath = path.resolve(__dirname, '../../frontend/src/pages/TheatreRoom.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
// Callback-level regression harness. Runs the actual production component logic
// before JSX with a minimal hook store; NOT a React DOM or video playback test.
const helpersStart = source.indexOf('const clock =');
const helpersEnd = source.indexOf('function Avatar(');
const componentStart = source.indexOf('export default function TheatreRoom() {');
const jsxStart = source.indexOf('  return (\n    <div className="flex h-[100dvh]');
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart && componentStart > helpersEnd && jsxStart > componentStart);
const executable = source.slice(helpersStart, helpersEnd) + '\n' + source.slice(componentStart, jsxStart)
  .replace('export default function TheatreRoom()', 'function TheatreRoom()') + '\nreturn { applySnapshot, applyTitle, applySource, onPlaybackStatus, leave, joinedRef, roomRef, sync, hostSyncTargetRef };\n}\nTheatreRoom;';

async function harness() {
  const { matchesYouTubeSync } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/lib/youtube.js')).href);
  const slots = [];
  let cursor = 0;
  let mount = true;
  const effects = [];
  const handlers = {};
  const emitted = [];
  const saved = [];
  const creds = { hostToken: 'a'.repeat(32), resumeToken: 'b'.repeat(32) };
  const socket = {
    id: 'current-client', connected: true,
    on(event, callback) { handlers[event] = callback; },
    emit(event, payload) { emitted.push({ event, payload }); },
    connect() { this.connected = true; }, disconnect() { this.connected = false; },
    removeAllListeners() {},
  };
  const config = { rejectLeave: false };
  const context = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback) { cursor++; return callback; },
    useMemo(factory) { cursor++; return factory(); },
    useEffect(callback) { cursor++; if (mount) effects.push(callback); },
    useParams: () => ({ roomId: 'c'.repeat(32) }), useNavigate: () => () => {},
    localStorage: { getItem: () => null },
    window: { innerWidth: 800, location: { origin: 'http://localhost:5175' }, addEventListener() {}, removeEventListener() {} },
    io: () => socket, API_ORIGIN: 'http://localhost:5001', PUBLIC_WEB_ORIGIN: '', DEFAULT_SERVER: 'vidlink',
    partyInvite: () => ({ url: '', isPublic: false }), validRoomId: () => true,
    roomCredentials: () => ({ ...creds }), saveRoomCredentials: (id, value) => saved.push(value),
    partyRequest: async () => { if (config.rejectLeave) throw new Error('Disconnected'); return { ok: true }; },
    matchesYouTubeSync, toast() {}, clearTimeout, setTimeout, Date, console,
  };
  const component = vm.runInNewContext(executable, context, { filename: sourcePath });
  const render = () => { cursor = 0; const api = component(); mount = false; return api; };
  render();
  effects.forEach(effect => effect());
  return { render, handlers, emitted, saved, socket, config };
}
const trailer = { provider: 'trailer', type: 'movie', tmdbId: 550, youtubeKey: 'qiuSBWVdgLI', season: 1, episode: 1 };
const state = (hostId, nowPlaying = trailer, currentTime = 60, isPlaying = true) => ({ roomId: 'c'.repeat(32), name: 'Test', hostId, users: [], nowPlaying, currentTime, isPlaying, syncMode: nowPlaying.provider === 'trailer' ? 'player-api' : 'cue-only' });

test('promoted host waits for authoritative time/state before sending telemetry', async () => {
  const h = await harness();
  let api = h.render();
  api.applySnapshot(state('old-host'), true);
  api.joinedRef.current = true;
  h.handlers.new_host({ hostId: 'current-client' });
  api.applySnapshot(state('current-client'));
  api = h.render();
  assert.equal(api.sync.currentTime, 60);
  assert.equal(api.sync.isPlaying, true);
  api.onPlaybackStatus({ ready: true, currentTime: 9, isPlaying: false, buffering: false });
  assert.equal(h.emitted.filter(x => x.event === 'sync_state').length, 0);
  api.onPlaybackStatus({ ready: true, currentTime: 60, isPlaying: true, buffering: false });
  const reports = h.emitted.filter(x => x.event === 'sync_state');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].payload.currentTime, 60);
  assert.equal(reports[0].payload.isPlaying, true);
});

test('unready trailer receives latest playing snapshot, not preliminary stale pause', async () => {
  const h = await harness();
  let api = h.render();
  api.applySnapshot(state('current-client', { ...trailer, provider: 'vidlink' }, 22, false), true);
  api.joinedRef.current = true;
  api.applyTitle({ ...trailer, by: 'Host' });
  api.applySource({ ...trailer, syncMode: 'player-api' });
  api.applySnapshot(state('current-client', trailer, 0, true));
  api = h.render();
  assert.equal(api.sync.currentTime, 0);
  assert.equal(api.sync.isPlaying, true);
  api.onPlaybackStatus({ ready: true, currentTime: 0, isPlaying: false, buffering: false });
  assert.equal(h.emitted.filter(x => x.event === 'sync_state').length, 0);
  api.onPlaybackStatus({ ready: true, currentTime: 0, isPlaying: true, buffering: false });
  assert.equal(h.emitted.filter(x => x.event === 'sync_state').length, 1);
});

test('offline and rejected leave retain private resumption credentials', async () => {
  for (const offline of [true, false]) {
    const h = await harness();
    h.socket.connected = !offline;
    h.config.rejectLeave = !offline;
    await h.render().leave();
    assert.equal(h.saved.length, 0);
    assert.equal(h.socket.connected, false);
  }
});

test('acknowledged leave clears private resumption credentials', async () => {
  const h = await harness();
  await h.render().leave();
  assert.equal(h.saved.length, 1);
  assert.equal(Object.keys(h.saved[0]).length, 0);
  assert.equal(h.socket.connected, false);
});
