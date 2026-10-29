// Pure Node.js Serverless Handler for Vercel — Zero external dependencies, 100% reliable
const TMDB_KEY = process.env.TMDB_API_KEY || '53197d3e62a7727696caf69c6a2dd55e';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const PROVIDERS = [
  { id: 'trailer', label: 'HD Trailer', kind: 'trailer', quality: '1080p', tier: 2, blurb: 'Trailer listed by TMDB.' },
  { id: 'hls-direct', label: 'Direct HLS · Multi-Audio Test', kind: 'hls', quality: '576p adaptive', tier: 2, subs: true, patterns: { movie: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8', tv: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8' } },
  { id: 'zxc-hindi', label: '⚡ Server: Hindi Dub (Official)', kind: 'embed', quality: '1080p', tier: 1, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=hi', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=hi' } },
  { id: 'zxc-tamil', label: '⚡ Server: Tamil Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=ta', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=ta' } },
  { id: 'zxc-telugu', label: '⚡ Server: Telugu Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te' } },
  { id: 'vidlink', label: 'S1: VidLink', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://vidlink.pro/movie/{tmdbId}', tv: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}' } },
  { id: 'vidsrcpm', label: 'S2: VidSrc.pm', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://vidsrc.pm/embed/movie/{tmdbId}', tv: 'https://vidsrc.pm/embed/tv/{tmdbId}/{season}/{episode}' } },
  { id: '2embed', label: 'S3: 2Embed', kind: 'embed', quality: '1080p', tier: 3, subs: true, patterns: { movie: 'https://www.2embed.cc/embed/{tmdbId}', tv: 'https://www.2embed.cc/embedtv/{tmdbId}&s={season}&e={episode}' } },
  { id: 'autoembed', label: 'S4: AutoEmbed', kind: 'embed', quality: '1080p', tier: 3, subs: true, patterns: { movie: 'https://player.autoembed.cc/embed/movie/{tmdbId}', tv: 'https://player.autoembed.cc/embed/tv/{tmdbId}/{season}/{episode}' } }
];

async function tmdbFetch(path, params = {}) {
  const query = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const url = `${TMDB_BASE}${path}?${query.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB responded with ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const q = Object.fromEntries(parsedUrl.searchParams.entries());

  try {
    // 1. Providers
    if (pathname.includes('/proxy/providers')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ default: 'zxc-hindi', providers: PROVIDERS }));
    }

    // 2. Health
    if (pathname.includes('/health')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ status: 'ok', name: 'ZenithFlix Edge API', tmdb: true, time: Date.now() }));
    }

    // 3. TMDB Feeds
    if (pathname.includes('/tmdb/feeds')) {
      const list = (q.names || 'trending').split(',').map((s) => s.trim());
      const language = q.language || 'en-US';
      const region = q.region || undefined;

      const feeds = await Promise.all(
        list.map(async (name) => {
          try {
            let path = '/trending/all/day';
            const params = { language };
            if (region) params.region = region;

            if (name === 'top_rated') path = '/movie/top_rated';
            else if (name === 'action') { path = '/discover/movie'; params.with_genres = '28'; }
            else if (name === 'comedy') { path = '/discover/movie'; params.with_genres = '35'; }
            else if (name === 'bollywood') { path = '/discover/movie'; params.with_original_language = 'hi'; }
            else if (name === 'popular_movies') path = '/movie/popular';
            else if (name === 'popular_tv') path = '/tv/popular';

            const data = await tmdbFetch(path, params);
            return { name, results: data.results || [] };
          } catch {
            return { name, results: [] };
          }
        })
      );

      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ language, region, feeds }));
    }

    // 4. TMDB Single Feed
    if (pathname.includes('/tmdb/feed')) {
      const name = q.name || 'trending';
      let path = '/trending/all/day';
      const params = { language: q.language || 'en-US' };
      if (name === 'top_rated') path = '/movie/top_rated';
      else if (name === 'popular_movies') path = '/movie/popular';
      else if (name === 'popular_tv') path = '/tv/popular';

      const data = await tmdbFetch(path, params);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ results: data.results || [] }));
    }

    // 5. TMDB Details
    if (pathname.includes('/tmdb/details')) {
      const type = q.type || 'movie';
      const id = q.id;
      const data = await tmdbFetch(`/${type}/${id}`, {
        append_to_response: 'videos,credits,similar,recommendations',
        language: q.language || 'en-US'
      });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // 6. TMDB Search
    if (pathname.includes('/tmdb/search')) {
      const query = q.q || '';
      const data = await tmdbFetch('/search/multi', {
        query,
        page: q.page || '1',
        language: q.language || 'en-US'
      });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // 7. TMDB Discover
    if (pathname.includes('/tmdb/discover')) {
      const type = q.type || 'movie';
      const { type: _, ...rest } = q;
      const data = await tmdbFetch(`/discover/${type}`, rest);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // 8. TMDB Season
    if (pathname.includes('/tmdb/season')) {
      const id = q.id;
      const season = q.season || '1';
      const data = await tmdbFetch(`/tv/${id}/season/${season}`, { language: q.language || 'en-US' });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // 9. TMDB Genres
    if (pathname.includes('/tmdb/genres')) {
      const type = q.type || 'movie';
      const data = await tmdbFetch(`/genre/${type}/list`, { language: q.language || 'en-US' });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // 10. TMDB Videos
    if (pathname.includes('/tmdb/videos')) {
      const type = q.type || 'movie';
      const id = q.id;
      const data = await tmdbFetch(`/${type}/${id}/videos`, { language: q.language || 'en-US' });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(data));
    }

    // Default 404
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found', path: pathname }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}
