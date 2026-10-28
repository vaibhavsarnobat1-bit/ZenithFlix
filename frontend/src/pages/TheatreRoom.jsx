import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Check, Copy, Crown, Gauge, ListVideo, MessageSquare, Monitor, Pause, Play,
  RefreshCw, Search, Send, Share2, Users, Wifi, X,
} from 'lucide-react';
import Player from '../components/Player';
import { API_ORIGIN, PUBLIC_WEB_ORIGIN, mediaTypeOf, poster, titleOf, yearOf } from '../lib/config';
import { DEFAULT_SERVER } from '../lib/providers';
import { matchesYouTubeSync } from '../lib/youtube';
import { partyRequest, roomCredentials, saveRoomCredentials } from '../lib/party';
import { copyText, partyInvite, validRoomId } from '../lib/invite';
import { tmdb } from '../lib/api';
import { item, spring, stagger } from '../lib/motion';
import { Badge, SmartImage, toast } from '../components/ui';

const clock = (s) => {
  const s2 = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s2 / 3600);
  const m = Math.floor((s2 % 3600) / 60);
  const sec = String(s2 % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const seconds = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
const sourceKey = (now) => now ? [now.type, now.tmdbId, now.youtubeKey, now.season, now.episode, now.provider].join(':') : 'idle';
const emptyRoom = () => ({ name: 'Theatre Room', hostId: null, isHost: false, users: [], nowPlaying: null, currentTime: 0, isPlaying: false, syncMode: null });
const emptyPlayback = () => ({ ready: false, currentTime: 0, isPlaying: false, buffering: false, blocked: false, error: null, measuredAt: 0 });
const errorText = (error, fallback) => typeof error === 'string' ? error : error?.message || error?.error || fallback;

function Avatar({ name = '?', isHost, size = 'sm' }) {
  const palette = ['from-ember-500 to-primary', 'from-violet-500 to-secondary', 'from-cyan-500 to-sky-600', 'from-amber-500 to-orange-600', 'from-lime-500 to-emerald-600'];
  const c = palette[(String(name).charCodeAt(0) || 0) % palette.length];
  const s = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs';
  return (
    <div className={`relative grid ${s} flex-shrink-0 place-items-center rounded-full bg-gradient-to-br ${c} font-black text-white`}>
      {String(name)[0]?.toUpperCase() || 'G'}
      {isHost && (
        <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-gold">
          <Crown className="h-2 w-2 text-black" />
        </span>
      )}
    </div>
  );
}

function Message({ msg, mine }) {
  if (msg.system) {
    return (
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-textMuted">
        {msg.message}
      </motion.p>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.snappy} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {!mine && <span className="mb-1 px-1 text-[10px] font-semibold text-textMuted">{msg.username}</span>}
      <div className={`max-w-[85%] break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${mine ? 'rounded-tr-sm bg-ember-gradient text-white shadow-glow-sm' : 'rounded-tl-sm border border-white/[0.07] bg-white/[0.05] text-textMain'}`}>
        {msg.message}
      </div>
      <span className="mt-1 px-1 text-[9.5px] tabular text-textMuted/70">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </motion.div>
  );
}

/** Search-and-queue drawer, available only to the connected room host. */
function QueuePanel({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const deb = useRef(null);

  useEffect(() => {
    let active = true;
    clearTimeout(deb.current);
    if (q.trim().length < 2) {
      setRows([]);
      setBusy(false);
      return undefined;
    }
    setBusy(true);
    deb.current = setTimeout(() => {
      tmdb.search(q).then((r) => active && setRows(r.slice(0, 12))).catch(() => active && setRows([])).finally(() => active && setBusy(false));
    }, 320);
    return () => { active = false; clearTimeout(deb.current); };
  }, [q]);

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.soft} className="max-h-[35dvh] flex-shrink-0 overflow-y-auto border-b border-white/[0.07] bg-black/55 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4 py-3">
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Search className="h-3.5 w-3.5 text-textMuted" />}
        <input autoFocus aria-label="Search for a title" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search TMDB to queue for the room…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-textMuted/60" />
        <button onClick={onClose} className="p-1.5 text-textMuted hover:text-white" aria-label="Close title search"><X className="h-4 w-4" /></button>
      </div>
      {q.trim().length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
          {rows.map((m) => (
            <button key={`${m.media_type}-${m.id}`} onClick={() => onPick(m)} className="group w-[86px] flex-shrink-0 overflow-hidden rounded-xl border border-white/[0.08] text-left hover:border-primary/50">
              <div className="aspect-[2/3]"><SmartImage src={poster(m.poster_path, 'face')} alt={titleOf(m)} className="h-full w-full" fallbackLabel={titleOf(m)} imgClassName="object-cover transition-transform duration-500 group-hover:scale-105" /></div>
              <p className="truncate px-1.5 pb-1 pt-1 text-[10px] font-semibold text-textMain">{titleOf(m)}</p>
              <p className="truncate px-1.5 pb-1.5 text-[9px] uppercase tracking-wide text-textMuted">{mediaTypeOf(m)} · {yearOf(m)}</p>
            </button>
          ))}
          {!rows.length && !busy && <p className="py-4 text-xs text-textMuted">Nothing on TMDB for “{q}”.</p>}
        </div>
      )}
    </motion.div>
  );
}

