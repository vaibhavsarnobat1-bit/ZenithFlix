import { io } from 'socket.io-client';
import { API_ORIGIN } from './config';

export function roomCredentials(roomId) {
  try { return JSON.parse(sessionStorage.getItem(`zf.room.${roomId}`) || '{}'); } catch { return {}; }
}

export function saveRoomCredentials(roomId, credentials) {
  try { sessionStorage.setItem(`zf.room.${roomId}`, JSON.stringify(credentials)); return true; } catch { return false; }
}

export function partyRequest(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (error, result) => {
      if (error) return reject(new Error('Party server did not respond. Check the public backend URL and connection.'));
      if (!result?.ok) {
        const failure = new Error(result?.error || 'Party request failed.');
        failure.code = result?.code;
        return reject(failure);
      }
      resolve(result);
    });
  });
}

/** The server reserves a cryptographic room ID; opening a URL never creates one. */
export async function createParty({ name, username = 'Guest', nowPlaying }) {
  const socket = io(API_ORIGIN, { transports: ['websocket', 'polling'], autoConnect: false, reconnection: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cannot reach the party backend. Start it locally or configure its public HTTPS URL.')), 10000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Cannot connect to the party backend. Check deployment and CORS settings.')); });
      socket.connect();
    });
    const result = await partyRequest(socket, 'create_room', { name: name?.slice(0, 120), username, nowPlaying });
    if (!saveRoomCredentials(result.roomId, { hostToken: result.hostToken, resumeToken: result.resumeToken })) {
      await partyRequest(socket, 'leave_room', { roomId: result.roomId });
      throw new Error('Browser session storage is unavailable. Allow it before creating a party so your host session can resume.');
    }
    return result.roomId;
  } finally {
    socket.disconnect();
  }
}
