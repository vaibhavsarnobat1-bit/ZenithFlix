/**
 * Browser side of the provider registry.
 *
 * Templates are fetched from the backend (GET /api/proxy/providers) so the URL
 * shapes live in exactly one file — backend/lib/providers.js. `FALLBACK` keeps
 * the server bar usable during the first paint or if the API call is slow.
 */
import { API } from './config';
import { titleLanguageMetadata } from './audio.js';

// Ignore legacy registry claims: no iframe provider has a verified track API.
function unsupportedAudio(provider) {
  return {
    ...provider,
    audio: [],
    langParam: null,
    ownAudioMenu: false,
    audioControl: {
      status: 'unsupported',
      canSelect: false,
      reason: 'No verified audio-track API is connected for this iframe provider.',
    },
    ...(provider.id === 'vidlink' ? { sandboxOk: false } : {}),
  };
}

const FALLBACK = [
  { id: 'trailer', label: 'HD Trailer', kind: 'trailer', quality: '1080p', tier: 2, blurb: 'Trailer listed by TMDB. Availability and embedding permission depend on YouTube and the uploader.', patterns: null },
  {
    id: 'hls-direct', label: 'Direct HLS · Multi-Audio Test', kind: 'hls', quality: '576p adaptive', tier: 2, subs: true,
    blurb: 'Direct HLS Engine with live multi-audio track switching (EN, DE, IT, FR, ES) and adaptive levels.',
    patterns: { movie: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8', tv: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8' },
  },
  {
    id: 'autoembed-multi', label: '🔥 AutoEmbed · Multi-Audio (Nitro)', kind: 'embed', quality: '1080p', tier: 1, subs: true, sandboxOk: false,
    blurb: 'AutoEmbed Multi-Language player with in-player Audio menu (Hindi, Tamil, Telugu, Malayalam, Kannada), Nitro server & 1080p quality selector.',
    patterns: { movie: 'https://nxsha.space/embed/movie/{tmdbId}', tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}' },
  },
  {
    id: 'autoembed-hindi', label: '⚡ AutoEmbed · Hindi Dub (Official)', kind: 'embed', quality: '1080p', tier: 1, subs: true, sandboxOk: false,
    blurb: 'AutoEmbed direct Hindi Dub server stream (?lang=hindi).',
    patterns: { movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=hindi&autoplay=true', tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=hindi&autoplay=true' },
  },
  {
    id: 'autoembed-tamil', label: '⚡ AutoEmbed · Tamil Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, sandboxOk: false,
    blurb: 'AutoEmbed direct Tamil Dub server stream (?lang=tamil).',
    patterns: { movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=tamil&autoplay=true', tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=tamil&autoplay=true' },
  },
  {
    id: 'autoembed-telugu', label: '⚡ AutoEmbed · Telugu Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, sandboxOk: false,
    blurb: 'AutoEmbed direct Telugu Dub server stream (?lang=telugu).',
    patterns: { movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=telugu&autoplay=true', tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=telugu&autoplay=true' },
  },
  {
    id: 'zxc-hindi', label: '⚡ Hindi Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true,
    blurb: 'Multi-Language server with direct Hindi Dub priority (?dubLang=hi).',
    patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=hi', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=hi' },
  },
  {
    id: 'zxc-tamil', label: '⚡ Tamil Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true,
    blurb: 'Tamil Dub priority stream (?dubLang=ta).',
    patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=ta', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=ta' },
  },
  {
    id: 'zxc-telugu', label: '⚡ Telugu Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true,
    blurb: 'Telugu Dub priority stream (?dubLang=te).',
    patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te' },
  },
  {
    id: 'embed-su-hindi', label: '🎬 Hindi Dub · Embed.su', kind: 'embed', quality: 'up to 1080p', tier: 2, subs: true,
    blurb: 'Fast embed host with a subtitle/language menu; requests Hindi audio first (?dub_lang=hi).',
    patterns: {
      movie: 'https://embed.su/embed/movie/{tmdbId}?dub_lang=hi',
      tv: 'https://embed.su/embed/tv/{tmdbId}/{season}/{episode}?dub_lang=hi',
    },
  },
  {
    id: 'moviebox-hindi', label: '🎬 Hindi Dub · MovieBox', kind: 'embed', quality: 'up to 1080p', tier: 2, subs: true,
    blurb: 'Lean multi-language player; requests Hindi audio first (?dub_lang=hi).',
    patterns: {
      movie: 'https://movie-box.live/embed/movie/{tmdbId}?dub_lang=hi',
      tv: 'https://movie-box.live/embed/tv/{tmdbId}/{season}/{episode}?dub_lang=hi',
    },
  },
  {
    id: 'vidlink', label: 'Server 1 · VidLink', kind: 'embed', quality: 'up to 1080p', tier: 2, subs: true,
    blurb: 'Lean player, least overlay chrome — starts fastest here.',
    patterns: { movie: 'https://vidlink.pro/movie/{tmdbId}', tv: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}' },
  },
  {
    id: 'vidsrcpm', label: 'Server 2 · VidSrc.pm', kind: 'embed', quality: 'up to 1080p', tier: 2, subs: true,
    blurb: 'Full HTML5 player: subtitles, auto next-episode.',
    patterns: { movie: 'https://vidsrc.pm/embed/movie/{tmdbId}', tv: 'https://vidsrc.pm/embed/tv/{tmdbId}/{season}/{episode}' },
  },
  {
    id: '2embed', label: 'Server 3 · 2Embed', kind: 'embed', quality: 'up to 1080p', tier: 2,
    blurb: 'Has its own internal server picker — good last resort.',
    patterns: { movie: 'https://www.2embed.cc/embed/{tmdbId}', tv: 'https://www.2embed.cc/embedtv/{tmdbId}?s={season}&e={episode}' },
  },
  {
    id: '2embedskin', label: 'Server 4 · 2Embed Mirror', kind: 'embed', quality: 'up to 1080p', tier: 2,
    blurb: 'Same fleet on a second domain — use when 2Embed rate-limits.',
    patterns: { movie: 'https://www.2embed.skin/embed/{tmdbId}', tv: 'https://www.2embed.skin/embedtv/{tmdbId}?s={season}&e={episode}' },
  },
  {
    id: 'autoembed', label: 'Server 5 · AutoEmbed', kind: 'embed', quality: 'up to 1080p', tier: 2,
    blurb: 'Slow to paint on some networks.',
    patterns: {
      movie: 'https://player.autoembed.co/embed/movie/{tmdbId}',
      tv: 'https://player.autoembed.co/embed/tv/{tmdbId}/{season}/{episode}',
    },
  },
  {
    id: 'smashy', label: 'Server 6 · SmashyStream', kind: 'embed', quality: 'up to 1080p', tier: 2,
    blurb: 'Aggregator across several internal servers — strong on older prints.',
    patterns: {
      movie: 'https://player.smashystream.com/playere.php?tmdb={tmdbId}',
      tv: 'https://player.smashystream.com/playere.php?tmdb={tmdbId}&season={season}&episode={episode}',
    },
  },
  {
    id: 'vidfast', label: 'Server 7 · VidFast', kind: 'embed', quality: 'up to 4K', tier: 3, subs: true,
    blurb: 'Only 4K advertiser we have — but the flakiest source API too.',
    patterns: { movie: 'https://vidfast.pro/movie/{tmdbId}?autoPlay=true', tv: 'https://vidfast.pro/tv/{tmdbId}/{season}/{episode}?autoPlay=true' },
  },
  {
    id: 'videasy', label: 'Server 8 · Videasy', kind: 'embed', quality: 'up to 1080p', tier: 2, subs: true,
    blurb: 'The engine behind VidSrc.pm on its own domain. Its menu picks subtitle language and source — a second route to a print.',
    patterns: { movie: 'https://player.videasy.net/movie/{tmdbId}', tv: 'https://player.videasy.net/tv/{tmdbId}/{season}/{episode}' },
  },
  {
    id: 'vidfastvc', label: 'Server 9 · VidFast Mirror', kind: 'embed', quality: 'up to 4K', tier: 3, subs: true,
    blurb: 'VidFast on its second domain — same 4K fleet, used when vidfast.pro rate-limits.',
    patterns: { movie: 'https://vidfast.vc/movie/{tmdbId}?autoPlay=true', tv: 'https://vidfast.vc/tv/{tmdbId}/{season}/{episode}?autoPlay=true' },
  },
].map(unsupportedAudio);

