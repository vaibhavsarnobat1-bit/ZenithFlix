const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { Server } = require('socket.io');
const frontendRequire = createRequire(path.resolve(__dirname, '../../frontend/package.json'));
const { io: clientIo } = frontendRequire('socket.io-client');
const setupSyncEngine = require('../socket/syncEngine');

const trailer = { type: 'movie', tmdbId: 0, title: 'Test trailer', provider: 'trailer', youtubeKey: 'dQw4w9WgXcQ' };
const movie = { type: 'movie', tmdbId: 550, title: 'Test movie', provider: 'autoembed' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function event(socket, name, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    const handler = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(name, handler);
      resolve(value);
    };
    socket.on(name, handler);
  });
}
const request = (socket, name, payload) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(name, payload, (error, response) => error ? reject(error) : resolve(response));
});
async function ok(socket, name, payload) {
  const response = await request(socket, name, payload);
  assert.equal(response.ok, true, JSON.stringify(response));
  return response;
}
async function rejected(socket, name, payload, code) {
  const response = await request(socket, name, payload);
  assert.equal(response.ok, false);
  assert.equal(response.code, code);
  assert.equal(typeof response.error, 'string');
  assert.ok(response.error.length > 0);
  return response;
}
async function fixture(t, options = {}) {
  const server = http.createServer();
  const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
  const cleanup = setupSyncEngine(io, { ROOM_CREATE_LIMIT: 100, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    cleanup();
    for (const socket of clients) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
  });
  async function client(transport = 'websocket') {
    const socket = clientIo(url, { transports: [transport], forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket);
    const ready = event(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
  }
  const host = await client();
  const member = await client('polling');
  const outsider = await client();
  return { host, member, outsider, client, io, cleanup };
}
const create = (host, nowPlaying) => ok(host, 'create_room', { username: 'Host', name: 'Server party name', ...(nowPlaying ? { nowPlaying } : {}) });
const join = (socket, roomId, extra = {}) => ok(socket, 'join_room', { roomId, username: 'Guest', ...extra });

// Every fixture uses independent real transports and an ephemeral local HTTP server.
test('secure creation, unique IDs, strict joins, authoritative names, and duplicate joins', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const first = await create(host, trailer);
  const second = await create(outsider, movie);
  for (const value of [first.roomId, second.roomId, first.hostToken, first.resumeToken]) assert.match(value, /^[a-f0-9]{32}$/);
  assert.notEqual(first.roomId, second.roomId);
  assert.notEqual(first.hostToken, first.resumeToken);
  assert.equal(first.state.hostId, host.id);
  assert.equal(first.state.isHost, true);
  assert.equal(first.state.users.length, 1);
  assert.equal(first.state.nowPlaying.youtubeKey, trailer.youtubeKey);
  assert.equal(first.state.syncMode, 'player-api');
  const joined = await join(member, first.roomId, { name: 'Ignored client name' });
  assert.equal(joined.state.name, 'Server party name');
  assert.equal(joined.state.isHost, false);
  assert.equal(joined.state.users.length, 2);
  const duplicate = await join(member, first.roomId, { username: 'Cannot rename on retry' });
  assert.equal(duplicate.resumeToken, joined.resumeToken);
  assert.equal(duplicate.state.users.length, 2);
  assert.equal(duplicate.state.users.find((user) => user.id === member.id).username, 'Guest');
  await rejected(member, 'join_room', { roomId: 'friendly-room', username: 'Guest' }, 'INVALID_ROOM_ID');
  await rejected(member, 'join_room', { roomId: 'f'.repeat(32), username: 'Guest' }, 'ROOM_NOT_FOUND');
  await rejected(member, 'join_room', { roomId: second.roomId, username: 'Guest' }, 'ALREADY_JOINED');
});

test('outsiders and joined nonhosts cannot mutate playback; errors also arrive without ack', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const { roomId } = await create(host, trailer);
  await join(member, roomId);
  const attacks = [
    ['select_title', { nowPlaying: movie }], ['change_source', { provider: 'autoembed' }],
    ['change_url', { url: 'https://example.com' }], ['party_control', { action: 'play', currentTime: 30 }],
    ['sync_state', { currentTime: 30, isPlaying: true }],
  ];
  for (const [name, payload] of attacks) {
    await rejected(outsider, name, { roomId, ...payload }, 'NOT_MEMBER');
    await rejected(member, name, { roomId, ...payload }, 'HOST_ONLY');
  }
  await rejected(outsider, 'send_message', { roomId, message: 'intrusion' }, 'NOT_MEMBER');
  await rejected(outsider, 'report_drift', { roomId, clientTime: 0 }, 'NOT_MEMBER');
  await rejected(outsider, 'leave_room', { roomId }, 'NOT_MEMBER');
  const error = event(outsider, 'party_error', (value) => value.event === 'party_control');
  outsider.emit('party_control', { roomId, action: 'pause', currentTime: 0 });
  assert.equal((await error).code, 'NOT_MEMBER');
  assert.equal((await join(member, roomId)).state.nowPlaying.provider, 'trailer');
});

