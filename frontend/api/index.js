/**
 * Pure Node.js serverless handler for Vercel — zero external dependencies.
 *
 * This file is what the hosted site actually answers /api/* with (the Vercel
 * project root is `frontend/`, so `frontend/api/index.js` wins over the Express
 * app in the repo root). It is deliberately dependency-free: an Express lambda
 * has to unpack express + axios + cheerio on every cold start, which is exactly
 * the multi-second "server is slow to start" wait on mobile.
 *
 * Because it is a second implementation, it MUST keep the same contract as
 * backend/routes/*.js + backend/lib/*.js. The feed catalogue, provider list and
 * response shapes below are mirrors of backend/lib/tmdb.js and
 * backend/lib/providers.js — change one, change the other.
 */

const TMDB_KEY = process.env.TMDB_API_KEY || '53197d3e62a7727696caf69c6a2dd55e';
const TMDB_BASE = 'https://api.themoviedb.org/3';

/* ──────────────────────────────────────────────────────────────
   TMDB client — retry + short-lived cache + in-flight dedupe
   (mirrors backend/lib/tmdb.js request())
   ────────────────────────────────────────────────────────────── */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const cache = new Map();
const inflight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  return null;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

async function raw(path, params) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  }
  const url = `${TMDB_BASE}${path}?${query.toString()}`;
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'ZenithFlix/2.0' },
      });
      if (!res.ok) {
        const err = new Error(`TMDB ${res.status} on ${path}`);
        err.status = res.status;
        err.retryAfter = Number(res.headers.get('retry-after')) || 0;
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      const retryable = !err.status || RETRYABLE.has(err.status);
      if (!retryable || attempt === 2) break;
      await sleep(Math.max(400, (err.retryAfter || 1) * 1000) * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** `ttl` in seconds. Serves stale data when TMDB blips, like the Express lib. */
async function request(path, params = {}, ttl = 300) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  }
  const cacheKey = `${path}?${query.toString()}`;

  const cached = cacheGet(cacheKey, ttl * 1000);
  if (cached) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const job = (async () => {
    try {
      const data = await raw(path, { ...params, api_key: TMDB_KEY });
      cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      const stale = cache.get(cacheKey);
      if (stale) return stale.data;
      throw err;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, job);
  return job;
}

/* ──────────────────────────────────────────────────────────────
   FEED CATALOGUE — mirror of backend/lib/tmdb.js FEEDS
   ────────────────────────────────────────────────────────────── */

const FEEDS = {
  trending: () => ({ path: '/trending/all/week', params: {} }),
  trending_day: () => ({ path: '/trending/all/day', params: {} }),
  popular_movie: () => ({ path: '/movie/popular', params: {} }),
  popular_tv: () => ({ path: '/tv/popular', params: {} }),
  top_movie: () => ({ path: '/movie/top_rated', params: {} }),
  top_tv: () => ({ path: '/tv/top_rated', params: {} }),
  now_playing: (o) => ({ path: '/movie/now_playing', params: { region: o.region } }),
  upcoming: (o) => ({ path: '/movie/upcoming', params: { region: o.region } }),
  airing_today: () => ({ path: '/tv/airing_today', params: {} }),
  on_the_air: () => ({ path: '/tv/on_the_air', params: {} }),
  original_movie: () => ({ path: '/movie/popular', params: {} }),
  action: () => ({ path: '/discover/movie', params: { with_genres: 28 } }),
  comedy: () => ({ path: '/discover/movie', params: { with_genres: 35 } }),
  horror: () => ({ path: '/discover/movie', params: { with_genres: 27 } }),
  sci_fi: () => ({ path: '/discover/movie', params: { with_genres: 878 } }),
  romance: () => ({ path: '/discover/movie', params: { with_genres: 10749 } }),
  thriller: () => ({ path: '/discover/movie', params: { with_genres: 53 } }),
  animation: () => ({ path: '/discover/movie', params: { with_genres: 16 } }),
  documentary: () => ({ path: '/discover/movie', params: { with_genres: 99 } }),
  crime: () => ({ path: '/discover/movie', params: { with_genres: 80 } }),
  adventure: () => ({ path: '/discover/movie', params: { with_genres: 12 } }),
  reality_tv: () => ({ path: '/discover/tv', params: { with_genres: 10764 } }),
  anime_tv: () => ({ path: '/discover/tv', params: { with_genres: 16, with_original_language: 'ja' } }),
  k_drama: () => ({ path: '/discover/tv', params: { with_genres: 18, with_original_language: 'ko' } }),
  bollywood: () => ({ path: '/discover/movie', params: { with_original_language: 'hi' } }),
  tollywood: () => ({ path: '/discover/movie', params: { with_original_language: 'te' } }),
  kollywood: () => ({ path: '/discover/movie', params: { with_original_language: 'ta' } }),
  mollywood: () => ({ path: '/discover/movie', params: { with_original_language: 'ml' } }),
  sandalwood: () => ({ path: '/discover/movie', params: { with_original_language: 'kn' } }),
  hollywood: () => ({ path: '/discover/movie', params: { with_original_language: 'en' } }),
  korean: () => ({ path: '/movie/popular', params: { with_original_language: 'ko', region: 'KR' } }),
  japanese: () => ({ path: '/discover/movie', params: { with_original_language: 'ja' } }),
  chinese: () => ({ path: '/discover/movie', params: { with_original_language: 'zh' } }),
  turkish: () => ({ path: '/discover/movie', params: { with_original_language: 'tr' } }),
  spanish: () => ({ path: '/discover/movie', params: { with_original_language: 'es' } }),
};

const FEED_NAMES = Object.keys(FEEDS);

function feed({ name, page = 1, language, region }) {
  const builder = FEEDS[name] || FEEDS.trending;
  const { path, params } = builder({ region });
  return request(
    path,
    {
      ...params,
      page: Number(page) || 1,
      language: language || 'en-US',
      include_adult: false,
    },
    String(name || '').startsWith('trending') ? 120 : 600
  );
}

/* ──────────────────────────────────────────────────────────────
   Details / videos / dubs — mirrors of backend/lib/tmdb.js
   ────────────────────────────────────────────────────────────── */

const DETAILS_APPEND = 'credits,videos,images,external_ids,release_dates,content_ratings';
const pathFor = (type, id) => (type === 'tv' ? `/tv/${id}` : type === 'person' ? `/person/${id}` : `/movie/${id}`);
const appendFor = (type) =>
  type === 'person'
    ? 'combined_credits,images,external_ids'
    : type === 'tv'
      ? 'credits,videos,images,external_ids,content_ratings'
      : DETAILS_APPEND;

function videos({ type = 'movie', id, language }) {
  return request(`${pathFor(type, id)}/videos`, { language: language || 'en-US' }, 900);
}

function mergeLocalized(primary, fallback, type) {
  const out = { ...primary };
  const titleKey = type === 'person' || type === 'tv' ? 'name' : 'title';

  if (!out.overview?.trim() && fallback.overview) out.overview = fallback.overview;
  if (!out.tagline?.trim() && fallback.tagline) out.tagline = fallback.tagline;
  if (!out[titleKey]?.trim() && fallback[titleKey]) out[titleKey] = fallback[titleKey];
  if (fallback.original_title || fallback.original_name) {
    out.original_title = fallback.original_title || fallback.original_name;
  }
  if (!out.videos?.results?.length && fallback.videos?.results?.length) out.videos = fallback.videos;
  if (!out.images?.posters?.length && fallback.images) out.images = fallback.images;

  const castKey = type === 'person' ? 'combined_credits' : 'credits';
  if (!out[castKey]?.cast?.length && fallback[castKey]?.cast?.length) out[castKey] = fallback[castKey];

  out._localized = { requested: true, titleLocalized: Boolean(primary[titleKey]) };
  return out;
}

async function details({ type = 'movie', id, language }) {
  const lang = language || 'en-US';
  const primary = await request(pathFor(type, id), { language: lang, append_to_response: appendFor(type) }, 900);

  if (lang !== 'en-US') {
    try {
      const fallback = await request(
        pathFor(type, id),
        { language: 'en-US', append_to_response: type === 'person' ? 'combined_credits' : 'credits,videos,images' },
        900
      );
      return mergeLocalized(primary, fallback, type);
    } catch {
      return primary;
    }
  }

  if (type !== 'person' && !(primary.videos?.results?.length)) {
    try {
      const vids = await videos({ type, id, language: 'en-US' });
      primary.videos = { results: vids.results || [] };
    } catch {}
  }
  return primary;
}

const LANG_NAMES = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  mr: 'Marathi', bn: 'Bengali', pa: 'Punjabi', gu: 'Gujarati', ur: 'Urdu', or: 'Odia',
  as: 'Assamese', my: 'Burmese', ne: 'Nepali', si: 'Sinhala', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', ar: 'Arabic', tr: 'Turkish', id: 'Indonesian', th: 'Thai', vi: 'Vietnamese',
  nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  he: 'Hebrew', uk: 'Ukrainian', cs: 'Czech', hu: 'Hungarian', ro: 'Romanian', el: 'Greek',
  fa: 'Persian', ms: 'Malay',
};

function titleLanguages(base = {}, { type = 'movie', id } = {}) {
  const codeOf = (value) => {
    const code = String(value || '').toLowerCase();
    return /^[a-z]{2}$/.test(code) && code !== 'xx' ? code : null;
  };
  const original = codeOf(base.original_language);
  const byCode = new Map();
  const add = (value, evidence) => {
    const code = codeOf(value);
    if (!code) return;
    const row = byCode.get(code) || { code, name: LANG_NAMES[code] || code, evidence: [], original: code === original };
    if (!row.evidence.includes(evidence)) row.evidence.push(evidence);
    byCode.set(code, row);
  };
  add(original, 'original-language');
  if (Array.isArray(base.spoken_languages)) {
    base.spoken_languages.forEach((row) => add(row?.iso_639_1, 'spoken-language'));
  }
  return {
    kind: 'title-language-metadata',
    status: 'loaded',
    source: 'tmdb',
    id: Number(id) || id,
    type: type === 'tv' ? 'tv' : 'movie',
    originalLanguage: original,
    originalName: original ? LANG_NAMES[original] || original : null,
    languages: [...byCode.values()],
    audio: [],
    dubs: [],
    trackAvailability: 'unknown',
  };
}

async function dubs({ type = 'movie', id }) {
  const kind = type === 'tv' ? 'tv' : 'movie';
  const base = await request(`/${kind}/${id}`, { language: 'en-US' }, 3600);
  return titleLanguages(base, { type: kind, id });
}

/* ──────────────────────────────────────────────────────────────
   PROVIDER REGISTRY — mirror of backend/lib/providers.js
   Every entry is a third-party embed. Ad blocking happens in the
   browser, by framing the host inside a sandbox with no pop-up
   permission; a stateless function cannot relay a whole page.
   ────────────────────────────────────────────────────────────── */

const P = (id, label, extra = {}) => ({
  id,
  label,
  ...extra,
  audio: [],
  langParam: null,
  ownAudioMenu: false,
  audioControl: {
    status: 'unsupported',
    canSelect: false,
    reason: 'No verified audio-track API is connected for this iframe provider.',
  },
});

const PROVIDERS = [
  P('trailer', 'HD Trailer', {
    kind: 'trailer',
    blurb: 'Trailer listed by TMDB. Availability and embedding permission depend on YouTube and the uploader.',
    quality: '1080p',
  }),
  P('hls-direct', 'Direct HLS · Multi-Audio Test', {
    kind: 'hls',
    blurb: 'Direct HLS Engine with live multi-audio track switching (EN, DE, IT, FR, ES) and adaptive levels.',
    quality: '576p adaptive',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
      tv: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    },
  }),
  P('autoembed-multi', '🔥 AutoEmbed · Multi-Audio (Nitro)', {
    kind: 'embed',
    blurb: 'AutoEmbed Multi-Language player with in-player Audio menu (Hindi, Tamil, Telugu, Malayalam, Kannada), Nitro server & 1080p quality selector.',
    quality: '1080p',
    tier: 1,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}',
    },
  }),
  P('autoembed-hindi', '⚡ AutoEmbed · Hindi Dub (Official)', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Hindi Dub server stream (?lang=hindi).',
    quality: '1080p',
    tier: 1,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=hindi&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=hindi&autoplay=true',
    },
  }),
  P('autoembed-nitro', '⚡ Nitro · Multi-Lang HD', {
    kind: 'embed',
    blurb: 'AutoEmbed Nitro Multi-Language HD stream (OrVid).',
    quality: '1080p',
    tier: 1,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=hindi&autoplay=true&one_server=true&server=OrVid-[Multi-Lang]',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=hindi&autoplay=true&one_server=true&server=OrVid-[Multi-Lang]',
    },
  }),
  P('autoembed-tamil', '⚡ AutoEmbed · Tamil Dub', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Tamil Dub server stream (?lang=tamil).',
    quality: '1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=tamil&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=tamil&autoplay=true',
    },
  }),
  P('autoembed-telugu', '⚡ AutoEmbed · Telugu Dub', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Telugu Dub server stream (?lang=telugu).',
    quality: '1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=telugu&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=telugu&autoplay=true',
    },
  }),
  P('zxc-hindi', '⚡ Server: Hindi Dub (Official)', {
    kind: 'embed',
    blurb: 'Dedicated Multi-Language server with direct Hindi Dub priority (?dubLang=hi, ta, te).',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    // Seen live in a browser: inside a sandboxed frame it paints "Sandbox Not
    // Supported" instead of a player, so it must be framed uncaged.
    sandboxOk: false,
    patterns: {
      movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=hi',
      tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=hi',
    },
  }),
  P('zxc-tamil', '⚡ Server: Tamil Dub', {
    kind: 'embed',
    blurb: 'Tamil Dub priority stream from ZXCStream.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: {
      movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=ta',
      tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=ta',
    },
  }),
  P('zxc-telugu', '⚡ Server: Telugu Dub', {
    kind: 'embed',
    blurb: 'Telugu Dub priority stream from ZXCStream.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: {
      movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te',
      tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te',
    },
  }),
  P('vidlink', 'Server 1 · VidLink', {
    kind: 'embed',
    blurb: 'Lean player, least overlay chrome — starts fastest here.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: { movie: 'https://vidlink.pro/movie/{tmdbId}', tv: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}' },
  }),
  P('vidsrcpm', 'Server 2 · VidSrc.pm', {
    kind: 'embed',
    blurb: 'Full HTML5 player: subtitles, auto next-episode.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: { movie: 'https://vidsrc.pm/embed/movie/{tmdbId}', tv: 'https://vidsrc.pm/embed/tv/{tmdbId}/{season}/{episode}' },
  }),
  P('2embed', 'Server 3 · 2Embed', {
    kind: 'embed',
    blurb: 'Has its own internal server picker — good last resort.',
    quality: 'up to 1080p',
    tier: 2,
    // Its page ships a literal "Sandbox not allowed" overlay.
    sandboxOk: false,
    patterns: { movie: 'https://www.2embed.cc/embed/{tmdbId}', tv: 'https://www.2embed.cc/embedtv/{tmdbId}?s={season}&e={episode}' },
  }),
  P('2embedskin', 'Server 4 · 2Embed Mirror', {
    kind: 'embed',
    blurb: 'Same fleet on a second domain — use when 2Embed rate-limits.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: false,
    patterns: { movie: 'https://www.2embed.skin/embed/{tmdbId}', tv: 'https://www.2embed.skin/embedtv/{tmdbId}?s={season}&e={episode}' },
  }),
  P('autoembed', 'Server 5 · AutoEmbed', {
    kind: 'embed',
    blurb: 'Embedded player on player.autoembed.co.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: true,
    patterns: {
      movie: 'https://player.autoembed.co/embed/movie/{tmdbId}',
      tv: 'https://player.autoembed.co/embed/tv/{tmdbId}/{season}/{episode}',
    },
  }),
  P('smashy', 'Server 6 · SmashyStream', {
    kind: 'embed',
    blurb: 'Aggregator across several internal servers — strong on older prints.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: true,
    patterns: {
      movie: 'https://player.smashystream.com/playere.php?tmdb={tmdbId}',
      tv: 'https://player.smashystream.com/playere.php?tmdb={tmdbId}&season={season}&episode={episode}',
    },
  }),
  P('vidfast', 'Server 7 · VidFast', {
    kind: 'embed',
    blurb: 'Only 4K advertiser we have — but the flakiest source API too.',
    quality: 'up to 4K',
    tier: 3,
    subs: true,
    sandboxOk: true,
    patterns: { movie: 'https://vidfast.pro/movie/{tmdbId}?autoPlay=true', tv: 'https://vidfast.pro/tv/{tmdbId}/{season}/{episode}?autoPlay=true' },
  }),
  P('videasy', 'Server 8 · Videasy', {
    kind: 'embed',
    blurb: 'The engine behind VidSrc.pm on its own domain. Its menu picks subtitle language and source — a second route to a print.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: { movie: 'https://player.videasy.net/movie/{tmdbId}', tv: 'https://player.videasy.net/tv/{tmdbId}/{season}/{episode}' },
  }),
  P('vidfastvc', 'Server 9 · VidFast Mirror', {
    kind: 'embed',
    blurb: 'VidFast on its second domain — same 4K fleet, used when vidfast.pro rate-limits.',
    quality: 'up to 4K',
    tier: 3,
    subs: true,
    sandboxOk: true,
    patterns: { movie: 'https://vidfast.vc/movie/{tmdbId}?autoPlay=true', tv: 'https://vidfast.vc/tv/{tmdbId}/{season}/{episode}?autoPlay=true' },
  }),
];