const FALLBACK_ORDER = ['vidsrcpm', 'autoembed-multi', 'autoembed-hindi', 'zxc-hindi', 'autoembed-tamil', 'autoembed-telugu', 'videasy', 'autoembed', 'vidlink', 'smashy', '2embed', '2embedskin', 'vidfast', 'vidfastvc', 'embed-su-hindi', 'moviebox-hindi'];

// Hosts that detect our pop-up cage and refuse to play inside it, measured by
// reading each host's own page (2Embed ships a "Sandbox not allowed" overlay)
// and confirmed in a live browser for VidLink and the ZXCStream dub servers.
const CAGE_SNIFFERS = ['vidlink', 'autoembed-multi', 'autoembed-hindi', 'autoembed-tamil', 'autoembed-telugu', 'zxc-hindi', 'zxc-tamil', 'zxc-telugu', '2embed', '2embedskin'];
for (const p of FALLBACK) {
  if (p.kind === 'embed') p.sandboxOk = !CAGE_SNIFFERS.includes(p.id);
}

/**
 * Server a viewer lands on before the backend health probe answers.
 * VidSrc.pm as default — reliable and fast.
 */
export const DEFAULT_SERVER = 'vidsrcpm';

let registry = null;
let healthPromise = null;
let health = null;

/**
 * Ask the backend which embed hosts are alive and frameable right now.
 * Resolves to { servers: {id:{ok,reason}}, working: [ids] } — never rejects,
 * because a failed probe must not take the player down with it.
 */