test('separate clients receive host play, pause, seek, and host_sync with preserved seek state', async (t) => {
  const { host, member } = await fixture(t);
  const { roomId } = await create(host, trailer);
  await join(member, roomId);
  let nonce = 0;
  for (const [action, currentTime, isPlaying] of [['pause', 10, false], ['seek', 20, false], ['play', 20, true], ['seek', 35, true]]) {
    const hostControl = event(host, 'party_control');
    const guestControl = event(member, 'party_control');
    const ack = await ok(host, 'party_control', { roomId, action, currentTime });
    const [a, b] = await Promise.all([hostControl, guestControl]);
    assert.deepEqual(a, b);
    assert.equal(a.action, action);
    assert.equal(a.currentTime, currentTime);
    assert.equal(a.isPlaying, isPlaying);
    assert.equal(a.syncMode, 'player-api');
    assert.ok(a.nonce > nonce);
    nonce = a.nonce;
    assert.equal(ack.state.isPlaying, isPlaying);
  }
  const sync = event(member, 'host_sync', (packet) => packet.currentTime >= 42 && !packet.isPlaying);
  await ok(host, 'sync_state', { roomId, currentTime: 42, isPlaying: false });
  assert.deepEqual(await sync, { currentTime: 42, isPlaying: false, syncMode: 'player-api' });
});

test('invalid payloads, actions, providers, title IDs and times leave state unchanged', async (t) => {
  const { host, member } = await fixture(t);
  const { roomId } = await create(host, movie);
  await join(member, roomId);
  await ok(host, 'party_control', { roomId, action: 'pause', currentTime: 12 });
  await rejected(host, 'party_control', null, 'INVALID_INPUT');
  await rejected(host, 'party_control', { roomId, action: 'launch', currentTime: 0 }, 'INVALID_ACTION');
  for (const currentTime of [-1, '2', null, 604801]) {
    await rejected(host, 'party_control', { roomId, action: 'seek', currentTime }, 'INVALID_TIME');
    await rejected(host, 'sync_state', { roomId, currentTime, isPlaying: true }, 'INVALID_TIME');
  }
  await rejected(host, 'party_control', { roomId, action: 'seek' }, 'INVALID_TIME');
  await rejected(host, 'sync_state', { roomId, currentTime: 2, isPlaying: 'true' }, 'INVALID_INPUT');
  await rejected(host, 'change_source', { roomId, provider: 'unknown' }, 'INVALID_PROVIDER');
  await rejected(host, 'select_title', { roomId, nowPlaying: { ...movie, provider: 'unknown' } }, 'INVALID_PROVIDER');
  for (const invalid of [{ ...movie, tmdbId: 0 }, { ...movie, tmdbId: -1 }, { ...movie, tmdbId: 1.5 },
    { ...movie, type: 'script' }, { ...movie, season: 0 }, { ...trailer, youtubeKey: 'bad' },
    { ...trailer, youtubeKey: null }, { ...movie, poster: 'javascript:alert(1)' }]) {
    await rejected(host, 'select_title', { roomId, nowPlaying: invalid }, 'INVALID_INPUT');
  }
  const snapshot = (await join(member, roomId)).state;
  assert.equal(snapshot.currentTime, 12);
  assert.equal(snapshot.isPlaying, false);
  assert.equal(snapshot.nowPlaying.provider, 'autoembed');
});

