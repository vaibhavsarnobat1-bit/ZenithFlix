const crypto = require('node:crypto');
const { byId } = require('../lib/providers');

const TOKEN = /^[a-f0-9]{32}$/;
const YOUTUBE_KEY = /^[A-Za-z0-9_-]{11}$/;
const MAX_TIME = 7 * 24 * 60 * 60;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = () => crypto.randomBytes(16).toString('hex');

class PartyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => { throw new PartyError(code, message); };
function text(value, label, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || (!value.trim() && fallback !== '') || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('INVALID_INPUT', `${label} must be ${fallback === '' ? '' : 'nonempty '}text of at most ${max} characters.`);
  }
  return value.trim();
}
function positiveId(value, label, allowZero = false) {
  const number = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    fail('INVALID_INPUT', `${label} must be a ${allowZero ? 'nonnegative' : 'positive'} integer.`);
  }
  return number;
}
function playbackTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_TIME) {
    fail('INVALID_TIME', 'Playback time must be a finite number between 0 and 604800 seconds.');
  }
  return value;
}
function titleState(input) {
  if (!object(input)) fail('INVALID_INPUT', 'nowPlaying must be an object.');
  const provider = input.provider === undefined ? 'autoembed' : input.provider;
  if (typeof provider !== 'string' || !byId(provider)) fail('INVALID_PROVIDER', 'Choose a registered playback provider.');
  const type = input.type === undefined ? 'movie' : input.type;
  if (!['movie', 'tv'].includes(type)) fail('INVALID_INPUT', 'Title type must be movie or tv.');
  const youtubeKey = input.youtubeKey == null ? null : input.youtubeKey;
  if (youtubeKey !== null && (typeof youtubeKey !== 'string' || !YOUTUBE_KEY.test(youtubeKey))) {
    fail('INVALID_INPUT', 'YouTube keys must contain exactly 11 URL-safe characters.');
  }
  if (byId(provider).kind === 'trailer' && !youtubeKey) fail('INVALID_INPUT', 'Trailer playback requires a valid YouTube key.');
  const tmdbId = positiveId(input.tmdbId, 'TMDB ID', byId(provider).kind === 'trailer' && Boolean(youtubeKey));
  let poster = null;
  if (input.poster != null) {
    if (typeof input.poster !== 'string' || input.poster.length > 500 ||
        !(/^\/[A-Za-z0-9_./-]+$/.test(input.poster) && !input.poster.startsWith('//')) &&
        !/^https:\/\/image\.tmdb\.org\/[A-Za-z0-9_./-]+$/.test(input.poster)) {
      fail('INVALID_INPUT', 'Poster must be a TMDB image path or HTTPS TMDB image URL.');
    }
    poster = input.poster;
  }
  return {
    type, tmdbId, provider, youtubeKey, poster,
    title: text(input.title, 'Title', 200, ''),
    season: positiveId(input.season ?? 1, 'Season'),
    episode: positiveId(input.episode ?? 1, 'Episode'),
  };
}

