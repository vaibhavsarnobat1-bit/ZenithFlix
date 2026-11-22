import { Peer } from 'peerjs';
import { io } from 'socket.io-client';
import { SOCKET_ORIGIN } from './config';

export function roomCredentials(roomId) {
  try { return JSON.parse(sessionStorage.getItem(`zf.room.${roomId}`) || '{}'); } catch { return {}; }
}

export function saveRoomCredentials(roomId, credentials) {
  try {
    sessionStorage.setItem(`zf.room.${roomId}`, JSON.stringify(credentials));
    if (credentials?.roomData) {
      localStorage.setItem(`zf.cache.room.${roomId}`, JSON.stringify(credentials.roomData));
    }
    return true;
  } catch { return false; }
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function partyRequest(socket, event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('No socket connection'));
    if (socket.isP2P) {
      return socket.request(event, payload).then(resolve).catch(reject);
    }
    socket.timeout(6000).emit(event, payload, (error, result) => {
      if (error) return reject(new Error('Party server did not respond.'));
      if (!result?.ok) {
        const failure = new Error(result?.error || 'Party request failed.');
        failure.code = result?.code;
        return reject(failure);
      }
      resolve(result);
    });
  });
}

/**
 * Universal Room Engine (Socket.IO + P2P WebRTC / Broadcast Mesh)
 * Works out of the box on Vercel without requiring a dedicated backend server!
 */
export async function createParty({ name, username = 'Host', nowPlaying }) {
  const roomId = generateRoomCode();
  const roomData = {
    roomId,
    name: name?.slice(0, 120) || 'ZenithFlix Room',
    hostId: 'host-' + Math.random().toString(36).slice(2, 8),
    isHost: true,
    users: [{ id: 'host', username, isHost: true, connected: true }],
    nowPlaying: nowPlaying || null,
    currentTime: 0,
    isPlaying: true,
    syncMode: 'cue-only',
    updatedAt: Date.now(),
  };

  saveRoomCredentials(roomId, {
    isHost: true,
    username,
    hostToken: 'host_' + roomId,
    resumeToken: 'resume_' + roomId,
    roomData,
  });

  return roomId;
}

/**
 * P2P WebRTC + BroadcastChannel Party Socket
 * Mimics socket.io client API so TheatreRoom works seamlessly
 */