test('late join receives projected playback snapshot and ongoing server heartbeat', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const { roomId } = await create(host, trailer);
  await join(member, roomId);
  await ok(host, 'party_control', { roomId, action: 'play', currentTime: 50 });
  await wait(120);
  const playing = event(outsider, 'now_playing');
  const joined = await join(outsider, roomId);
  assert.ok(joined.state.currentTime >= 50.1 && joined.state.currentTime < 53);
  assert.equal(joined.state.isPlaying, true);
  assert.equal(joined.state.hostId, host.id);
  assert.equal(joined.state.syncMode, 'player-api');
  assert.equal((await playing).youtubeKey, trailer.youtubeKey);
  const heartbeat = await event(member, 'host_sync', (packet) => packet.currentTime > joined.state.currentTime);
  assert.equal(heartbeat.isPlaying, true);
});

test('resume tokens are idempotent, replace overlapping transports, and reconnect the original host', async (t) => {
  const { host, member, outsider, client } = await fixture(t, { ROOM_RECONNECT_GRACE_MS: 1000 });
  const created = await create(host, trailer);
  const joined = await join(member, created.roomId);
  const replaced = event(member, 'session_replaced');
  const resumed = await join(outsider, created.roomId, { resumeToken: joined.resumeToken, username: 'Changed name' });
  await replaced;
  assert.equal(resumed.resumeToken, joined.resumeToken);
  assert.equal(resumed.state.users.length, 2);
  assert.equal(resumed.state.users.find((user) => user.id === outsider.id).username, 'Guest');
  await rejected(member, 'send_message', { roomId: created.roomId, message: 'old transport' }, 'NOT_MEMBER');
  await rejected(member, 'join_room', { roomId: created.roomId, username: 'Guest', resumeToken: '0'.repeat(32) }, 'INVALID_RESUME_TOKEN');
  await rejected(outsider, 'join_room', { roomId: created.roomId, username: 'Guest', resumeToken: joined.resumeToken, hostToken: created.hostToken }, 'INVALID_HOST_TOKEN');
  const originalHostId = host.id;
  const left = event(outsider, 'user_left', (user) => user.id === originalHostId);
  host.disconnect();
  await left;
  const newHost = await client();
  const reclaim = await join(newHost, created.roomId, { username: 'Host', hostToken: created.hostToken, resumeToken: created.resumeToken });
  assert.equal(reclaim.state.isHost, true);
  assert.equal(reclaim.state.hostId, newHost.id);
  assert.equal(reclaim.state.users.length, 2);
  await ok(newHost, 'party_control', { roomId: created.roomId, action: 'pause', currentTime: 5 });
});

test('host bearer alone reclaims only the creator and explicit leave immediately transfers ownership', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const created = await create(host, trailer);
  await join(member, created.roomId);
  const reclaim = await join(outsider, created.roomId, { hostToken: created.hostToken });
  assert.equal(reclaim.resumeToken, created.resumeToken);
  assert.equal(reclaim.state.isHost, true);
  assert.equal(reclaim.state.users.length, 2);
  await rejected(host, 'party_control', { roomId: created.roomId, action: 'play' }, 'NOT_MEMBER');
  const transfer = event(member, 'new_host');
  await ok(outsider, 'leave_room', { roomId: created.roomId });
  assert.equal((await transfer).hostId, member.id);
  assert.equal((await join(member, created.roomId)).state.isHost, true);
  await rejected(outsider, 'join_room', { roomId: created.roomId, username: 'Host', hostToken: created.hostToken }, 'INVALID_HOST_TOKEN');
  await rejected(outsider, 'join_room', { roomId: created.roomId, username: 'Host', resumeToken: created.resumeToken }, 'INVALID_RESUME_TOKEN');
  await ok(member, 'party_control', { roomId: created.roomId, action: 'play', currentTime: 2 });
});