// Private membership/token records are deliberately separate from public snapshots.
module.exports = (io, options = {}) => {
  const setting = (name, fallback) => {
    const value = Number(options[name] ?? process.env[name] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  const ttl = setting('ROOM_TTL_MS', 21600000);
  const grace = setting('ROOM_RECONNECT_GRACE_MS', 15000);
  const maxRooms = setting('ROOM_MAX_ROOMS', 1000);
  const maxUsers = setting('ROOM_MAX_USERS', 50);
  const createLimit = setting('ROOM_CREATE_LIMIT', 10);
  const createWindow = setting('ROOM_CREATE_WINDOW_MS', 60000);
  const rooms = new Map();
  const memberships = new Map();
  const creationRates = new Map();
  const handlers = new Map();
  let stopped = false;

  const users = (room) => [...room.members.values()].filter((member) => member.socketId)
    .map((member) => ({ id: member.socketId, username: member.username }));
  const connected = (room) => [...room.members.values()].filter((member) => member.socketId);
  const projectedTime = (room) => Math.min(MAX_TIME, room.currentTime + (room.isPlaying ? Math.max(0, Date.now() - room.updatedAt) / 1000 : 0));
  const syncMode = (room) => room.nowPlaying && byId(room.nowPlaying.provider).kind === 'trailer' ? 'player-api' : 'cue-only';
  const state = (room, socketId) => ({
    roomId: room.id, name: room.name, hostId: room.host?.socketId || null,
    isHost: Boolean(socketId && room.host?.socketId === socketId), users: users(room),
    nowPlaying: room.nowPlaying ? { ...room.nowPlaying } : null,
    currentUrl: null, source: room.nowPlaying?.provider || null, tmdbId: room.nowPlaying?.tmdbId ?? null,
    currentTime: projectedTime(room), isPlaying: room.isPlaying,
    updatedAt: room.updatedAt, serverTime: Date.now(), syncMode: syncMode(room),
  });
  const syncPacket = (room) => ({ currentTime: projectedTime(room), isPlaying: room.isPlaying, syncMode: syncMode(room) });
  const broadcastState = (room) => {
    for (const member of connected(room)) io.to(member.socketId).emit('room_state', state(room, member.socketId));
  };
  const system = (room, message) => io.to(room.id).emit('receive_message', {
    username: 'system', message, system: true, timestamp: new Date().toISOString(),
  });
  const publishUsers = (room) => io.to(room.id).emit('update_users', users(room));
  function expire(room) {
    clearTimeout(room.hostTimer);
    rooms.delete(room.id);
    room.members.clear();
  }
  function prune() {
    const now = Date.now();
    for (const room of rooms.values()) if (room.emptySince !== null && now - room.emptySince >= ttl) expire(room);
    for (const [ip, rate] of creationRates) if (now - rate.start >= createWindow) creationRates.delete(ip);
  }
  function findRoom(roomId) {
    if (typeof roomId !== 'string' || !TOKEN.test(roomId)) fail('INVALID_ROOM_ID', 'Room IDs must be 32 lowercase hexadecimal characters.');
    const room = rooms.get(roomId);
    if (room && room.emptySince !== null && Date.now() - room.emptySince >= ttl) expire(room);
    if (!rooms.has(roomId)) fail('ROOM_NOT_FOUND', 'This party does not exist or has expired. Create a new party.');
    return room;
  }
  function memberRoom(socket, data, hostOnly = false) {
    const room = findRoom(data.roomId);
    const membership = memberships.get(socket.id);
    if (!membership || membership.room !== room || membership.member.socketId !== socket.id) {
      fail('NOT_MEMBER', 'Join this party before using this event.');
    }
    if (hostOnly && room.host !== membership.member) fail('HOST_ONLY', 'Only the joined party host can control playback.');
    return room;
  }
  function transferHost(room) {
    clearTimeout(room.hostTimer);
    room.hostTimer = null;
    const next = connected(room)[0];
    // With nobody connected, preserve the creator's bearer until an actual transfer.
    if (!next) return;
    room.host = next;
    room.hostToken = null;
    room.graceUntil = 0;
    io.to(room.id).emit('new_host', { hostId: next.socketId, username: next.username });
    broadcastState(room);
  }
  function detach(socket, explicit = false) {
    const membership = memberships.get(socket.id);
    if (!membership) return;
    const { room, member } = membership;
    memberships.delete(socket.id);
    socket.leave(room.id);
    member.socketId = null;
    if (explicit) room.members.delete(member.resumeToken);
    io.to(room.id).emit('user_left', { id: socket.id, username: member.username });
    if (!connected(room).length) room.emptySince = Date.now();
    if (room.host === member) {
      clearTimeout(room.hostTimer);
      if (explicit) {
        room.host = null;
        room.hostToken = null;
        room.graceUntil = 0;
        transferHost(room);
      } else {
        room.graceUntil = Date.now() + grace;
        room.hostTimer = setTimeout(() => { room.hostTimer = null; transferHost(room); }, grace);
        room.hostTimer.unref?.();
      }
    }
    publishUsers(room);
    broadcastState(room);
    system(room, `${member.username} ${explicit ? 'left' : 'disconnected'}`);
  }
  function attach(socket, room, member) {
    const existing = memberships.get(socket.id);
    if (existing && (existing.room !== room || existing.member !== member)) fail('ALREADY_JOINED', 'Leave your current party before joining another.');
    if (member.socketId === socket.id) return;
    // A resume bearer identifies one logical member, including overlapping reconnects.
    if (member.socketId) {
      const oldId = member.socketId;
      const oldSocket = io.sockets.sockets.get(oldId);
      memberships.delete(oldId);
      oldSocket?.leave(room.id);
      oldSocket?.emit('session_replaced', { roomId: room.id, message: 'This party session resumed on another connection.' });
      io.to(room.id).emit('user_left', { id: oldId, username: member.username });
    }
    member.socketId = socket.id;
    memberships.set(socket.id, { room, member });
    socket.join(room.id);
    room.emptySince = null;
    if (room.host === member) {
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
      room.graceUntil = 0;
    } else if (!room.host || (!room.host.socketId && Date.now() >= room.graceUntil)) {
      transferHost(room);
    }
    socket.to(room.id).emit('user_joined', { id: socket.id, username: member.username });
    publishUsers(room);
    broadcastState(room);
    socket.emit('host_sync', syncPacket(room));
    if (room.nowPlaying) socket.emit('now_playing', { ...room.nowPlaying, by: 'room' });
    if (connected(room).length > 1) system(room, `${member.username} joined the room`);
  }
  function applyTitle(room, next, socket) {
    room.nowPlaying = next;
    room.currentTime = 0;
    room.isPlaying = true;
    room.updatedAt = Date.now();
    io.to(room.id).emit('now_playing', { ...next, by: memberships.get(socket.id).member.username });
    io.to(room.id).emit('source_changed', {
      url: null, source: next.provider, provider: next.provider, tmdbId: next.tmdbId,
      type: next.type, season: next.season, episode: next.episode, youtubeKey: next.youtubeKey,
      syncMode: syncMode(room),
    });
    broadcastState(room);
    io.to(room.id).emit('host_sync', syncPacket(room));
  }
  function onConnection(socket) {
    if (stopped) return;
    const listeners = [];
    function on(event, callback) {
      const handler = (data, ack) => {
        if (typeof data === 'function') { ack = data; data = {}; }
        try {
          if (stopped) fail('SERVER_CLOSED', 'The party service has stopped.');
          if (!object(data)) fail('INVALID_INPUT', 'Event payload must be an object.');
          const result = callback(data);
          if (typeof ack === 'function') ack({ ok: true, ...result });
        } catch (error) {
          const response = {
            ok: false, code: error instanceof PartyError ? error.code : 'INTERNAL_ERROR',
            error: error instanceof PartyError ? error.message : 'The party request failed. Please try again.',
          };
          socket.emit('party_error', { ...response, event });
          if (typeof ack === 'function') ack(response);
        }
      };
      socket.on(event, handler);
      listeners.push([event, handler]);
    }
    on('create_room', (data) => {
      prune();
      // Do not trust spoofable forwarding headers as an IP identity.
      const ip = socket.handshake.address || 'unknown';
      let rate = creationRates.get(ip);
      if (!rate) {
        if (creationRates.size >= 10000) fail('RATE_LIMITED', 'Party creation is busy. Please try again later.');
        rate = { start: Date.now(), count: 0 };
        creationRates.set(ip, rate);
      }
      if (++rate.count > createLimit) fail('RATE_LIMITED', 'Too many party creation attempts. Please try again later.');
      if (memberships.has(socket.id)) fail('ALREADY_JOINED', 'Leave your current party before creating another.');
      if (rooms.size >= maxRooms) fail('ROOM_LIMIT', 'The party service is full. Please try again later.');
      const username = text(data.username, 'Username', 80);
      const name = text(data.name, 'Party name', 120, 'Watch party');
      const nowPlaying = data.nowPlaying == null ? null : titleState(data.nowPlaying);
      let roomId;
      do { roomId = token(); } while (rooms.has(roomId));
      const hostToken = token();
      const member = { username, resumeToken: token(), socketId: null };
      const room = {
        id: roomId, name, host: member, creator: member, hostToken,
        members: new Map([[member.resumeToken, member]]), nowPlaying,
        currentTime: 0, isPlaying: Boolean(nowPlaying), updatedAt: Date.now(),
        emptySince: null, hostTimer: null, graceUntil: 0, nonce: 0,
      };
      rooms.set(roomId, room);
      attach(socket, room, member);
      return { roomId, hostToken, resumeToken: member.resumeToken, state: state(room, socket.id) };
    });
    on('join_room', (data) => {
      const room = findRoom(data.roomId);
      const username = text(data.username, 'Username', 80);
      const existing = memberships.get(socket.id);
      if (existing && existing.room !== room) fail('ALREADY_JOINED', 'Leave your current party before joining another.');
      let member;
      if (data.resumeToken !== undefined) {
        if (typeof data.resumeToken !== 'string' || !TOKEN.test(data.resumeToken) || !room.members.has(data.resumeToken)) {
          fail('INVALID_RESUME_TOKEN', 'This resume token is invalid. Join without it as a new member.');
        }
        member = room.members.get(data.resumeToken);
      }
      if (data.hostToken !== undefined) {
        if (typeof data.hostToken !== 'string' || !TOKEN.test(data.hostToken) || !room.hostToken ||
            !crypto.timingSafeEqual(Buffer.from(data.hostToken), Buffer.from(room.hostToken)) || room.host !== room.creator) {
          fail('INVALID_HOST_TOKEN', 'This host token is invalid or host ownership has transferred.');
        }
        if (member && member !== room.creator) fail('INVALID_HOST_TOKEN', 'Host and resume tokens must identify the same creator.');
        member = room.creator;
      }
      if (existing && member && member !== existing.member) fail('ALREADY_JOINED', 'Leave your current session before resuming another member.');
      member = member || existing?.member;
      if (!member) {
        if (room.members.size >= maxUsers) fail('ROOM_FULL', 'This party has reached its member limit, including reconnecting members.');
        member = { username, resumeToken: token(), socketId: null };
        room.members.set(member.resumeToken, member);
      }
      attach(socket, room, member);
      return { state: state(room, socket.id), resumeToken: member.resumeToken };
    });
    on('leave_room', (data) => {
      memberRoom(socket, data);
      detach(socket, true);
      return {};
    });
    on('select_title', (data) => {
      const room = memberRoom(socket, data, true);
      const next = titleState(data.nowPlaying);
      applyTitle(room, next, socket);
      system(room, `Now playing · ${next.title || `TMDB ${next.tmdbId}`}`);
      return { state: state(room, socket.id) };
    });
    on('change_source', (data) => {
      const room = memberRoom(socket, data, true);
      if (data.url != null) fail('UNSUPPORTED_URL', 'Custom URLs are disabled. Select a registered provider instead.');
      if (!room.nowPlaying) fail('NO_TITLE', 'Select a title before changing its provider.');
      const provider = data.provider ?? data.source;
      if (data.provider !== undefined && data.source !== undefined && data.provider !== data.source) fail('INVALID_PROVIDER', 'Provider and source must agree.');
      if (typeof provider !== 'string' || !byId(provider)) fail('INVALID_PROVIDER', 'Choose a registered playback provider.');
      const next = titleState({
        ...room.nowPlaying, provider,
        tmdbId: data.tmdbId ?? room.nowPlaying.tmdbId, type: data.type ?? room.nowPlaying.type,
        season: data.season ?? room.nowPlaying.season, episode: data.episode ?? room.nowPlaying.episode,
        youtubeKey: data.youtubeKey === undefined ? room.nowPlaying.youtubeKey : data.youtubeKey,
      });
      applyTitle(room, next, socket);
      return { state: state(room, socket.id) };
    });
    on('change_url', (data) => {
      memberRoom(socket, data, true);
      fail('UNSUPPORTED_URL', 'Custom URLs are disabled for safety. Use select_title or change_source with a registered provider.');
    });
    on('party_control', (data) => {
      const room = memberRoom(socket, data, true);
      if (!['play', 'pause', 'seek'].includes(data.action)) fail('INVALID_ACTION', 'Playback action must be play, pause, or seek.');
      const time = data.currentTime === undefined && data.action !== 'seek' ? projectedTime(room) : playbackTime(data.currentTime);
      room.currentTime = time;
      if (data.action !== 'seek') room.isPlaying = data.action === 'play';
      room.updatedAt = Date.now();
      const control = {
        action: data.action, currentTime: time, isPlaying: room.isPlaying,
        nonce: ++room.nonce, syncMode: syncMode(room), from: socket.id,
      };
      io.to(room.id).emit('party_control', control);
      return { state: state(room, socket.id) };
    });
    on('sync_state', (data) => {
      const room = memberRoom(socket, data, true);
      const time = playbackTime(data.currentTime);
      if (typeof data.isPlaying !== 'boolean') fail('INVALID_INPUT', 'isPlaying must be a boolean.');
      room.currentTime = time;
      room.isPlaying = data.isPlaying;
      room.updatedAt = Date.now();
      socket.to(room.id).emit('host_sync', syncPacket(room));
      return {};
    });
    on('report_drift', (data) => {
      const room = memberRoom(socket, data);
      const time = playbackTime(data.clientTime);
      if (data.buffering !== undefined && typeof data.buffering !== 'boolean') fail('INVALID_INPUT', 'buffering must be a boolean.');
      if (data.isBuffering !== undefined && typeof data.isBuffering !== 'boolean') fail('INVALID_INPUT', 'isBuffering must be a boolean.');
      const drift = Math.abs(time - projectedTime(room));
      const corrected = room.host?.socketId !== socket.id && syncMode(room) === 'player-api' &&
        !data.buffering && !data.isBuffering && drift > 2;
      if (corrected) socket.emit('force_sync', syncPacket(room));
      return { drift, corrected, syncMode: syncMode(room) };
    });
    on('send_message', (data) => {
      const room = memberRoom(socket, data);
      const message = text(data.message, 'Message', 1000);
      io.to(room.id).emit('receive_message', {
        id: socket.id, username: memberships.get(socket.id).member.username, message, timestamp: new Date().toISOString(),
      });
      return {};
    });
    for (const event of ['webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate']) {
      on(event, (data) => {
        const own = memberships.get(socket.id);
        if (!own) fail('NOT_MEMBER', 'Join a party before sending signaling.');
        const room = memberRoom(socket, { roomId: data.roomId ?? own.room.id });
        const target = typeof data.target === 'string' && memberships.get(data.target);
        if (!target || target.room !== room || data.target === socket.id) fail('INVALID_TARGET', 'Signaling target must be another connected member of this party.');
        let payload;
        if (event === 'webrtc_ice_candidate') {
          const candidate = data.candidate;
          if (!object(candidate) || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096 ||
              (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 100)) ||
              (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 65535)) ||
              (candidate.usernameFragment != null && (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256))) {
            fail('INVALID_SIGNAL', 'Invalid or oversized ICE candidate.');
          }
          payload = { candidate: {
            candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            ...(candidate.usernameFragment == null ? {} : { usernameFragment: candidate.usernameFragment }),
          } };
        } else {
          const type = event === 'webrtc_offer' ? 'offer' : 'answer';
          if (!object(data.sdp) || data.sdp.type !== type || typeof data.sdp.sdp !== 'string' || !data.sdp.sdp.trim() || data.sdp.sdp.length > 32768) {
            fail('INVALID_SIGNAL', 'Signaling requires a valid, bounded session description.');
          }
          payload = { sdp: { type, sdp: data.sdp.sdp } };
        }
        io.to(data.target).emit(event, { ...payload, sender: socket.id });
        return {};
      });
    }
    const disconnect = () => {
      detach(socket);
      handlers.delete(socket.id);
    };
    socket.on('disconnect', disconnect);
    listeners.push(['disconnect', disconnect]);
    handlers.set(socket.id, { socket, listeners });
  }
  io.on('connection', onConnection);
  const sweep = setInterval(prune, Math.min(ttl, createWindow, 1000));
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      if (connected(room).length) {
        const channel = io.to(room.id);
        if (room.host?.socketId) channel.except(room.host.socketId).emit('host_sync', syncPacket(room));
        else channel.emit('host_sync', syncPacket(room));
      }
    }
  }, 500);
  sweep.unref?.();
  heartbeat.unref?.();
  return function cleanup() {
    stopped = true;
    clearInterval(sweep);
    clearInterval(heartbeat);
    io.off('connection', onConnection);
    for (const room of rooms.values()) clearTimeout(room.hostTimer);
    for (const { socket, listeners } of handlers.values()) {
      for (const [event, handler] of listeners) socket.off(event, handler);
      const membership = memberships.get(socket.id);
      if (membership) socket.leave(membership.room.id);
    }
    rooms.clear();
    memberships.clear();
    creationRates.clear();
    handlers.clear();
  };
};
