/**
 * Runtime config: backend origin, TMDB image sizes, language catalogue and the
 * two local stores (My List + Continue Watching).
 */

const pageOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
const host = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

// Public installs default to a same-origin reverse proxy, not an unconfigured
// HTTPS port 5000. A separately deployed API uses VITE_API_BASE (origin only).
export const API_ORIGIN = (import.meta.env.VITE_API_BASE || (local ? `http://${host}:5000` : pageOrigin)).replace(/\/$/, '');
export const PUBLIC_WEB_ORIGIN = import.meta.env.VITE_PUBLIC_WEB_ORIGIN || '';
export const API = `${API_ORIGIN}/api`;

export const IMG = {
  logo: 'https://image.tmdb.org/t/p/w92',
  poster: 'https://image.tmdb.org/t/p/w342',
  poster2x: 'https://image.tmdb.org/t/p/w500',
  still: 'https://image.tmdb.org/t/p/w500',
  backdrop: 'https://image.tmdb.org/t/p/w1280',
  backdrop2x: 'https://image.tmdb.org/t/p/w1920',
  original: 'https://image.tmdb.org/t/p/original',
  face: 'https://image.tmdb.org/t/p/w185',
};

export const poster = (path, size = 'poster') => (path ? `${IMG[size]}${path}` : null);
export const backdrop = (path, size = 'backdrop') => (path ? `${IMG[size]}${path}` : null);

/** TMDB content locales exposed in the UI. */
export const LANGUAGES = [
  { code: 'en-US', label: 'English', flag: '🇬🇧', short: 'EN' },
  { code: 'hi-IN', label: 'हिन्दी', flag: '🇮🇳', short: 'HI' },
  { code: 'ta-IN', label: 'தமிழ்', flag: '🇮🇳', short: 'TA' },
  { code: 'te-IN', label: 'తెలుగు', flag: '🇮🇳', short: 'TE' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ', flag: '🇮🇳', short: 'KN' },
  { code: 'ml-IN', label: 'മലയാളം', flag: '🇮🇳', short: 'ML' },
  { code: 'mr-IN', label: 'मराठी', flag: '🇮🇳', short: 'MR' },
  { code: 'bn-BD', label: 'বাংলা', flag: '🇧🇩', short: 'BN' },
  { code: 'pa-IN', label: 'ਪੰਜਾਬੀ', flag: '🇮🇳', short: 'PA' },
  { code: 'ja-JP', label: '日本語', flag: '🇯🇵', short: 'JA' },
  { code: 'ko-KR', label: '한국어', flag: '🇰🇷', short: 'KO' },
  { code: 'zh-CN', label: '中文', flag: '🇨🇳', short: 'ZH' },
  { code: 'es-MX', label: 'Español', flag: '🇲🇽', short: 'ES' },
  { code: 'fr-FR', label: 'Français', flag: '🇫🇷', short: 'FR' },
  { code: 'de-DE', label: 'Deutsch', flag: '🇩🇪', short: 'DE' },
  { code: 'it-IT', label: 'Italiano', flag: '🇮🇹', short: 'IT' },
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷', short: 'PT' },
  { code: 'ru-RU', label: 'Русский', flag: '🇷🇺', short: 'RU' },
  { code: 'ar-SA', label: 'العربية', flag: '🇸🇦', short: 'AR' },
  { code: 'tr-TR', label: 'Türkçe', flag: '🇹🇷', short: 'TR' },
];

export const WATCH_REGIONS = [
  { code: 'IN', label: 'India', flag: '🇮🇳' },
  { code: 'US', label: 'United States', flag: '🇺🇸' },
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'JP', label: 'Japan', flag: '🇯🇵' },
  { code: 'KR', label: 'South Korea', flag: '🇰🇷' },
  { code: 'AU', label: 'Australia', flag: '🇦🇺' },
  { code: 'BR', label: 'Brazil', flag: '🇧🇷' },
  { code: 'DE', label: 'Germany', flag: '🇩🇪' },
];

const KEYS = { lang: 'zf.language', region: 'zf.region', list: 'zf.mylist', recent: 'zf.continue', server: 'zf.server', user: 'user' };

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/* ── preferences ───────────────────────────────────────────── */
export const getLanguage = () => read(KEYS.lang, 'en-US');
export const setLanguage = (code) => write(KEYS.lang, code);
export const getRegion = () => read(KEYS.region, 'IN');
export const setRegion = (code) => write(KEYS.region, code);
export const getPreferredServer = () => read(KEYS.server, null);
export const setPreferredServer = (id) => write(KEYS.server, id);

/**
 * Server-ranking, subtitle and ad-guard preferences share a namespace.
 * Legacy language keys are not evidence of an active audio track.
 */
export const getPreferred = (key, fallback = null) => read(`zf.pref.${key}`, fallback);
export const setPreferred = (key, value) => write(`zf.pref.${key}`, value);

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(KEYS.user) || 'null');
  } catch {
    return null;
  }
};
export const getUserName = () => getUser()?.username || null;

/* ── my list ───────────────────────────────────────────────── */
export const myList = () => read(KEYS.list, []);
export const inList = (id) => myList().some((m) => m.id === Number(id));

export function toggleList(title) {
  const current = myList();
  const exists = current.some((m) => m.id === title.id);
  const next = exists
    ? current.filter((m) => m.id !== title.id)
    : [{ ...title, addedAt: Date.now() }, ...current].slice(0, 200);
  write(KEYS.list, next);
  return !exists;
}

/* ── continue watching ─────────────────────────────────────── */
export const recent = () => read(KEYS.recent, []);

export function saveProgress(title, { season = 1, episode = 1, provider = 'trailer' } = {}) {
  if (!title?.id) return;
  const current = recent().filter((m) => m.id !== title.id);
  write(KEYS.recent, [{ ...title, season, episode, provider, at: Date.now() }, ...current].slice(0, 30));
}

export function clearProgress(id) {
  write(KEYS.recent, recent().filter((m) => m.id !== Number(id)));
}

/* ── display helpers ───────────────────────────────────────── */
export const titleOf = (t) => t?.title || t?.name || t?.original_title || 'Untitled';

export const yearOf = (t) => {
  const d = t?.release_date || t?.first_air_date || t?.first_episode_air_date;
  return d ? String(d).slice(0, 4) : '';
};

export const mediaTypeOf = (t) => t?.media_type || (t?.first_air_date ? 'tv' : t?.title ? 'movie' : 'movie');

export const ratingOf = (v) => (typeof v === 'number' && v > 0 ? v.toFixed(1) : null);

export const runtimeLabel = (mins) => {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export const numberfy = (n) => String(n).padStart(2, '0');

export const ageRating = (details) => {
  const ratings = details?.content_ratings?.results || details?.release_dates?.results || [];
  const mine = ratings.find((r) => r.iso_3166_1 === 'IN') || ratings.find((r) => r.iso_3166_1 === 'US') || ratings[0];
  return mine?.rating || mine?.certification || null;
};

export const streamDateLabel = (details) => {
  const r = (details?.release_dates?.results || []).find((x) => x.iso_3166_1 === 'IN') || details?.release_dates?.results?.[0];
  const d = r?.release_dates?.find((y) => y.type === 3 || y.type === 4)?.release_date || r?.release_dates?.[0]?.release_date;
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
};