export default function TheatreRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  // Invitations identify an existing room only. Never seed media from query strings.
  const [username] = useState(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      if (user?.username) return user.username;
    } catch { /* Guests do not need browser storage. */ }
    return `Guest-${Math.floor(Math.random() * 9000 + 1000)}`;
  });
  const [room, setRoom] = useState(emptyRoom);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('joining');
  const [joinError, setJoinError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [showChat, setShowChat] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640);
  const [tab, setTab] = useState('chat');
  const [showQueue, setShowQueue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [sync, setSync] = useState(null);
  const [playback, setPlayback] = useState(emptyPlayback);
  const [drift, setDrift] = useState(null);
  const [hostMeasured, setHostMeasured] = useState(false);
  const [hostSyncPending, setHostSyncPending] = useState(false);
  const hostSyncTargetRef = useRef(null);
  const [seekTime, setSeekTime] = useState('0');
  const [stream, setStream] = useState(null);
  const [legacyPreview, setLegacyPreview] = useState(false);
  const socketRef = useRef(null);
  const roomRef = useRef(room);
  const isHostRef = useRef(false);
  const joinedRef = useRef(false);
  const hasJoinedRef = useRef(false);
  const leavingRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const joinRef = useRef(null);
  const stateVersionRef = useRef(0);
  const pendingRef = useRef(null);
  const nonceRef = useRef(0);
  const lastControlRef = useRef(null);
  const playbackRef = useRef(playback);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const sourceKeyRef = useRef('idle');
  const hostMeasuredRef = useRef(false);
  const lastReportRef = useRef(0);
  const lastRoleRef = useRef(null);
  const copyTimerRef = useRef(null);
  const streamRef = useRef(null);
  const screenRef = useRef(null);
  const endRef = useRef(null);
  const chatToggleRef = useRef(null);
  const railCloseRef = useRef(null);
  const now = room.nowPlaying;
  const playerKey = sourceKey(now);
  const drivable = now?.provider === 'trailer';
  const joined = status === 'joined' && connected;
  const canHost = joined && room.isHost && !pending && !leaving;
  const tv = now?.type === 'tv';
  const invite = useMemo(() => partyInvite(roomId, window.location.origin, PUBLIC_WEB_ORIGIN), [roomId]);

  const resetTelemetry = useCallback(() => {
    playbackRef.current = emptyPlayback();
    timeRef.current = 0;
    playingRef.current = false;
    hostMeasuredRef.current = false;
    lastReportRef.current = 0;
    lastRoleRef.current = null;
    hostSyncTargetRef.current = null;
    setHostSyncPending(false);
    setPlayback(emptyPlayback());
    setHostMeasured(false);
    setDrift(null);
  }, []);

  const queueSync = useCallback((state, action = 'snapshot') => {
    if (roomRef.current.nowPlaying?.provider !== 'trailer') return;
    if (isHostRef.current) {
      hostSyncTargetRef.current = { currentTime: state.currentTime, isPlaying: state.isPlaying };
      setHostSyncPending(true);
    }
    setSync({ action, currentTime: state.currentTime, isPlaying: state.isPlaying, syncMode: state.syncMode, nonce: ++nonceRef.current });
  }, []);

  const applySnapshot = useCallback((state, reset = false) => {
    if (!state || typeof state !== 'object') return;
    const previous = roomRef.current;
    const next = {
      name: state.name || 'Theatre Room',
      hostId: state.hostId ?? null,
      isHost: state.hostId ? state.hostId === socketRef.current?.id : Boolean(state.isHost),
      users: Array.isArray(state.users) ? state.users : [],
      nowPlaying: state.nowPlaying || null,
      currentTime: seconds(state.currentTime),
      isPlaying: Boolean(state.isPlaying),
      syncMode: state.syncMode ?? null,
    };
    const key = sourceKey(next.nowPlaying);
    const needsSync = reset || key !== sourceKeyRef.current || previous.hostId !== next.hostId;
    if (needsSync) resetTelemetry();
    sourceKeyRef.current = key;
    roomRef.current = next;
    isHostRef.current = next.isHost;
    stateVersionRef.current += 1;
    setRoom(next);
    if (next.nowPlaying?.provider === 'trailer') {
      const measured = playbackRef.current;
      if (needsSync || !measured.ready || (!measured.buffering && !measured.blocked && measured.ready &&
          (Math.abs(measured.currentTime - next.currentTime) > 2 || measured.isPlaying !== next.isPlaying))) queueSync(next);
    } else setSync(null);
  }, [queueSync, resetTelemetry]);

  const applyTitle = useCallback((payload) => {
    if (payload?.state) return applySnapshot(payload.state);
    const title = payload && Object.prototype.hasOwnProperty.call(payload, 'nowPlaying') ? payload.nowPlaying : payload;
    const next = {
      ...roomRef.current,
      nowPlaying: title || null,
      currentTime: seconds(payload?.currentTime, roomRef.current.currentTime),
      isPlaying: typeof payload?.isPlaying === 'boolean' ? payload.isPlaying : roomRef.current.isPlaying,
      syncMode: payload?.syncMode ?? roomRef.current.syncMode,
    };
    applySnapshot(next, true);
  }, [applySnapshot]);

  const applySource = useCallback((payload) => {
    if (payload?.state) return applySnapshot(payload.state, true);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'nowPlaying')) return applyTitle(payload);
    if (!roomRef.current.nowPlaying || !payload?.provider) return;
    applyTitle({ ...payload, nowPlaying: { ...roomRef.current.nowPlaying, provider: payload.provider } });
  }, [applySnapshot, applyTitle]);

  const applyControl = useCallback((payload) => {
    if (!payload) return;
    if (payload.nonce != null && payload.nonce === lastControlRef.current) return;
    lastControlRef.current = payload.nonce ?? null;
    const previous = roomRef.current;
    const next = {
      ...previous,
      currentTime: seconds(payload.currentTime, previous.currentTime),
      isPlaying: typeof payload.isPlaying === 'boolean' ? payload.isPlaying : payload.action === 'play' ? true : payload.action === 'pause' ? false : previous.isPlaying,
      syncMode: payload.syncMode ?? previous.syncMode,
    };
    roomRef.current = next;
    stateVersionRef.current += 1;
    setRoom(next);
    // Opaque embeds receive a shared cue, never an iframe playback command.
    queueSync(next, payload.action || 'snapshot');
  }, [queueSync]);

  const receiveHostSync = useCallback((payload) => {
    if (!joinedRef.current || isHostRef.current || roomRef.current.nowPlaying?.provider !== 'trailer') return;
    if (!Number.isFinite(payload?.currentTime) || payload.currentTime < 0) return;
    const next = {
      ...roomRef.current,
      currentTime: payload.currentTime,
      isPlaying: typeof payload.isPlaying === 'boolean' ? payload.isPlaying : roomRef.current.isPlaying,
      syncMode: payload.syncMode ?? roomRef.current.syncMode,
    };
    roomRef.current = next;
    stateVersionRef.current += 1;
    setRoom(next);
    hostMeasuredRef.current = true;
    setHostMeasured(true);
    const measured = playbackRef.current;
    if (!measured.ready || measured.buffering || measured.blocked || measured.error || Date.now() - measured.measuredAt > 2000) {
      setDrift(null);
      return;
    }
    const difference = Math.abs(next.currentTime - timeRef.current);
    setDrift(difference);
    if (difference > 2 || next.isPlaying !== playingRef.current) queueSync(next);
  }, [queueSync]);

  useEffect(() => {
    let active = true;
    hasJoinedRef.current = false;
    joinedRef.current = false;
    leavingRef.current = false;
    isHostRef.current = false;
    lastControlRef.current = null;
    roomRef.current = emptyRoom();
    sourceKeyRef.current = 'idle';
    setRoom(emptyRoom());
    setSync(null);
    setConnected(false);
    setMessages([]);
    setJoinError('');
    setActionError('');
    setPending(false);
    setLeaving(false);
    setShowQueue(false);
    resetTelemetry();
    if (!validRoomId(roomId)) {
      setStatus('error');
      setJoinError('This invitation has an invalid room ID. Ask the host for a new invite, or create a new party.');
      return undefined;
    }
    setStatus('joining');
    const sock = io(API_ORIGIN, { transports: ['websocket', 'polling'], autoConnect: false });
    socketRef.current = sock;
    const join = async () => {
      if (!active || !sock.connected || leavingRef.current) return;
      const attempt = ++joinAttemptRef.current;
      joinedRef.current = false;
      isHostRef.current = false;
      setStatus(hasJoinedRef.current ? 'reconnecting' : 'joining');
      setJoinError('');
      resetTelemetry();
      let saved = roomCredentials(roomId) || {};
      const payload = { roomId, username };
      if (typeof saved.hostToken === 'string') payload.hostToken = saved.hostToken;
      if (typeof saved.resumeToken === 'string') payload.resumeToken = saved.resumeToken;
      try {
        let result;
        try {
          result = await partyRequest(sock, 'join_room', payload);
        } catch (error) {
          if (error.code !== 'INVALID_HOST_TOKEN' && error.code !== 'INVALID_RESUME_TOKEN') throw error;
          if (!active || attempt !== joinAttemptRef.current || !sock.connected || leavingRef.current) return;
          delete payload.hostToken;
          delete saved.hostToken;
          if (error.code === 'INVALID_RESUME_TOKEN') {
            delete payload.resumeToken;
            delete saved.resumeToken;
          }
          saveRoomCredentials(roomId, saved);
          result = await partyRequest(sock, 'join_room', payload);
        }
        if (!active || attempt !== joinAttemptRef.current || !sock.connected || leavingRef.current) return;
        if (!result.state) throw new Error('The party server returned no room state. Please retry.');
        saveRoomCredentials(roomId, { ...saved, resumeToken: result.resumeToken });
        // Rejoining always replaces stale title, source, time and host ownership.
        applySnapshot(result.state, true);
        joinedRef.current = true;
        hasJoinedRef.current = true;
        setStatus('joined');
      } catch (error) {
        if (!active || attempt !== joinAttemptRef.current || leavingRef.current) return;
        joinedRef.current = false;
        isHostRef.current = false;
        setStatus('error');
        setJoinError(errorText(error, 'Unable to join this party. The invitation may have expired.'));
      }
    };
    joinRef.current = join;
    sock.on('connect', () => { setConnected(true); join(); });
    sock.on('disconnect', () => {
      if (!active || leavingRef.current) return;
      joinAttemptRef.current += 1;
      joinedRef.current = false;
      isHostRef.current = false;
      pendingRef.current = null;
      setPending(false);
      setConnected(false);
      setStatus(hasJoinedRef.current ? 'reconnecting' : 'joining');
      setJoinError('Connection lost. Trying to rejoin the party…');
      resetTelemetry();
    });
    sock.on('connect_error', () => {
      if (!active || leavingRef.current) return;
      setConnected(false);
      setStatus('error');
      setJoinError('Cannot reach the party server. Check your connection and the backend address, then retry.');
    });
    sock.on('room_state', (state) => { if (active && sock.connected && !leavingRef.current) applySnapshot(state, !joinedRef.current); });
    sock.on('update_users', (list) => {
      const users = Array.isArray(list) ? list : list?.users;
      if (!Array.isArray(users)) return;
      roomRef.current = { ...roomRef.current, users };
      setRoom(roomRef.current);
    });
    sock.on('receive_message', (message) => setMessages((previous) => [...previous, message]));
    sock.on('now_playing', applyTitle);
    sock.on('source_changed', applySource);
    sock.on('party_control', applyControl);
    sock.on('host_sync', receiveHostSync);
    sock.on('force_sync', receiveHostSync);
    sock.on('new_host', () => {
      // The following room_state is authoritative. Keep the old hostId until
      // it arrives so promotion forces a sync before new-host telemetry sends.
      isHostRef.current = false;
      resetTelemetry();
    });
    sock.on('party_error', (error) => {
      if (error.event !== 'join_room') setActionError(errorText(error, 'The party request was rejected.'));
    });
    sock.on('session_replaced', () => {
      sock.disconnect();
      joinedRef.current = false;
      setConnected(false);
      setStatus('error');
      setJoinError('This session resumed on another connection. Retry only if you want to resume it here.');
    });
    sock.on('user_joined', ({ username: name }) => { if (joinedRef.current && name !== username) toast(`${name} joined`); });
    sock.connect();
    return () => {
      active = false;
      joinAttemptRef.current += 1;
      joinedRef.current = false;
      isHostRef.current = false;
      pendingRef.current = null;
      joinRef.current = null;
      socketRef.current = null;
      // An incidental disconnect retains the saved resume token.
      sock.removeAllListeners();
      sock.disconnect();
    };
  }, [roomId, username, applySnapshot, applyTitle, applySource, applyControl, receiveHostSync, resetTelemetry]);

  const onPlaybackStatus = useCallback((reported) => {
    if (playerKey !== sourceKeyRef.current || roomRef.current.nowPlaying?.provider !== 'trailer' || pendingRef.current?.sourceChange) return;
    const currentTime = reported?.currentTime;
    const ready = reported?.ready === true && Number.isFinite(currentTime) && currentTime >= 0 && typeof reported.isPlaying === 'boolean';
    const measured = {
      ready,
      currentTime: ready ? currentTime : 0,
      isPlaying: ready && reported.isPlaying,
      buffering: Boolean(reported?.buffering),
      blocked: Boolean(reported?.blocked),
      error: reported?.error ? errorText(reported.error, `Playback error: ${reported.error}`) : null,
      measuredAt: ready ? Date.now() : 0,
    };
    const changed = measured.isPlaying !== playingRef.current || measured.buffering !== playbackRef.current.buffering || measured.ready !== playbackRef.current.ready;
    playbackRef.current = measured;
    timeRef.current = measured.currentTime;
    playingRef.current = measured.isPlaying;
    setPlayback(measured);
    const sock = socketRef.current;
    if (!joinedRef.current || !sock?.connected || leavingRef.current || !ready || measured.blocked || measured.error) {
      setDrift(null);
      return;
    }
    if (isHostRef.current && hostSyncTargetRef.current) {
      if (!matchesYouTubeSync(measured, hostSyncTargetRef.current)) return;
      hostSyncTargetRef.current = null;
      setHostSyncPending(false);
    }
    if (!isHostRef.current && hostMeasuredRef.current && !measured.buffering) setDrift(Math.abs(roomRef.current.currentTime - currentTime));
    else setDrift(null);
    const role = isHostRef.current ? 'host' : 'member';
    const interval = isHostRef.current ? 500 : 3000;
    if (lastRoleRef.current !== role || (isHostRef.current && changed) || Date.now() - lastReportRef.current >= interval) {
      lastRoleRef.current = role;
      lastReportRef.current = Date.now();
      if (isHostRef.current) {
        sock.emit('sync_state', { roomId, currentTime, isPlaying: measured.isPlaying, syncMode: roomRef.current.syncMode });
      } else {
        sock.emit('report_drift', { roomId, clientTime: currentTime, buffering: measured.buffering });
      }
    }
  }, [playerKey, roomId]);

  const requestHost = useCallback(async (event, payload) => {
    const sock = socketRef.current;
    if (!joinedRef.current || !sock?.connected || !isHostRef.current || leavingRef.current) {
      setActionError('Only the joined, connected host can change the party.');
      return null;
    }
    if (pendingRef.current) return null;
    const request = { sourceChange: event === 'select_title' || event === 'change_source' };
    const attempt = joinAttemptRef.current;
    const version = stateVersionRef.current;
    pendingRef.current = request;
    setPending(true);
    setActionError('');
    if (request.sourceChange) resetTelemetry();
    try {
      const result = await partyRequest(sock, event, { ...payload, roomId });
      if (socketRef.current !== sock || !sock.connected || !joinedRef.current || !isHostRef.current || attempt !== joinAttemptRef.current || leavingRef.current) return null;
      if (result.state) applySnapshot(result.state);
      else if (result.control) applyControl(result.control);
      else if (stateVersionRef.current === version) {
        // Only an acknowledged request may supply a fallback when no broadcast arrived.
        if (event === 'party_control') applyControl(result.action ? result : payload);
        if (event === 'select_title') applyTitle({ nowPlaying: payload.nowPlaying });
        if (event === 'change_source') applySource(payload);
      }
      return result;
    } catch (error) {
      if (socketRef.current === sock && attempt === joinAttemptRef.current && !leavingRef.current) setActionError(errorText(error, 'The party request failed. Please retry.'));
      return null;
    } finally {
      if (pendingRef.current === request) { pendingRef.current = null; setPending(false); }
    }
  }, [roomId, applySnapshot, applyControl, applyTitle, applySource, resetTelemetry]);

  const control = useCallback((action, target) => {
    const state = roomRef.current;
    const measured = playbackRef.current;
    const hasMeasurement = state.nowPlaying?.provider === 'trailer' && measured.ready && !measured.error && !measured.blocked;
    const currentTime = target == null
      ? hasMeasurement ? timeRef.current : state.currentTime
      : seconds(target, state.currentTime);
    const wasPlaying = hasMeasurement ? playingRef.current : state.isPlaying;
    return requestHost('party_control', {
      action, currentTime,
      isPlaying: action === 'play' ? true : action === 'pause' ? false : wasPlaying,
      syncMode: state.syncMode,
    });
  }, [requestHost]);

  const restart = async () => {
    if (!await control('seek', 0)) return;
    if (!await control('play', 0)) return;
    toast(roomRef.current.nowPlaying?.provider === 'trailer' ? 'Trailer restart acknowledged; playback must be confirmed by the player.' : 'Restart cue shared. Restart playback manually in your own player.');
  };
  const pickTitle = async (movie) => {
    const result = await requestHost('select_title', { nowPlaying: {
      type: mediaTypeOf(movie), tmdbId: movie.id, title: titleOf(movie), season: 1, episode: 1,
      provider: roomRef.current.nowPlaying?.provider === 'trailer' ? DEFAULT_SERVER : roomRef.current.nowPlaying?.provider || DEFAULT_SERVER, youtubeKey: null, poster: movie.poster_path,
    } });
    if (result) setShowQueue(false);
  };
  const retry = () => {
    if (leavingRef.current || !validRoomId(roomId)) return;
    setJoinError('');
    setStatus(hasJoinedRef.current ? 'reconnecting' : 'joining');
    if (socketRef.current?.connected) joinRef.current?.();
    else socketRef.current?.connect();
  };
  const leave = async (destination = '/') => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    joinAttemptRef.current += 1;
    let released = false;
    try {
      if (socketRef.current?.connected) {
        await partyRequest(socketRef.current, 'leave_room', { roomId });
        released = true;
      }
    } catch (error) {
      toast(errorText(error, 'Could not confirm departure with the server.'));
    } finally {
      // A failed/offline departure retains the resume bearer rather than leaking
      // an unreachable membership that still counts against room capacity.
      if (released && validRoomId(roomId)) saveRoomCredentials(roomId, {});
      joinedRef.current = false;
      socketRef.current?.disconnect();
      navigate(destination);
    }
  };
  const send = (event) => {
    event.preventDefault();
    if (!draft.trim() || !joinedRef.current || !socketRef.current?.connected || leavingRef.current) return;
    socketRef.current.emit('send_message', { roomId, username, message: draft.trim() });
    setDraft('');
  };
  const copyInvite = async () => {
    setInviteError('');
    try {
      await copyText(invite.url);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setInviteError(errorText(error, 'Clipboard unavailable. Select and copy the displayed URL.'));
    }
  };
  const shareInvite = async () => {
    setInviteError('');
    if (!invite.isPublic || !navigator.share) return copyInvite();
    try {
      await navigator.share({ title: room.name, text: 'Join my ZenithFlix watch party', url: invite.url });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      await copyInvite();
    }
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages]);
  useEffect(() => { if (!canHost) setShowQueue(false); }, [canHost]);
  useEffect(() => {
    if (!showChat) return undefined;
    if (window.innerWidth < 640) railCloseRef.current?.focus();
    const escape = (event) => {
      if (event.key === 'Escape') { setShowChat(false); chatToggleRef.current?.focus(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [showChat]);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);
  useEffect(() => {
    setLegacyPreview(false);
    setStream(null);
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [playerKey, roomId, joined]);
  useEffect(() => { if (screenRef.current) screenRef.current.srcObject = stream; }, [stream]);
  const previewScreen = async () => {
    if (!joinedRef.current || roomRef.current.nowPlaying?.type !== 'screen') return;
    const key = sourceKeyRef.current;
    const attempt = joinAttemptRef.current;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen preview is unavailable in this browser.');
      // A deliberate local-preview click is the only place that asks for capture permission.
      const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!joinedRef.current || key !== sourceKeyRef.current || attempt !== joinAttemptRef.current) { media.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = media;
      setStream(media);
      media.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== media) return;
        media.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStream(null);
      });
    } catch (error) { setActionError(errorText(error, 'Screen preview permission was not granted.')); }
  };
  const legacySrc = useMemo(() => {
    if (now?.type !== 'legacy' || !now.url) return null;
    try {
      const url = new URL(now.url);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }, [now?.type, now?.url]);

  const syncLabel = !joined ? 'Playback unverified while reconnecting'
    : !drivable ? 'Shared title/server · playback cues only'
      : playback.error ? `Trailer playback error · ${playback.error}`
        : playback.blocked ? 'Autoplay blocked · press play in your trailer player'
          : !playback.ready ? 'Trailer API not ready · playback unverified'
            : playback.buffering ? 'Trailer buffering · sync correction paused'
              : room.isHost && hostSyncPending ? 'Applying authoritative trailer state · waiting for player confirmation'
                : room.isHost ? 'Trailer API ready · measured playback'
                : !hostMeasured || drift == null ? 'Trailer API ready · waiting for host reference'
                  : `Trailer clock difference · ${drift.toFixed(1)}s${room.isPlaying !== playback.isPlaying ? ' · playback state differs' : ''}`;
  const participants = room.users.filter((user) => user.connected !== false).length;
  const playing = joined && room.isHost && drivable && playback.ready && !playback.error && !playback.blocked ? playback.isPlaying : room.isPlaying;
  const btn = 'flex items-center justify-center gap-1.5 rounded-xl border border-white/12 px-3 py-1.5 text-[12px] font-bold text-textSub transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background font-sans">
      <header className="z-20 max-h-[48dvh] flex-shrink-0 overflow-y-auto border-b border-white/[0.07] bg-black/55 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button onClick={() => leave()} disabled={leaving} className={`${btn} shrink-0`} aria-label="Leave Party"><ArrowLeft className="h-4 w-4" /><span>{leaving ? 'Leaving…' : 'Leave Party'}</span></button>
            <div className="min-w-0">
              <p className="truncate font-display text-[13px] font-bold tracking-tighter2 text-white">{room.name}</p>
              <p className="truncate text-[10.5px] text-textMuted">{now ? `${now.title || 'Untitled'}${tv ? ` · S${now.season}E${now.episode}` : ''}` : 'Waiting for a title'}</p>
            </div>
            {joined && room.isHost && <Badge tone="gold" title="Only the host controls the party"><Crown className="h-2.5 w-2.5" /> Host</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={joined ? 'live' : 'muted'}><Wifi className="h-2.5 w-2.5" /> {leaving ? 'Leaving' : joined ? 'Joined' : status === 'error' ? 'Not joined' : status === 'reconnecting' ? 'Reconnecting' : 'Joining'}</Badge>
            <div className="hidden -space-x-2 sm:flex">{room.users.slice(0, 4).map((user) => <Avatar key={user.id} name={user.username} isHost={user.id === room.hostId} />)}</div>
            <button ref={chatToggleRef} onClick={() => setShowChat((value) => !value)} aria-expanded={showChat} aria-controls="theatre-room-rail" aria-label={showChat ? 'Close chat and participants' : 'Open chat and participants'} className={`${btn} ${showChat ? 'border-primary/40 bg-primary/15 text-white' : ''}`}><MessageSquare className="h-3.5 w-3.5" /> Chat</button>
          </div>
        </div>

        {/* A separate, labelled invite row remains visible on narrow screens. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-3 py-2 sm:px-4">
          <button onClick={copyInvite} disabled={!invite.url} className={`${btn} border-primary/45 bg-primary/15 text-white`}><span>{copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Copy className="h-3.5 w-3.5" />}</span>{copied ? 'Copied' : invite.isPublic ? 'Copy Invite Link' : 'Copy local link'}</button>
          <button onClick={shareInvite} disabled={!invite.url} title={invite.isPublic ? 'Share the invite, or copy it if sharing is unavailable' : 'Copies the local link; public sharing is unavailable'} className={btn}><Share2 className="h-3.5 w-3.5" /> {invite.isPublic ? 'Share' : 'Share (copy local)'}</button>
          <label className="flex min-w-0 basis-full items-center gap-2 sm:min-w-[220px] sm:basis-auto sm:flex-1"><span className="shrink-0 text-[11px] font-semibold text-textMuted">Invite link</span><input readOnly value={invite.url} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-primary" /></label>
          {!invite.isPublic && <p className="w-full break-words text-[11px] text-gold">{invite.url ? 'Local development link, not usable on another network. ' : ''}{invite.reason}</p>}
          {inviteError && <p role="alert" className="w-full text-xs text-gold">{inviteError}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-3 py-2 sm:px-4">
          <button disabled={!canHost} onClick={() => setShowQueue((value) => !value)} className={`${btn} ${showQueue ? 'border-primary/45 bg-primary/15 text-white' : ''}`}><ListVideo className="h-3.5 w-3.5" /> Queue a title</button>
          {tv && <div className="flex items-center gap-1 rounded-xl border border-white/12 px-1 py-0.5">
            <button disabled={!canHost || (now.episode || 1) <= 1} onClick={() => requestHost('select_title', { nowPlaying: { ...now, episode: Math.max(1, (now.episode || 1) - 1) } })} className="h-7 w-7 text-textSub disabled:opacity-40" aria-label="Previous episode">‹</button>
            <span className="px-1 text-[11px] font-bold tabular text-white">S{now.season}·E{now.episode}</span>
            <button disabled={!canHost} onClick={() => requestHost('select_title', { nowPlaying: { ...now, episode: (now.episode || 1) + 1 } })} className="h-7 w-7 text-textSub disabled:opacity-40" aria-label="Next episode">›</button>
          </div>}
          <button disabled={!canHost || !now} onClick={() => control(playing ? 'pause' : 'play')} title={drivable ? 'Request trailer playback for the party' : 'Cue only — use your own player controls'} className={`${btn} border-transparent bg-ember-gradient text-white shadow-glow-sm`}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{drivable ? playing ? 'Pause trailer' : 'Play trailer' : playing ? 'Pause cue' : 'Play cue'}</button>
          <button disabled={!canHost || !now} onClick={restart} className={btn}><RefreshCw className="h-3.5 w-3.5" /> {drivable ? 'Restart trailer' : 'Restart cue'}</button>
          {now && <form className="flex min-w-0 flex-wrap items-center gap-1.5" onSubmit={(event) => {
            event.preventDefault();
            const target = Number(seekTime);
            if (!seekTime.trim() || !Number.isFinite(target) || target < 0) return setActionError('Enter a valid non-negative seek time in seconds.');
            control('seek', target);
          }}>
            <button type="button" disabled={!canHost} onClick={() => control('seek', Math.max(0, (drivable && playback.ready ? timeRef.current : roomRef.current.currentTime) - 10))} className={btn} aria-label="Seek back 10 seconds">−10s</button>
            <label className="flex items-center gap-1.5 text-[11px] text-textMuted">{drivable ? 'Seek (s)' : 'Cue time (s)'}<input type="number" min="0" step="1" value={seekTime} disabled={!canHost} onChange={(event) => setSeekTime(event.target.value)} className="w-16 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white disabled:opacity-40" /></label>
            <button type="submit" disabled={!canHost} className={btn}>{drivable ? 'Seek' : 'Send cue'}</button>
            <button type="button" disabled={!canHost} onClick={() => control('seek', (drivable && playback.ready ? timeRef.current : roomRef.current.currentTime) + 10)} className={btn} aria-label="Seek forward 10 seconds">+10s</button>
          </form>}
          {pending && <span role="status" className="text-[11px] text-textMuted">Waiting for server acknowledgement…</span>}
          <p className="flex w-full items-center gap-1.5 text-[11px] text-textMuted" role="status"><Gauge className="h-3 w-3 shrink-0 text-primary" /><span>{syncLabel}{joined && drivable && playback.ready && !playback.blocked && !playback.error ? ` · ${clock(room.isHost ? playback.currentTime : room.currentTime)}` : ''}</span></p>
          {joined && !room.isHost && <p className="text-[11px] text-textMuted">The host chooses titles, episodes, servers and playback cues.</p>}
          {actionError && <div role="alert" className="flex w-full items-start justify-between gap-2 text-xs text-gold"><span>{actionError}</span><button aria-label="Dismiss party error" onClick={() => setActionError('')}><X className="h-3.5 w-3.5" /></button></div>}
        </div>
      </header>

      <AnimatePresence>{showQueue && joined && room.isHost && <QueuePanel onClose={() => setShowQueue(false)} onPick={pickTitle} />}</AnimatePresence>
      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-black">
          {!joined && <div role={status === 'error' ? 'alert' : 'status'} className={`z-10 flex-shrink-0 border-b border-white/10 px-4 py-3 ${status === 'error' ? 'bg-gold/10' : 'bg-primary/10'}`}>
            <p className="text-sm font-bold text-white">{status === 'error' ? 'Unable to join this party' : status === 'reconnecting' ? 'Reconnecting to your party…' : 'Joining your party…'}</p>
            {joinError && <p className="mt-1 break-words text-xs text-textSub">{joinError}</p>}
            <p className="mt-1 text-xs text-textMuted">{status === 'error' ? 'Unknown or expired rooms cannot be created by opening an invite. Ask the host for a fresh link or create a new party.' : 'Waiting for the authoritative room state. Playback and host controls are unverified until joined.'}</p>
            <div className="mt-2 flex flex-wrap gap-2"><button disabled={leaving || !validRoomId(roomId)} onClick={retry} className={btn}><RefreshCw className="h-3.5 w-3.5" /> Retry join</button><Link to="/create-group" onClick={(event) => { event.preventDefault(); leave('/create-group'); }} className={`${btn} border-primary/40 text-primary`}>Create new party</Link><button disabled={leaving} onClick={() => leave()} className={btn}>Leave Party</button></div>
          </div>}
          {status === 'error' ? <div className="grid min-h-[140px] flex-1 place-items-center px-6 text-center"><div><Users className="mx-auto mb-3 h-10 w-10 text-white/25" /><p className="text-sm text-textMuted">No playback is loaded from an invalid or expired invitation.</p></div></div>
            : now?.type === 'screen' || now?.type === 'legacy' ? <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="rounded-2xl border border-gold/25 bg-gold/[0.06] p-4 text-center"><Monitor className="mx-auto mb-2 h-8 w-8 text-gold" /><p className="font-display text-lg font-bold text-white">Local preview only · shared playback unsupported</p><p className="mt-2 text-sm text-textMuted">Screen capture and legacy embeds are not streamed to party members. No permission request or legacy media is opened from invite query parameters.</p>
                {now.type === 'screen' && !stream && <button disabled={!joined} onClick={previewScreen} className={`${btn} mx-auto mt-3`}>Preview my screen locally</button>}
                {now.type === 'legacy' && legacySrc && !legacyPreview && <button disabled={!joined} onClick={() => setLegacyPreview(true)} className={`${btn} mx-auto mt-3`}>Open unsupported local preview</button>}
              </div>
              {stream && <><video ref={screenRef} autoPlay muted className="min-h-0 w-full flex-1 object-contain" /><button className={btn} onClick={() => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setStream(null); }}>Stop local screen preview</button></>}
              {legacyPreview && legacySrc && <iframe src={legacySrc} title="Unsupported local legacy preview — not synchronized" className="min-h-[240px] w-full flex-1 border-0" allow="fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" />}
            </div>
              : now ? <div className="mx-auto flex min-h-full w-full max-w-[1500px] items-center px-3 py-3 sm:px-6"><div className="w-full"><Player
                key={playerKey}
                tmdbId={now.tmdbId} type={now.type} season={now.season} episode={now.episode}
                provider={now.provider} youtubeKey={now.youtubeKey} title={now.title}
                party={`${participants} participants · ${drivable ? playback.ready && !playback.blocked && !playback.error && joined ? 'measured trailer playback' : 'trailer playback unverified' : 'playback cues only'}`}
                follow={!joined || !room.isHost || leaving} sync={drivable ? sync : null}
                onPlaybackStatus={onPlaybackStatus}
                onProviderChange={(provider) => requestHost('change_source', { provider, tmdbId: now.tmdbId, type: now.type, season: now.season, episode: now.episode })}
              /></div></div>
                : <div className="grid min-h-[200px] flex-1 place-items-center px-6 py-6 text-center"><motion.div variants={stagger(0, 0.08)} initial="hidden" animate="show">
                  <motion.div variants={item} className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl border border-white/10 bg-white/[0.03]"><Play className="h-7 w-7 text-white/25" /></motion.div>
                  <motion.h2 variants={item} className="font-display text-2xl font-extrabold tracking-tighter2 text-white">{joined ? 'Room is empty of content' : 'Waiting for the party'}</motion.h2>
                  <motion.p variants={item} className="mx-auto mt-2 max-w-[44ch] text-sm leading-relaxed text-textMuted">{joined && room.isHost ? 'Queue a film or series to share its title, episode and server. Trailer playback can synchronize once the YouTube API is ready.' : 'The host will choose a title for this party. Your invite never starts a movie or screen capture by itself.'}</motion.p>
                  {joined && room.isHost && <motion.div variants={item} className="mt-5"><button disabled={!canHost} onClick={() => setShowQueue(true)} className="mx-auto flex items-center gap-2 rounded-2xl bg-ember-gradient px-5 py-2.5 text-sm font-bold text-white shadow-glow-md disabled:opacity-40"><Search className="h-4 w-4" /> Find something to watch</button></motion.div>}
                </motion.div></div>}
        </main>

        <AnimatePresence>{showChat && <motion.aside id="theatre-room-rail" aria-label="Room chat and participants" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={spring.snappy} className="absolute inset-0 z-30 flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-white/[0.07] bg-surface sm:static sm:w-[336px] sm:flex-shrink-0">
          <div className="flex flex-shrink-0 gap-1 border-b border-white/[0.07] p-2">
            {[{ id: 'chat', icon: MessageSquare, label: `Chat ${messages.length ? `(${messages.length})` : ''}` }, { id: 'members', icon: Users, label: `Members (${room.users.length})` }].map((entry) => <button key={entry.id} onClick={() => setTab(entry.id)} aria-pressed={tab === entry.id} className={`relative min-w-0 flex-1 rounded-xl py-2 text-[11.5px] font-bold transition-colors ${tab === entry.id ? 'text-white' : 'text-textMuted hover:text-textSub'}`}>
              {tab === entry.id && <motion.span layoutId="room-rail" className="absolute inset-0 rounded-xl bg-ember-gradient opacity-85" transition={spring.pop} />}<span className="relative flex items-center justify-center gap-1.5"><entry.icon className="h-3.5 w-3.5" /> {entry.label}</span>
            </button>)}
            <button ref={railCloseRef} onClick={() => { setShowChat(false); chatToggleRef.current?.focus(); }} aria-label="Close chat and participants" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-textMuted hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{tab === 'chat' ? <>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">{!messages.length && <p className="pt-10 text-center text-[12.5px] text-textMuted">No messages yet — say hi.</p>}{messages.map((message, index) => <Message key={`${message.timestamp}-${index}`} msg={message} mine={(message.id ? message.id === socketRef.current?.id : message.username === username) && !message.system} />)}<div ref={endRef} /></div>
            <form onSubmit={send} className="flex flex-shrink-0 items-center gap-2 border-t border-white/[0.07] bg-black/25 p-3"><input aria-label="Message the room" value={draft} disabled={!joined || leaving} onChange={(event) => setDraft(event.target.value)} placeholder={joined ? 'Message the room…' : 'Join the party to chat…'} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/45 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/50 disabled:opacity-50" /><motion.button whileTap={{ scale: 0.92 }} type="submit" disabled={!joined || leaving || !draft.trim()} aria-label="Send message" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ember-gradient text-white shadow-glow-sm disabled:opacity-40"><Send className="h-3.5 w-3.5" /></motion.button></form>
          </> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {!room.users.length && <p className="py-6 text-center text-xs text-textMuted">Participants appear after the server confirms your join.</p>}
            {room.users.map((user, index) => <motion.div key={user.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5"><Avatar name={user.username} isHost={user.id === room.hostId} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-white">{user.username}{user.id === socketRef.current?.id ? ' (you)' : ''}</p>{user.id === room.hostId && <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gold"><Crown className="h-2.5 w-2.5" /> Host</p>}<p className="text-[10px] text-textMuted">{user.connected === false ? 'Reconnecting' : user.connected === true ? 'Connected' : 'Participant'}</p></div>{typeof user.connected === 'boolean' && <span title={user.connected ? 'Connected' : 'Disconnected'} className={`h-2 w-2 shrink-0 rounded-full ${user.connected ? 'bg-lime' : 'bg-white/25'}`} />}</motion.div>)}
            <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/[0.06] p-3.5"><p className="mb-2 text-[11.5px] font-semibold text-textSub">Invite link</p><p className="select-all break-all rounded-xl bg-black/40 px-2.5 py-2 text-[11px] text-primary">{invite.url || invite.reason}</p><button disabled={!invite.url} onClick={copyInvite} className={`${btn} mt-2 w-full`}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{invite.isPublic ? 'Copy Invite Link' : 'Copy local link'}</button>{!invite.isPublic && <p className="mt-2 text-[11px] text-gold">Local development link, not usable on another network.</p>}</div>
          </div>}</div>
        </motion.aside>}</AnimatePresence>
      </div>
    </div>
  );
}