test('disconnect grace transfers host and invalidates the old host bearer without restoring privilege on resume', async (t) => {
  const { host, member, outsider } = await fixture(t, { ROOM_RECONNECT_GRACE_MS: 120 });
  const created = await create(host, trailer);
  await join(member, created.roomId);
  const transfer = event(member, 'new_host');
  host.disconnect();
  assert.equal((await transfer).hostId, member.id);
  await rejected(outsider, 'join_room', { roomId: created.roomId, username: 'Host', hostToken: created.hostToken }, 'INVALID_HOST_TOKEN');
  const resumed = await join(outsider, created.roomId, { resumeToken: created.resumeToken });
  assert.equal(resumed.state.isHost, false);
  await rejected(outsider, 'party_control', { roomId: created.roomId, action: 'pause', currentTime: 0 }, 'HOST_ONLY');
});

test('empty rooms survive reconnect grace, expire after TTL, and connected rooms do not expire', async (t) => {
  const { host, member, outsider, io } = await fixture(t, { ROOM_TTL_MS: 400, ROOM_RECONNECT_GRACE_MS: 50 });
  const created = await create(host, trailer);
  const disconnected = new Promise((resolve) => io.sockets.sockets.get(host.id).once('disconnect', resolve));
  host.disconnect();
  await disconnected;
  await wait(90);
  const resumed = await join(member, created.roomId, { hostToken: created.hostToken, resumeToken: created.resumeToken });
  assert.equal(resumed.state.isHost, true);
  await wait(450);
  assert.equal((await join(outsider, created.roomId)).state.users.length, 2);
  await ok(member, 'leave_room', { roomId: created.roomId });
  await ok(outsider, 'leave_room', { roomId: created.roomId });
  await wait(450);
  await rejected(outsider, 'join_room', { roomId: created.roomId, username: 'Guest' }, 'ROOM_NOT_FOUND');
});

test('title and source changes broadcast authoritative state; arbitrary URLs are never forwarded', async (t) => {
  const { host, member } = await fixture(t);
  const { roomId } = await create(host, movie);
  await join(member, roomId);
  const now = event(member, 'now_playing', (value) => value.provider === 'trailer');
  const source = event(member, 'source_changed', (value) => value.provider === 'trailer');
  const snapshot = event(member, 'room_state', (value) => value.nowPlaying?.provider === 'trailer');
  await ok(host, 'select_title', { roomId, nowPlaying: trailer });
  assert.equal((await now).youtubeKey, trailer.youtubeKey);
  assert.equal((await source).syncMode, 'player-api');
  assert.equal((await snapshot).currentTime < 1, true);
  const nextSource = event(member, 'source_changed', (value) => value.provider === 'vidlink');
  const changed = await ok(host, 'change_source', { roomId, provider: 'vidlink', tmdbId: 550 });
  assert.equal(changed.state.nowPlaying.youtubeKey, trailer.youtubeKey);
  assert.equal(changed.state.syncMode, 'cue-only');
  assert.equal((await nextSource).url, null);
  for (const url of ['https://example.com/video', 'javascript:alert(1)', 'http://127.0.0.1', 'https://user:pass@example.com', 'https://10.0.0.1']) {
    await rejected(host, 'change_url', { roomId, url }, 'UNSUPPORTED_URL');
    await rejected(host, 'change_source', { roomId, provider: 'autoembed', url }, 'UNSUPPORTED_URL');
  }
  assert.equal((await join(member, roomId)).state.nowPlaying.provider, 'vidlink');
});

