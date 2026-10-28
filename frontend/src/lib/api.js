import axios from 'axios';
import { API, getLanguage, getRegion } from './config';

const http = axios.create({ baseURL: API, timeout: 20000 });

const ctx = (extra = {}) => ({
  language: getLanguage(),
  region: getRegion(),
  ...extra,
});

const clientFeedCache = new Map();

/**
 * Every TMDB read in the app goes through here. The key never reaches the
 * browser — the backend proxy owns it.
 */
export const tmdb = {
  feeds: (names, params = {}) => {
    const k = `feeds:${names.join(',')}:${JSON.stringify(params)}:${getLanguage()}:${getRegion()}`;
    if (clientFeedCache.has(k)) return Promise.resolve(clientFeedCache.get(k));
    return http.get('/tmdb/feeds', { params: ctx({ names: names.join(','), ...params }) }).then((r) => {
      const data = r.data.feeds || [];
      clientFeedCache.set(k, data);
      return data;
    });
  },

  feed: (name, params = {}) => {
    const k = `feed:${name}:${JSON.stringify(params)}:${getLanguage()}:${getRegion()}`;
    if (clientFeedCache.has(k)) return Promise.resolve(clientFeedCache.get(k));
    return http.get('/tmdb/feed', { params: ctx({ name, ...params }) }).then((r) => {
      const data = r.data.results || [];
      clientFeedCache.set(k, data);
      return data;
    });
  },

  discover: (params = {}) =>
    http.get('/tmdb/discover', { params: ctx(params) }).then((r) => r.data.results || []),

  details: (type, id, params = {}) =>
    http.get('/tmdb/details', { params: ctx({ type, id, ...params }) }).then((r) => r.data),

  season: (id, season) => http.get('/tmdb/season', { params: ctx({ id, season }) }).then((r) => r.data),

  videos: (type, id) => http.get('/tmdb/videos', { params: ctx({ type, id }) }).then((r) => r.data),

  search: (q, params = {}) =>
    http.get('/tmdb/search', { params: ctx({ q, ...params }) }).then((r) => r.data.results || []),

  similar: (type, id) =>
    http.get('/tmdb/similar', { params: ctx({ type, id }) }).then((r) => r.data.results || []),

  recommendations: (type, id) =>
    http.get('/tmdb/recommendations', { params: ctx({ type, id }) }).then((r) => r.data.results || []),

  genres: (type = 'movie') => http.get('/tmdb/genres', { params: { type } }).then((r) => r.data.genres || []),

  meta: () => http.get('/tmdb/meta').then((r) => r.data),
};

export const player = {
  providers: () => http.get('/proxy/providers').then((r) => r.data),
  health: () => http.get('/health').then((r) => r.data),
};

export default http;
