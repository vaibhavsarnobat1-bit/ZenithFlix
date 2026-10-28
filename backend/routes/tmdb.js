const express = require('express');
const tmdb = require('../lib/tmdb');

const router = express.Router();

/** Wrap an async handler so rejections become JSON 502s instead of hanging. */
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    if (data === undefined || data === null) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) {
    const status = err.code === 'NO_KEY' ? 503 : err.response?.status === 404 ? 404 : 502;
    if (status === 503) return res.status(503).json({ error: 'TMDB_API_KEY missing', detail: err.message });
    res.status(status).json({ error: 'tmdb_failed', detail: err.message, status: err.response?.status });
  }
};

const lang = (req) => req.query.language || req.query.lang || 'en-US';
const region = (req) => req.query.region || req.query.watch_region || undefined;

/* GET /api/tmdb/feeds — one call per row, plus the row plan for the home grid */
router.get('/feeds', handle(async (req) => {
  const { names } = req.query;
  const list = (names || 'trending')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => tmdb.hasFeed(n));

  const language = lang(req);
  const watchRegion = region(req);

  const results = await Promise.all(
    list.map(async (name) => {
      try {
        const data = await tmdb.feed({ name, page: req.query.page, language, region: watchRegion });
        return { name, results: data.results || [] };
      } catch (err) {
        return { name, results: [], error: err.message };
      }
    })
  );

  return { language, region: watchRegion, feeds: results };
}));

/* GET /api/tmdb/feed?name=trending */
router.get('/feed', handle((req) =>
  tmdb.feed({
    name: req.query.name || 'trending',
    page: req.query.page,
    language: lang(req),
    region: region(req),
  })
));

/* GET /api/tmdb/discover?type=tv&genre=16&originalLanguage=ja */
router.get('/discover', handle((req) =>
  tmdb.discover({
    type: req.query.type === 'tv' ? 'tv' : 'movie',
    genre: req.query.genre,
    language: lang(req),
    originalLanguage: req.query.originalLanguage,
    year: req.query.year,
    region: region(req),
    sortBy: req.query.sortBy,
    page: req.query.page,
    voteAverage: req.query.voteAverage,
    person: req.query.person,
    mindate: req.query.mindate,
    maxdate: req.query.maxdate,
  })
));

/* GET /api/tmdb/details?type=movie&id=27205 */
router.get('/details', handle((req) =>
  tmdb.details({ type: req.query.type || 'movie', id: req.query.id, language: lang(req) })
));

/* GET /api/tmdb/season?id=1396&season=3 */
router.get('/season', handle((req) =>
  tmdb.season({ id: req.query.id, season: req.query.season || 1, language: lang(req) })
));

/* GET /api/tmdb/videos?type=tv&id=1396 */
router.get('/videos', handle(async (req) => {
  const data = await tmdb.videos({
    type: req.query.type || 'movie',
    id: req.query.id,
    language: req.query.lang || 'en-US',
  });
  const vids = (data.results || []).filter((v) => v.site === 'YouTube');
  const rank = (v) =>
    (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) + (v.official ? 0 : 0.5);
  const sorted = [...vids].sort((a, b) => rank(a) - rank(b));
  return { ...data, sorted, best: sorted[0] || null };
}));

/* GET /api/tmdb/dubs?type=movie&id=550 — catalogue languages, NOT stream audio tracks */
router.get('/dubs', handle((req) =>
  tmdb.dubs({ type: req.query.type === 'tv' ? 'tv' : 'movie', id: req.query.id })
));

router.get('/similar', handle((req) =>
  tmdb.similar({ type: req.query.type || 'movie', id: req.query.id, page: req.query.page, language: lang(req) })
));

router.get('/recommendations', handle((req) =>
  tmdb.recommendations({ type: req.query.type || 'movie', id: req.query.id, page: req.query.page, language: lang(req) })
));

/* GET /api/tmdb/search?q=... */
router.get('/search', handle(async (req) => {
  const data = await tmdb.search({
    query: req.query.q || req.query.query || '',
    page: req.query.page,
    language: lang(req),
  });
  return { ...data, results: (data.results || []).filter((r) => r.media_type !== 'person') };
}));

/* GET /api/tmdb/find?externalId=tt1375666 */
router.get('/find', handle((req) =>
  tmdb.findByExternal({
    externalId: req.query.externalId,
    externalSource: req.query.externalSource || 'imdb_id',
    language: lang(req),
  })
));

router.get('/genres', handle((req) => tmdb.genres(req.query.type === 'tv' ? 'tv' : 'movie')));

router.get('/keywords', handle((req) => tmdb.keywords(req.query.id)));

/* GET /api/tmdb/credits?type=movie&id=27205 (cast + crew + guest stars) */
router.get('/credits', handle((req) =>
  tmdb.episodesCast({ type: req.query.type || 'movie', id: req.query.id, language: lang(req) })
));

/* GET /api/tmdb/meta — capability probe used by the UI banner */
router.get('/meta', (req, res) => {
  res.json({
    keyConfigured: tmdb.keyConfigured(),
    feeds: tmdb.FEED_NAMES,
    imageBase: { small: 'https://image.tmdb.org/t/p/w342', large: 'https://image.tmdb.org/t/p/w1280', original: 'https://image.tmdb.org/t/p/original' },
  });
});

module.exports = router;
