/**
 * TMDB access layer — single place where the API key lives, caching happens
 * and transient network failures are retried.
 *
 * TMDB v3 flakiness on mobile/shared ISP connections is real (we saw 200/000
 * alternating on the same endpoint), so every read goes through `request()`
 * which retries with backoff and serves a short-lived memory cache.
 */
const axios = require('axios');

const BASE = 'https://api.themoviedb.org/3';
const KEY = () => process.env.TMDB_API_KEY;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const cache = new Map();
const inflight = new Map();

function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  return null;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
  // crude size guard
  if (cache.size > 400) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(path, params = {}) {
  const url = `${BASE}${path}`;
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get(url, {
        params,
        timeout: 12000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ZenithFlix/2.0',
        },
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const retryable = !status || RETRYABLE_STATUS.has(status);
      if (!retryable || attempt === 2) break;
      // 429 carries a retry hint
      const retryAfter = Number(err.response?.headers?.['retry-after']) || 0;
      await sleep(Math.max(400, retryAfter * 1000) * (attempt + 1));
    }
  }

  throw lastError;
}

/** Cached entry point. `ttl` in seconds. */
async function request(path, params = {}, ttl = 300) {
  if (!KEY()) {
    const err = new Error('TMDB_API_KEY is not set');
    err.code = 'NO_KEY';
    throw err;
  }
  const cacheKey = `${path}?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  ).toString()}&api_key=${KEY()}`;

  const cached = cacheGet(cacheKey, ttl * 1000);
  if (cached) return cached;

  // One upstream call per key even when the home grid asks for it twelve times
  // in the same tick.
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const job = (async () => {
    try {
      const data = await raw(path, { ...params, api_key: KEY() });
      cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      // TMDB blips are routine: an hour-old catalogue beats a blank row.
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
   FEED CATALOGUE — every list the browse UI can ask for
   ────────────────────────────────────────────────────────────── */

const FEEDS = {
  // hero / row feeds
  trending:        (o) => ({ path: '/trending/all/week',            params: {} }),
  trending_day:    (o) => ({ path: '/trending/all/day',             params: {} }),
  popular_movie:   () => ({ path: '/movie/popular',                 params: {} }),
  popular_tv:      () => ({ path: '/tv/popular',                   params: {} }),
  top_movie:       () => ({ path: '/movie/top_rated',               params: {} }),
  top_tv:          () => ({ path: '/tv/top_rated',                  params: {} }),
  now_playing:     (o) => ({ path: '/movie/now_playing',            params: { region: o.region } }),
  upcoming:        (o) => ({ path: '/movie/upcoming',               params: { region: o.region } }),
  airing_today:    () => ({ path: '/tv/airing_today',               params: {} }),
  on_the_air:      () => ({ path: '/tv/on_the_air',                 params: {} }),
  original_movie:  () => ({ path: '/movie/popular',                 params: {} }),
  // genre shortcuts used by the chips row
  action:          (o) => ({ path: '/discover/movie',               params: { with_genres: 28 } }),
  comedy:          (o) => ({ path: '/discover/movie',               params: { with_genres: 35 } }),
  horror:          (o) => ({ path: '/discover/movie',               params: { with_genres: 27 } }),
  sci_fi:          (o) => ({ path: '/discover/movie',               params: { with_genres: 878 } }),
  romance:         (o) => ({ path: '/discover/movie',               params: { with_genres: 10749 } }),
  thriller:        (o) => ({ path: '/discover/movie',               params: { with_genres: 53 } }),
  animation:       (o) => ({ path: '/discover/movie',               params: { with_genres: 16 } }),
  documentary:     (o) => ({ path: '/discover/movie',               params: { with_genres: 99 } }),
  crime:           (o) => ({ path: '/discover/movie',               params: { with_genres: 80 } }),
  adventure:       (o) => ({ path: '/discover/movie',               params: { with_genres: 12 } }),
  reality_tv:      () => ({ path: '/discover/tv',                   params: { with_genres: 10764 } }),
  anime_tv:        (o) => ({ path: '/discover/tv',                  params: { with_genres: 16, with_original_language: 'ja' } }),
  k_drama:         () => ({ path: '/discover/tv',                   params: { with_genres: 18, with_original_language: 'ko' } }),
  // regional cinema (the "all language" rows)
  bollywood:       () => ({ path: '/discover/movie',                params: { with_original_language: 'hi' } }),
  tollywood:       () => ({ path: '/discover/movie',                params: { with_original_language: 'te' } }),
  kollywood:       () => ({ path: '/discover/movie',                params: { with_original_language: 'ta' } }),
  mollywood:       () => ({ path: '/discover/movie',                params: { with_original_language: 'ml' } }),
  sandalwood:      () => ({ path: '/discover/movie',                params: { with_original_language: 'kn' } }),
  hollywood:       () => ({ path: '/discover/movie',                params: { with_original_language: 'en' } }),
  korean:          () => ({ path: '/movie/popular',                 params: { with_original_language: 'ko', region: 'KR' } }),
  japanese:        () => ({ path: '/discover/movie',                params: { with_original_language: 'ja' } }),
  chinese:         () => ({ path: '/discover/movie',                params: { with_original_language: 'zh' } }),
  turkish:         () => ({ path: '/discover/movie',                params: { with_original_language: 'tr' } }),
  spanish:         () => ({ path: '/discover/movie',                params: { with_original_language: 'es' } }),
};

async function feed({ name, page = 1, language, region, sortBy, voteCount }) {
  const builder = FEEDS[name] || FEEDS.trending;
  const { path, params } = builder({ region });

  return request(
    path,
    {
      ...params,
      page: Number(page) || 1,
      language: language || 'en-US',
      include_adult: false,
      ...(sortBy ? { sort_by: sortBy } : {}),
      ...(voteCount ? { 'with_vote_count.gte': voteCount } : {}),
    },
    name.startsWith('trending') ? 120 : 600
  );
}

/** Feeds the browse page asks for on first paint. */
const WARM_FEEDS = ['trending', 'now_playing', 'airing_today', 'popular_movie', 'top_tv', 'anime_tv', 'action', 'bollywood', 'tollywood', 'k_drama', 'horror', 'documentary'];

/**
 * Prefetch the home catalogue so the very visitor never pays the cold-start
 * price. Failures are swallowed — `request()` still serves stale data.
 */
async function warm({ language = 'en-US', region = 'IN', names = WARM_FEEDS } = {}) {
  const out = await Promise.allSettled(names.map((name) => feed({ name, language, region })));
  return { ok: out.filter((r) => r.status === 'fulfilled').length, total: names.length };
}

/** Free-form discover with every filter the UI exposes. */
async function discover({ type = 'movie', genre, language, originalLanguage, year, region, sortBy, page = 1, mindate, maxdate, voteAverage, person }) {
  const path = type === 'tv' ? '/discover/tv' : '/discover/movie';
  return request(
    path,
    {
      page: Number(page) || 1,
      language,
      with_genres: genre,
      with_original_language: originalLanguage,
      primary_release_year: year,
      primary_release_region: region,
      region: type === 'movie' ? region : undefined,
      sort_by: sortBy || 'popularity.desc',
      'vote_average.gte': voteAverage,
      'vote_count.gte': 50,
      'primary_release_date.gte': mindate,
      'primary_release_date.lte': maxdate,
      with_people: person,
      include_adult: false,
    },
    600
  );
}

const DETAILS_APPEND = 'credits,videos,images,external_ids,release_dates,content_ratings';

/**
 * Localized TMDB records are incomplete: a hi-IN request often returns a Hindi
 * title but an empty overview, and its `append_to_response=videos` list can
 * come back empty. So we always merge the en-US record underneath the
 * requested locale and take the first non-empty field.
 */
async function details({ type = 'movie', id, language }) {
  const lang = language || 'en-US';
  const primary = await request(
    type === 'tv' ? `/tv/${id}` : type === 'person' ? `/person/${id}` : `/movie/${id}`,
    { language: lang, append_to_response: type === 'person' ? 'combined_credits,images,external_ids' : type === 'tv' ? 'credits,videos,images,external_ids,content_ratings' : DETAILS_APPEND },
    900
  );

  if (lang !== 'en-US') {
    try {
      const fallback = await request(
        type === 'tv' ? `/tv/${id}` : type === 'person' ? `/person/${id}` : `/movie/${id}`,
        { language: 'en-US', append_to_response: type === 'person' ? 'combined_credits' : 'credits,videos,images' },
        900
      );
      return mergeLocalized(primary, fallback, type);
    } catch {
      return primary;
    }
  }

  // en-US base: media lists are sometimes still empty on the append call
  if (type !== 'person' && !(primary.videos?.results?.length)) {
    try {
      const vids = await videos({ type, id, language: 'en-US' });
      primary.videos = { results: vids.results || [] };
    } catch {}
  }
  return primary;
}

function mergeLocalized(primary, fallback, type) {
  const out = { ...primary };
  const titleKey = type === 'tv' ? 'name' : type === 'person' ? 'name' : 'title';

  if (!out.overview?.trim() && fallback.overview) out.overview = fallback.overview;
  if (!out.tagline?.trim() && fallback.tagline) out.tagline = fallback.tagline;
  if (!out[titleKey]?.trim() && fallback[titleKey]) out[titleKey] = fallback[titleKey];

  // Keep both spellings so the UI can show "localizedName (originalTitle)"
  if (fallback.original_title || fallback.original_name) {
    out.original_title = fallback.original_title || fallback.original_name;
  }

  if (!out.videos?.results?.length && fallback.videos?.results?.length) {
    out.videos = fallback.videos;
  }
  if (!out.images?.posters?.length && fallback.images) out.images = fallback.images;

  const castKey = type === 'person' ? 'combined_credits' : 'credits';
  if (!out[castKey]?.cast?.length && fallback[castKey]?.cast?.length) {
    out[castKey] = fallback[castKey];
  }

  out._localized = { requested: primary.original_language ? true : true, titleLocalized: Boolean(primary[titleKey]) };
  return out;
}

async function season({ id, season: s, language }) {
  return request(`/tv/${id}/season/${s}`, { language: language || 'en-US' }, 1800);
}

async function episodesCast({ type = 'movie', id, language }) {
  return request(
    type === 'tv' ? `/tv/${id}/episode_groups` : `/movie/${id}/credits`,
    { language: language || 'en-US' },
    1800
  );
}

function videos({ type = 'movie', id, language }) {
  return request(`${type === 'tv' ? '/tv' : '/movie'}/${id}/videos`, { language: language || 'en-US' }, 1800);
}

/**
 * TMDB title-language metadata, NOT selected-source audio availability.
 * Release territories, translated titles and localized trailers cannot establish
 * a full movie's dub or a stream rendition. Only original/spoken-language fields
 * are displayed as catalogue facts, never as selectable audio tracks.
 */
const LANG_NAMES = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  mr: 'Marathi', bn: 'Bengali', pa: 'Punjabi', gu: 'Gujarati', ur: 'Urdu', tl: 'Filipino',
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', tr: 'Turkish', id: 'Indonesian',
  vi: 'Vietnamese', th: 'Thai', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish',
  no: 'Norwegian', fi: 'Finnish', he: 'Hebrew', uk: 'Ukrainian', cs: 'Czech', hu: 'Hungarian',
  ro: 'Romanian', el: 'Greek', fa: 'Persian', ms: 'Malay',
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
    // Compatibility fields remain empty so an older client cannot mistake these
    // catalogue records for a stream's audio tracks.
    audio: [],
    dubs: [],
    trackAvailability: 'unknown',
  };
}

// Keep the existing /dubs route, but return an explicitly typed metadata payload.
async function dubs({ type = 'movie', id }) {
  const kind = type === 'tv' ? 'tv' : 'movie';
  const base = await request(`/${kind}/${id}`, { language: 'en-US' }, 3600);
  return titleLanguages(base, { type: kind, id });
}

function similar({ type = 'movie', id, page = 1, language }) {
  return request(`${type === 'tv' ? '/tv' : '/movie'}/${id}/similar`, { page, language: language || 'en-US' }, 900);
}

function recommendations({ type = 'movie', id, page = 1, language }) {
  return request(`${type === 'tv' ? '/tv' : '/movie'}/${id}/recommendations`, { page, language: language || 'en-US' }, 900);
}

function search({ query, page = 1, language, includeAdult = false }) {
  return request(
    '/search/multi',
    { query, page, language: language || 'en-US', include_adult: includeAdult },
    60
  );
}

function findByExternal({ externalId, externalSource = 'imdb_id', language }) {
  return request(`/find/${externalId}`, { external_source: externalSource, language: language || 'en-US' }, 3600);
}

function genres(type = 'movie') {
  return request(`/genre/${type}/list`, { language: 'en-US' }, 86400);
}

function keywords(id) {
  return request(`/movie/${id}/keywords`, {}, 86400);
}

module.exports = {
  request,
  feed,
  warm,
  discover,
  details,
  season,
  episodesCast,
  videos,
  dubs,
  titleLanguages,
  similar,
  recommendations,
  search,
  findByExternal,
  genres,
  keywords,
  FEED_NAMES: Object.keys(FEEDS),
  hasFeed: (name) => Object.prototype.hasOwnProperty.call(FEEDS, name),
  keyConfigured: () => Boolean(KEY()),
};