test('drift corrections are trailer-only, nonbuffering, nonhost and over two seconds', async (t) => {
  const { host, member } = await fixture(t);
  const { roomId } = await create(host, trailer);
  await join(member, roomId);
  await ok(host, 'party_control', { roomId, action: 'pause', currentTime: 30 });
  const forced = event(member, 'force_sync');
  assert.equal((await ok(member, 'report_drift', { roomId, clientTime: 0 })).corrected, true);
  assert.deepEqual(await forced, { currentTime: 30, isPlaying: false, syncMode: 'player-api' });
  let corrections = 0;
  member.on('force_sync', () => corrections++);
  for (const extra of [{ clientTime: 29 }, { clientTime: 0, buffering: true }, { clientTime: 0, isBuffering: true }]) {
    assert.equal((await ok(member, 'report_drift', { roomId, ...extra })).corrected, false);
  }
  assert.equal((await ok(host, 'report_drift', { roomId, clientTime: 0 })).corrected, false);
  await ok(host, 'select_title', { roomId, nowPlaying: movie });
  await ok(host, 'party_control', { roomId, action: 'pause', currentTime: 30 });
  const opaque = await ok(member, 'report_drift', { roomId, clientTime: 0 });
  assert.equal(opaque.corrected, false);
  assert.equal(opaque.syncMode, 'cue-only');
  assert.equal(corrections, 0);
  await rejected(member, 'report_drift', { roomId, clientTime: -1 }, 'INVALID_TIME');
});

test('chat uses membership identity and validates message lengths and text', async (t) => {
  const { host, member } = await fixture(t);
  const { roomId } = await create(host);
  await join(member, roomId);
  const message = event(host, 'receive_message', (value) => !value.system);
  await ok(member, 'send_message', { roomId, username: 'Host', message: ' Hello party ' });
  const received = await message;
  assert.equal(received.username, 'Guest');
  assert.equal(received.id, member.id);
  assert.equal(received.message, 'Hello party');
  for (const invalid of ['', ' ', 'x'.repeat(1001), '\u0000attack', { text: 'not text' }]) {
    await rejected(member, 'send_message', { roomId, message: invalid }, 'INVALID_INPUT');
  }
});

test('signaling is bounded and restricted to connected same-room members', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const { roomId } = await create(host);
  await join(member, roomId);
  await create(outsider);
  const sdp = { type: 'offer', sdp: 'v=0\r\n' };
  const offer = event(member, 'webrtc_offer');
  await ok(host, 'webrtc_offer', { target: member.id, sdp });
  assert.deepEqual(await offer, { sdp, sender: host.id });
  await rejected(host, 'webrtc_offer', { target: outsider.id, sdp }, 'INVALID_TARGET');
  await rejected(outsider, 'webrtc_offer', { target: member.id, sdp }, 'INVALID_TARGET');
  await rejected(host, 'webrtc_offer', { target: member.id, sdp: { type: 'answer', sdp: 'v=0' } }, 'INVALID_SIGNAL');
  await rejected(host, 'webrtc_offer', { target: member.id, sdp: { type: 'offer', sdp: 'x'.repeat(32769) } }, 'INVALID_SIGNAL');
  const answer = event(host, 'webrtc_answer');
  await ok(member, 'webrtc_answer', { target: host.id, sdp: { type: 'answer', sdp: 'v=0' } });
  assert.equal((await answer).sender, member.id);
  const candidate = event(host, 'webrtc_ice_candidate');
  await ok(member, 'webrtc_ice_candidate', { target: host.id, candidate: { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await candidate).candidate.candidate, 'candidate:test');
  await rejected(member, 'webrtc_ice_candidate', { target: host.id, candidate: { candidate: 'x'.repeat(4097) } }, 'INVALID_SIGNAL');
});