export class P2PRoomSocket {
  constructor(roomId, username) {
    this.roomId = roomId;
    this.username = username;
    this.isP2P = true;
    this.connected = false;
    this.handlers = new Map();
    this.connections = new Map();
    this.peer = null;
    this.bc = typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel(`zf-party-${roomId}`) : null;
    this.credentials = roomCredentials(roomId);
    this.isHost = Boolean(this.credentials?.isHost);
    
    let initialRoom = this.credentials?.roomData;
    if (!initialRoom) {
      try {
        initialRoom = JSON.parse(localStorage.getItem(`zf.cache.room.${roomId}`) || 'null');
      } catch {}
    }

    this.state = initialRoom || {
      roomId,
      name: 'Theatre Room',
      hostId: this.isHost ? 'host' : null,
      isHost: this.isHost,
      users: [{ id: this.isHost ? 'host' : 'guest-' + Math.random().toString(36).slice(2, 6), username, isHost: this.isHost, connected: true }],
      nowPlaying: null,
      currentTime: 0,
      isPlaying: true,
      syncMode: 'cue-only',
      updatedAt: Date.now(),
    };

    if (this.bc) {
      this.bc.onmessage = (event) => this.handleMessage(event.data);
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emitLocal(event, ...args) {
    this.handlers.get(event)?.forEach((fn) => {
      try { fn(...args); } catch (e) { console.error('Party event error', e); }
    });
  }

  connect() {
    this.connected = true;
    setTimeout(() => {
      this.emitLocal('connect');
      this.initPeer();
    }, 50);
  }

  initPeer() {
    const cleanId = String(this.roomId).toLowerCase().replace(/[^a-z0-9]/g, '');
    const hostPeerId = `zenith-stream-${cleanId}`;

    if (this.isHost) {
      try {
        this.peer = new Peer(hostPeerId, { debug: 1 });
        this.peer.on('open', () => {
          this.broadcastState();
        });
        this.peer.on('connection', (conn) => {
          this.connections.set(conn.peer, conn);
          conn.on('open', () => {
            conn.send({ type: 'room_state', state: this.state });
          });
          conn.on('data', (data) => this.handleMessage(data, conn));
          conn.on('close', () => {
            this.connections.delete(conn.peer);
          });
        });
        this.peer.on('error', (err) => {
          // If host ID is taken, connect as guest
          if (err.type === 'unavailable-id') {
            this.isHost = false;
            this.peer?.destroy();
            this.connectAsGuest(hostPeerId);
          }
        });
      } catch (err) {
        console.warn('Peer host init fallback', err);
      }
    } else {
      this.connectAsGuest(hostPeerId);
    }
  }

  connectAsGuest(hostPeerId) {
    try {
      this.peer = new Peer(undefined, { debug: 1 });
      this.peer.on('open', () => {
        const conn = this.peer.connect(hostPeerId, { reliable: true });
        this.hostConn = conn;
        conn.on('open', () => {
          conn.send({ type: 'join_room', username: this.username });
        });
        conn.on('data', (data) => this.handleMessage(data));
      });
    } catch (e) {
      console.warn('Peer guest connect fallback', e);
    }
  }

  broadcast(msg) {
    if (this.bc) {
      try { this.bc.postMessage(msg); } catch {}
    }
    if (this.connections.size) {
      this.connections.forEach((conn) => {
        try { conn.send(msg); } catch {}
      });
    }
    if (this.hostConn && this.hostConn.open) {
      try { this.hostConn.send(msg); } catch {}
    }
  }

  broadcastState() {
    this.broadcast({ type: 'room_state', state: this.state });
    this.emitLocal('room_state', this.state);
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    
    if (msg.type === 'join_room') {
      const existing = this.state.users.find((u) => u.username === msg.username);
      if (!existing) {
        this.state.users.push({ id: 'u-' + Math.random().toString(36).slice(2, 6), username: msg.username, isHost: false, connected: true });
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'room_state') {
      this.state = { ...this.state, ...msg.state, isHost: this.isHost };
      this.emitLocal('room_state', this.state);
      return;
    }

    if (msg.type === 'party_control') {
      this.state.currentTime = msg.payload.currentTime;
      this.state.isPlaying = msg.payload.isPlaying;
      this.emitLocal('party_control', msg.payload);
      if (this.isHost) this.broadcastState();
      return;
    }

    if (msg.type === 'select_title') {
      this.state.nowPlaying = msg.payload.nowPlaying;
      this.state.currentTime = 0;
      this.emitLocal('select_title', msg.payload);
      if (this.isHost) this.broadcastState();
      return;
    }

    if (msg.type === 'change_source') {
      if (this.state.nowPlaying) {
        this.state.nowPlaying.provider = msg.payload.provider;
      }
      this.emitLocal('change_source', msg.payload);
      if (this.isHost) this.broadcastState();
      return;
    }

    if (msg.type === 'chat_message') {
      this.emitLocal('chat_message', msg.payload);
      return;
    }

    if (msg.type === 'member_buffer') {
      this.emitLocal('member_buffer', msg.payload);
      return;
    }
  }

  emit(event, payload) {
    if (event === 'send_message') {
      const chat = {
        id: 'msg-' + Date.now(),
        username: payload.username || this.username,
        message: payload.message,
        timestamp: Date.now(),
      };
      this.broadcast({ type: 'chat_message', payload: chat });
      this.emitLocal('chat_message', chat);
      return;
    }

    if (event === 'party_control') {
      this.state.currentTime = payload.currentTime;
      this.state.isPlaying = payload.isPlaying;
      this.broadcast({ type: 'party_control', payload });
      this.emitLocal('party_control', payload);
      return;
    }

    if (event === 'select_title') {
      this.state.nowPlaying = payload.nowPlaying;
      this.state.currentTime = 0;
      this.broadcast({ type: 'select_title', payload });
      this.emitLocal('select_title', payload);
      return;
    }

    if (event === 'change_source') {
      if (this.state.nowPlaying) this.state.nowPlaying.provider = payload.provider;
      this.broadcast({ type: 'change_source', payload });
      this.emitLocal('change_source', payload);
      return;
    }

    if (event === 'member_buffer') {
      this.broadcast({ type: 'member_buffer', payload });
      this.emitLocal('member_buffer', payload);
      return;
    }
  }

  request(event, payload) {
    return new Promise((resolve) => {
      if (event === 'join_room') {
        setTimeout(() => {
          this.broadcast({ type: 'join_room', username: payload.username || this.username });
          resolve({ ok: true, state: this.state, resumeToken: 'p2p_resume' });
        }, 150);
        return;
      }

      if (event === 'party_control' || event === 'select_title' || event === 'change_source') {
        this.emit(event, payload);
        resolve({ ok: true, state: this.state });
        return;
      }

      if (event === 'leave_room') {
        this.disconnect();
        resolve({ ok: true });
        return;
      }

      resolve({ ok: true });
    });
  }

  disconnect() {
    this.connected = false;
    try { this.bc?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.emitLocal('disconnect');
  }
}