export function loadHealth() {
  if (health) return Promise.resolve(health);
  if (!healthPromise) {
    healthPromise = fetch(`${API}/proxy/health`, { signal: AbortSignal.timeout?.(15000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        health = data && data.servers ? data : { servers: {}, working: FALLBACK_ORDER };
        return health;
      })
      .catch(() => {
        health = { servers: {}, working: FALLBACK_ORDER };
        return health;
      });
  }
  return healthPromise;
}

export function healthSnapshot() {
  return health;
}

export async function loadProviders() {
  if (registry) return registry;
  try {
    const res = await fetch(`${API}/proxy/providers`, { signal: AbortSignal.timeout?.(9000) });
    if (!res.ok) throw new Error(`providers ${res.status}`);
    const data = await res.json();
    registry = {
      providers: data.providers?.length ? data.providers.map(unsupportedAudio) : FALLBACK,
      fallbackOrder: data.fallbackOrder?.length ? data.fallbackOrder : FALLBACK_ORDER,
    };
  } catch {
    registry = { providers: FALLBACK, fallbackOrder: FALLBACK_ORDER };
  }
  return registry;
}

export function providersSync() {
  return registry?.providers || FALLBACK;
}

export function findProvider(id) {
  return providersSync().find((p) => p.id === id) || null;
}

export function interpolate(pattern, args) {
  return String(pattern)
    .replace(/\{tmdbId\}/g, String(args.tmdbId))
    .replace(/\{season\}/g, String(args.season || 1))
    .replace(/\{episode\}/g, String(args.episode || 1));
}

/**
 * Audio language requests are ignored without a verified audio-track API.
 * @returns {{ok:boolean, url?:string, kind?:string, provider?:object, reason?:string, langApplied:boolean}}
 */
export function buildSource(providerId, args) {
  const provider = findProvider(providerId);
  if (!provider) return { ok: false, reason: `Server "${providerId}" is not in the registry`, langApplied: false };

  if (provider.kind === 'trailer') {
    if (!args.youtubeKey) return { ok: false, reason: 'No official trailer on TMDB for this title', langApplied: false };
    // YouTube throws "Error 153" when enablejsapi is on but the player cannot
    // resolve its embedding origin, so always pass it explicitly.
    const origin = typeof window === 'undefined' ? '' : `&origin=${encodeURIComponent(window.location.origin)}`;
    return {
      ok: true,
      kind: 'trailer',
      provider,
      url: `https://www.youtube-nocookie.com/embed/${args.youtubeKey}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origin}`,
      langApplied: false,
    };
  }

  if (provider.kind === 'hls') {
    const key = args.type === 'tv' ? 'tv' : 'movie';
    const url = provider.patterns?.[key] || provider.patterns?.movie || args.customHlsUrl;
    if (!url) return { ok: false, reason: 'No HLS stream URL configured', langApplied: false };
    return { ok: true, kind: 'hls', provider, url, langApplied: false };
  }

  const key = args.type === 'tv' ? 'tv' : 'movie';
  if (!provider.patterns?.[key]) return { ok: false, reason: `${provider.label} has no ${key} template`, langApplied: false };
  const url = interpolate(provider.patterns[key], args);
  return { ok: true, kind: 'embed', provider, url, langApplied: false };
}

/** Servers the watchdog may auto-advance through (never auto-lands on trailer). */
export function embedServerIds() {
  return providersSync().filter((p) => p.kind === 'embed' || p.kind === 'hls').map((p) => p.id);
}

export const AUDIO_LABELS = {
  original: 'Original audio',
  hi: 'Hindi dubbed',
  ta: 'Tamil dubbed',
  te: 'Telugu dubbed',
  ml: 'Malayalam dubbed',
  kn: 'Kannada dubbed',
  mr: 'Marathi dubbed',
  bn: 'Bengali dubbed',
  pa: 'Punjabi dubbed',
  gu: 'Gujarati dubbed',
  ur: 'Urdu dubbed',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
  ar: 'Arabic',
  tr: 'Turkish',
  id: 'Indonesian',
  th: 'Thai',
  vi: 'Vietnamese',
  // TMDB reports these for Hollywood titles too; without a name the UI falls
  // back to the raw code and "HE dubbed" reads like a typo.
  he: 'Hebrew',
  uk: 'Ukrainian',
  fa: 'Persian',
  el: 'Greek',
  cs: 'Czech',
  da: 'Danish',
  nl: 'Dutch',
  fi: 'Finnish',
  hu: 'Hungarian',
  no: 'Norwegian',
  pl: 'Polish',
  ro: 'Romanian',
  sv: 'Swedish',
  tl: 'Filipino',
  ms: 'Malay',
};

/** ISO 639-1 → display name for title language metadata, not observed tracks. */
export function languageName(code) {
  if (!code) return '';
  if (code === 'original') return 'Original audio';
  return AUDIO_LABELS[code]?.replace(/ dubbed$/, '') || code.toUpperCase();
}

/**
 * Load per-title language metadata, not evidence of this iframe's audio tracks.
 * Cache successful metadata only; failures remain retryable. Concurrent requests
 * for the same title share one in-flight request.
 */
const dubCache = new Map();
const dubInflight = new Map();
export async function loadDubs(type, id) {
  const unavailable = () => ({ ...titleLanguageMetadata(null), type, id: Number(id) || id });
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return unavailable();
  const key = `${type}:${id}`;
  if (dubCache.has(key)) return dubCache.get(key);
  if (dubInflight.has(key)) return dubInflight.get(key);
  const job = fetch(`${API}/tmdb/dubs?type=${type}&id=${id}`, { signal: AbortSignal.timeout?.(9000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const metadata = titleLanguageMetadata(data);
      if (metadata.status === 'unavailable') return unavailable();
      dubCache.set(key, metadata);
      return metadata;
    })
    .catch(unavailable)
    .finally(() => dubInflight.delete(key));
  dubInflight.set(key, job);
  return job;
}