test('snapshots, broadcasts, signaling, and join acknowledgments never expose private tokens', async (t) => {
  const { host, member, outsider } = await fixture(t);
  const captured = [];
  for (const socket of [host, member, outsider]) socket.onAny((name, payload) => captured.push({ name, payload }));
  const created = await create(host, trailer);
  const joined = await join(member, created.roomId);
  const other = await join(outsider, created.roomId);
  await ok(host, 'party_control', { roomId: created.roomId, action: 'pause', currentTime: 2 });
  await ok(host, 'change_source', { roomId: created.roomId, provider: 'autoembed', tmdbId: 550 });
  const snapshot = await join(member, created.roomId, { resumeToken: joined.resumeToken });
  assert.equal('hostToken' in snapshot, false);
  const publicJson = JSON.stringify([captured, created.state, joined.state, other.state, snapshot.state]);
  for (const secret of [created.hostToken, created.resumeToken, joined.resumeToken, other.resumeToken]) assert.equal(publicJson.includes(secret), false);
  assert.equal(publicJson.includes('resumeToken'), false);
  assert.equal(publicJson.includes('hostToken'), false);
});

test('per-IP creation throttling spans clients and rooms/users have bounded capacity', async (t) => {
  const { host, member, outsider } = await fixture(t, { ROOM_CREATE_LIMIT: 2, ROOM_CREATE_WINDOW_MS: 10000 });
  await create(host);
  await create(member);
  await rejected(outsider, 'create_room', { username: 'Third host' }, 'RATE_LIMITED');
});

test('room and user limits return actionable errors without allocating a member', async (t) => {
  const { host, member, outsider } = await fixture(t, { ROOM_MAX_ROOMS: 1, ROOM_MAX_USERS: 2 });
  const { roomId } = await create(host);
  const joined = await join(member, roomId);
  await rejected(outsider, 'create_room', { username: 'Other host' }, 'ROOM_LIMIT');
  await rejected(outsider, 'join_room', { roomId, username: 'Third member' }, 'ROOM_FULL');
  await join(member, roomId, { resumeToken: joined.resumeToken });
  await ok(member, 'leave_room', { roomId });
  assert.equal((await join(outsider, roomId)).state.users.length, 2);
});

test('creation validates names and optional titles before allocating rooms', async (t) => {
  const { host, member } = await fixture(t, { ROOM_MAX_ROOMS: 1 });
  for (const username of ['', ' ', 'x'.repeat(81), '\u0000user', 5]) {
    await rejected(host, 'create_room', { username }, 'INVALID_INPUT');
  }
  await rejected(host, 'create_room', { username: 'Host', name: 'x'.repeat(121) }, 'INVALID_INPUT');
  await rejected(host, 'create_room', { username: 'Host', nowPlaying: { ...movie, provider: 'unregistered' } }, 'INVALID_PROVIDER');
  const created = await create(host, { ...movie, title: '' });
  assert.equal(created.state.nowPlaying.title, '');
  await rejected(member, 'join_room', { roomId: created.roomId, username: '' }, 'INVALID_INPUT');
  assert.equal((await join(member, created.roomId)).state.users.length, 2);
});

test('disconnected empty rooms expire and old resume/host bearers cannot resurrect them', async (t) => {
  const { host, member, io } = await fixture(t, { ROOM_TTL_MS: 150, ROOM_RECONNECT_GRACE_MS: 40 });
  const created = await create(host);
  const disconnected = new Promise((resolve) => io.sockets.sockets.get(host.id).once('disconnect', resolve));
  host.disconnect();
  await disconnected;
  await wait(220);
  await rejected(member, 'join_room', {
    roomId: created.roomId, username: 'Host', hostToken: created.hostToken, resumeToken: created.resumeToken,
  }, 'ROOM_NOT_FOUND');
});

test('cleanup is idempotent and removes engine connection and per-socket handlers', async (t) => {
  const { host, io, cleanup } = await fixture(t);
  await create(host, trailer);
  const serverSocket = io.sockets.sockets.get(host.id);
  assert.equal(serverSocket.listenerCount('sync_state'), 1);
  assert.equal(io.listenerCount('connection'), 1);
  cleanup();
  cleanup();
  assert.equal(serverSocket.listenerCount('sync_state'), 0);
  assert.equal(serverSocket.listenerCount('join_room'), 0);
  assert.equal(io.listenerCount('connection'), 0);
});

