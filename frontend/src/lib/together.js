/**
 * "Watch together" without a server.
 *
 * A live room needs a process that can hold a WebSocket. This does not have one,
 * so it does the next best thing and puts everything a friend needs inside the
 * link: which title, which episode, which server and — the part that actually
 * makes it feel shared — one agreed clock moment to press play at.
 *
 * Both phones open the same URL, both see the same countdown, both hit play at
 * zero. There is no pause/seek mirroring, because a cross-origin iframe will not
 * report its position to us and we cannot send commands into it either. The
 * countdown is the honest ceiling of what works with zero infrastructure, and
 * "Start a new countdown" is the re-sync control.
 *
 * Every field arriving from a URL is treated as hostile input: a stranger can
 * edit the query string, so each reader validates and falls back rather than
 * trusting what it was handed.
 */

/** No I, O, 0 or 1 — these codes get read out loud over the phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export const TOGETHER_PARAM = 'together';
export const START_PARAM = 'start';
export const AT_PARAM = 'at';
/**
 * Set on the link a host mints from the title sheet: it says "this browser just
 * made this session, so show the panel", which is the difference between landing
 * on your own invitation and landing on someone else's.
 */
export const INVITE_PARAM = 'invite';

/** Clock drift tolerance: two people tapping "30 seconds" are never exact. */
export const LEAD_CHOICES = [
  { seconds: 30, label: '30 sec' },
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 300, label: '5 min' },
];

/** A link whose moment passed six hours ago is a stale text, not a session. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Matches the alphabet above and nothing else. A code is a label a person reads
 * out loud, so I, O, 0 and 1 never appear — not from the generator and not from
 * a query string someone typed by hand.
 */
export const validRoomCode = (code) =>
  typeof code === 'string' && code.length === CODE_LENGTH && /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]+$/.test(code);

/**
 * Room codes are labels, not secrets — nothing authenticates against them.
 * They exist so two people can say "we're in room K3F9QA" and know they are
 * looking at the same invitation.
 */
export function newRoomCode(random = Math.random) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return out;
}

const asNumber = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The invitation, built from what the viewer is looking at right now.
 * `at` is only ever passed when we own the player (our own HLS video or the
 * YouTube trailer); an iframe's position is unknowable, so the link says
 * "from the beginning" instead of pretending to know a timestamp.
 */
export function togetherLink({ origin, type, id, season = 1, episode = 1, provider, youtubeKey, code, startAt, at = null }) {
  if (!validRoomCode(code) || !origin || !type || !id) return '';
  const q = new URLSearchParams();
  if (type === 'tv') {
    q.set('season', String(season));
    q.set('episode', String(episode));
  }
  if (provider) q.set('provider', String(provider));
  if (youtubeKey) q.set('yt', String(youtubeKey));
  q.set(TOGETHER_PARAM, code);
  q.set(START_PARAM, String(Math.round(startAt)));
  if (at != null && Number.isFinite(at) && at > 0) q.set(AT_PARAM, String(Math.round(at)));
  return `${origin.replace(/\/$/, '')}/watch/${type}/${id}?${q.toString()}`;
}

/**
 * Read a session out of a query string. Returns null when there is nothing
 * usable, so the page behaves like a normal watch and never shows a countdown
 * built from someone's typo.
 */
export function readTogether(source) {
  const get = typeof source?.get === 'function' ? (k) => source.get(k) : (k) => source?.[k] ?? null;
  const code = get(TOGETHER_PARAM);
  if (!validRoomCode(code)) return null;
  const startAt = asNumber(get(START_PARAM));
  if (startAt == null || startAt < 1e12 || startAt > 9e12) return null;
  const rawAt = asNumber(get(AT_PARAM));
  const at = rawAt != null && rawAt >= 0 && rawAt <= 24 * 3600 ? Math.round(rawAt) : null;
  return { code, startAt, at, invite: get(INVITE_PARAM) === '1', stale: Date.now() - startAt > STALE_AFTER_MS };
}

/**
 * Where the shared moment is right now. `waiting` counts down, `go` is the two
 * second window it is time, `after` means the moment passed — which is normal
 * for a friend who opens the link mid-film and just wants to join in.
 */
export function countdown(startAt, now = Date.now()) {
  const delta = startAt - now;
  if (delta > 2000) return { phase: 'waiting', seconds: Math.ceil(delta / 1000), delta };
  if (delta > -2000) return { phase: 'go', seconds: 0, delta };
  return { phase: 'after', seconds: Math.round(-delta / 1000), delta };
}

/** "4 min 12 sec", said the way a person would say it. */
export function humanTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} sec` : `${m} min`;
}

/**
 * Remembers rooms this browser started, so coming back to the same title can
 * tell the host "your invitation is still K3F9QA" instead of minting a fresh
 * code for a session that is already in someone's chat history.
 *
 * This store is ours, so it is read field by field — the URL reader above is for
 * strings a stranger could have edited, and its key names are not this shape.
 */
const storeKey = (type, id) => `zf.together.${type}.${id}`;

export function savedSession(type, id) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(type, id)) || 'null');
    if (!parsed || !validRoomCode(parsed.code)) return null;
    const startAt = asNumber(parsed.startAt);
    if (startAt == null || startAt < 1e12 || startAt > 9e12) return null;
    const at = asNumber(parsed.at);
    return {
      code: parsed.code,
      startAt,
      at: at != null && at >= 0 && at <= 24 * 3600 ? Math.round(at) : null,
      stale: Date.now() - startAt > STALE_AFTER_MS,
      type: parsed.type,
      id: parsed.id,
      season: parsed.season,
      episode: parsed.episode,
      provider: parsed.provider,
    };
  } catch {
    return null;
  }
}

export function rememberSession({ type, id, season, episode, provider, code, startAt, at }) {
  try {
    localStorage.setItem(storeKey(type, id), JSON.stringify({ code, startAt, at, type, id, season, episode, provider }));
  } catch {
    // Private-mode storage failures only cost the memory, never the session.
  }
}

export function forgetSession(type, id) {
  try {
    localStorage.removeItem(storeKey(type, id));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