const FALLBACK_ORDER = ['autoembed-multi', 'autoembed-hindi', 'autoembed-nitro', 'zxc-hindi', 'vidsrcpm', 'autoembed-tamil', 'autoembed-telugu', 'vidlink', 'videasy', 'autoembed', 'smashy', '2embed', '2embedskin', 'vidfast', 'vidfastvc'];

/* ──────────────────────────────────────────────────────────────
   Embed-host reachability — mirror of GET /api/proxy/health
   One HEAD per embed host, cached for ten minutes, six-second cap.
   ────────────────────────────────────────────────────────────── */

const HEALTH_TTL_MS = 10 * 60 * 1000;
let healthCache = null;

function probe(provider) {
  const url = provider.patterns?.movie;
  if (!url) return Promise.resolve({ id: provider.id, label: provider.label, ok: false, reason: 'No probe URL' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  return fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' })
    .then((res) => ({ id: provider.id, label: provider.label, ok: res.status < 500, status: res.status, reason: res.ok ? 'Reachable' : `Upstream answered ${res.status}` }))
    .catch(() => ({ id: provider.id, label: provider.label, ok: false, reason: 'Unreachable from this region' }))
    .finally(() => clearTimeout(timer));
}

async function proxyHealth() {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache;

  const embeds = PROVIDERS.filter((p) => p.kind === 'embed');
  const results = await Promise.all(embeds.map(probe));
  const servers = Object.fromEntries(results.map((r) => [r.id, r]));
  healthCache = {
    at: now,
    checkedAt: new Date(now).toISOString(),
    servers,
    working: FALLBACK_ORDER.filter((id) => servers[id]?.ok),
    order: FALLBACK_ORDER,
  };
  return healthCache;
}

/* ──────────────────────────────────────────────────────────────
   Router
   ────────────────────────────────────────────────────────────── */

const langOf = (q) => q.language || q.lang || 'en-US';
const regionOf = (q) => q.region || q.watch_region || undefined;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams.entries());

  try {
    /* Order matters: every more-specific path has to be tested before the
       generic `/health` and `/feed` substrings, which would otherwise swallow
       `/proxy/health` and `/tmdb/feeds`. */

    if (pathname.includes('/tmdb/meta')) {
      return send(res, 200, {
        keyConfigured: Boolean(TMDB_KEY),
        feeds: FEED_NAMES,
        imageBase: { small: 'https://image.tmdb.org/t/p/w342', large: 'https://image.tmdb.org/t/p/w1280', original: 'https://image.tmdb.org/t/p/original' },
      });
    }

    if (pathname.includes('/tmdb/feeds')) {
      const list = String(q.names || 'trending')
        .split(',')
        .map((n) => n.trim())
        .filter((n) => FEEDS[n]);
      const language = langOf(q);
      const region = regionOf(q);
      const feeds = await Promise.all(
        list.map(async (name) => {
          try {
            const data = await feed({ name, page: q.page, language, region });
            return { name, results: data.results || [] };
          } catch (err) {
            return { name, results: [], error: err.message };
          }
        })
      );
      return send(res, 200, { language, region, feeds });
    }

    if (pathname.includes('/tmdb/feed')) {
      const data = await feed({ name: q.name || 'trending', page: q.page, language: langOf(q), region: regionOf(q) });
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/discover')) {
      const type = q.type === 'tv' ? 'tv' : 'movie';
      const data = await request(
        type === 'tv' ? '/discover/tv' : '/discover/movie',
        {
          page: Number(q.page) || 1,
          language: langOf(q),
          with_genres: q.genre,
          with_original_language: q.originalLanguage,
          primary_release_year: q.year,
          primary_release_region: q.region,
          region: type === 'movie' ? q.region : undefined,
          sort_by: q.sortBy || 'popularity.desc',
          'vote_average.gte': q.voteAverage,
          'vote_count.gte': 50,
          'primary_release_date.gte': q.mindate,
          'primary_release_date.lte': q.maxdate,
          with_people: q.person,
          include_adult: false,
        },
        600
      );
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/details')) {
      const data = await details({ type: q.type || 'movie', id: q.id, language: langOf(q) });
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/season')) {
      const data = await request(`/tv/${q.id}/season/${q.season || 1}`, { language: langOf(q) }, 900);
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/videos')) {
      const data = await videos({ type: q.type || 'movie', id: q.id, language: langOf(q) });
      const vids = (data.results || []).filter((v) => v.site === 'YouTube');
      const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) + (v.official ? 0 : 0.5);
      const sorted = [...vids].sort((a, b) => rank(a) - rank(b));
      return send(res, 200, { ...data, sorted, best: sorted[0] || null });
    }

    if (pathname.includes('/tmdb/search')) {
      const data = await request(
        '/search/multi',
        { query: q.q || q.query || '', page: Number(q.page) || 1, language: langOf(q), include_adult: false },
        60
      );
      return send(res, 200, { ...data, results: (data.results || []).filter((r) => r.media_type !== 'person') });
    }

    if (pathname.includes('/tmdb/similar')) {
      const type = q.type === 'tv' ? 'tv' : 'movie';
      const data = await request(`/${type}/${q.id}/similar`, { page: Number(q.page) || 1, language: langOf(q) }, 900);
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/recommendations')) {
      const type = q.type === 'tv' ? 'tv' : 'movie';
      const data = await request(`/${type}/${q.id}/recommendations`, { page: Number(q.page) || 1, language: langOf(q) }, 900);
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/dubs')) {
      const data = await dubs({ type: q.type === 'tv' ? 'tv' : 'movie', id: q.id });
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/find')) {
      const data = await request(`/find/${encodeURIComponent(q.externalId || '')}`, {
        external_source: q.externalSource || 'imdb_id',
        language: langOf(q),
      }, 900);
      return send(res, 200, data);
    }

    if (pathname.includes('/tmdb/keywords')) {
      return send(res, 200, await request(`/movie/${q.id}/keywords`, {}, 86400));
    }

    if (pathname.includes('/tmdb/credits')) {
      const type = q.type === 'tv' ? 'tv' : 'movie';
      return send(res, 200, await request(`/${type}/${q.id}/credits`, { language: langOf(q) }, 3600));
    }

    if (pathname.includes('/tmdb/genres')) {
      return send(res, 200, await request(`/genre/${q.type === 'tv' ? 'tv' : 'movie'}/list`, { language: langOf(q) }, 86400));
    }

    if (pathname.includes('/proxy/providers')) {
      return send(res, 200, {
        default: 'autoembed-multi',
        providers: PROVIDERS,
        fallbackOrder: FALLBACK_ORDER,
      });
    }

    if (pathname.includes('/proxy/health')) {
      return send(res, 200, await proxyHealth());
    }

    if (pathname.includes('/health')) {
      return send(res, 200, { status: 'ok', name: 'ZenithFlix Edge API', tmdb: Boolean(TMDB_KEY), time: Date.now() });
    }

    return send(res, 404, { error: 'Endpoint not found', path: pathname });
  } catch (err) {
    const status = err.status === 404 ? 404 : 502;
    return send(res, status, { error: 'upstream_failed', detail: err.message, status: err.status || null });
  }
}