async function deployedServer(t, configuration) {
  const entry = path.resolve(__dirname, '../server.js');
  const script = `
    const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once('listening', () => process.stdout.write('PARTY_TEST_PORT=' + this.address().port + '\\n'));
      return listen.apply(this, args);
    };
    require(${JSON.stringify(entry)});
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: path.dirname(entry),
    env: { ...process.env, PORT: '0', TMDB_API_KEY: '', DOTENV_CONFIG_QUIET: 'true',
      CORS_ORIGIN: '', PUBLIC_WEB_ORIGIN: '', PUBLIC_API_BASE: '', ...configuration },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  const port = await new Promise((resolve, reject) => {
    // Cold dependency loading can be slow on Windows; no external media is requested.
    const timeout = setTimeout(() => reject(new Error('Backend did not listen in time')), 60000);
    const collect = (chunk) => {
      logs += chunk.toString();
      const match = logs.match(/PARTY_TEST_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Backend exited before listening')); });
  });
  return { url: `http://127.0.0.1:${port}`, logs: () => logs };
}

async function socketOrigin(url, origin, transport, accepted) {
  const socket = clientIo(url, { transports: [transport], extraHeaders: { Origin: origin }, reconnection: false, autoConnect: false, timeout: 2000 });
  try {
    const result = event(socket, accepted ? 'connect' : 'connect_error');
    socket.connect();
    await result;
    assert.equal(socket.connected, accepted);
  } finally { socket.disconnect(); }
}

test('deployed backend uses one comma-separated REST and Socket.IO origin allowlist and safe health flags', async (t) => {
  const { url } = await deployedServer(t, {
    NODE_ENV: 'production', CORS_ORIGIN: 'https://watch.example.com, https://party.example.com',
    PUBLIC_WEB_ORIGIN: 'https://watch.example.com', PUBLIC_API_BASE: 'https://api.example.com/api',
  });
  for (const origin of ['https://watch.example.com', 'https://party.example.com']) {
    const response = await fetch(`${url}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const health = await response.json();
    assert.deepEqual(health.publicDeployment, { configured: true });
    assert.equal(health.tmdb, false);
    assert.equal(JSON.stringify(health).includes('example.com'), false);
    assert.equal(JSON.stringify(health).includes('TMDB_API_KEY'), false);
    await socketOrigin(url, origin, 'websocket', true);
    await socketOrigin(url, origin, 'polling', true);
  }
  assert.equal((await fetch(`${url}/api/health`, { headers: { Origin: 'https://evil.example.com' } })).status, 403);
  for (const transport of ['websocket', 'polling']) await socketOrigin(url, 'https://evil.example.com', transport, false);
  const preflight = await fetch(`${url}/api/health`, { method: 'OPTIONS', headers: { Origin: 'https://watch.example.com', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(preflight.status, 204);
});

test('production without CORS_ORIGIN rejects browser origins, warns, and has no public deployment readiness', async (t) => {
  const { url, logs } = await deployedServer(t, { NODE_ENV: 'production', PUBLIC_WEB_ORIGIN: 'http://localhost:5173', PUBLIC_API_BASE: 'https://api.example.com' });
  assert.match(logs(), /CORS_ORIGIN is missing/);
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).publicDeployment, { configured: false });
  assert.equal((await fetch(`${url}/api/health`, { headers: { Origin: 'http://localhost:5173' } })).status, 403);
  await socketOrigin(url, 'https://watch.example.com', 'websocket', false);
});

test('development defaults allow localhost and reject unconfigured public browser origins', async (t) => {
  const { url } = await deployedServer(t, { NODE_ENV: 'development' });
  const response = await fetch(`${url}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal((await fetch(`${url}/api/health`, { headers: { Origin: 'https://unconfigured.example.com' } })).status, 403);
  await socketOrigin(url, 'http://localhost:5173', 'websocket', true);
});
