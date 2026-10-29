require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Fallback TMDB key
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || '53197d3e62a7727696caf69c6a2dd55e';

// Inline TMDB and Provider handlers for 100% self-contained serverless deployment
const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const tmdbReq = async (path, params = {}) => {
  const res = await axios.get(`${TMDB_BASE}${path}`, {
    params: { api_key: process.env.TMDB_API_KEY, ...params },
    timeout: 12000
  });
  return res.data;
};

// Feeds
app.get('/api/tmdb/feeds', async (req, res) => {
  try {
    const list = (req.query.names || 'trending').split(',').map(s => s.trim());
    const lang = req.query.language || 'en-US';
    const region = req.query.region || undefined;

    const feeds = await Promise.all(
      list.map(async (name) => {
        try {
          let path = '/trending/all/day';
          if (name === 'top_rated') path = '/movie/top_rated';
          else if (name === 'action') path = '/discover/movie?with_genres=28';
          else if (name === 'comedy') path = '/discover/movie?with_genres=35';
          else if (name === 'bollywood') path = '/discover/movie?with_original_language=hi';
          else if (name === 'popular_movies') path = '/movie/popular';
          else if (name === 'popular_tv') path = '/tv/popular';
          
          const data = await tmdbReq(path, { language: lang, region });
          return { name, results: data.results || [] };
        } catch {
          return { name, results: [] };
        }
      })
    );
    res.json({ language: lang, region, feeds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single feed
app.get('/api/tmdb/feed', async (req, res) => {
  try {
    const name = req.query.name || 'trending';
    let path = '/trending/all/day';
    if (name === 'top_rated') path = '/movie/top_rated';
    else if (name === 'popular_movies') path = '/movie/popular';
    else if (name === 'popular_tv') path = '/tv/popular';
    const data = await tmdbReq(path, { language: req.query.language || 'en-US' });
    res.json({ results: data.results || [] });
  } catch (err) {
    res.status(500).json({ results: [], error: err.message });
  }
});

// Details
app.get('/api/tmdb/details', async (req, res) => {
  try {
    const { type = 'movie', id } = req.query;
    const data = await tmdbReq(`/${type}/${id}`, {
      append_to_response: 'videos,credits,similar,recommendations',
      language: req.query.language || 'en-US'
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search
app.get('/api/tmdb/search', async (req, res) => {
  try {
    const { q, page = 1 } = req.query;
    const data = await tmdbReq('/search/multi', { query: q, page, language: req.query.language || 'en-US' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ results: [], error: err.message });
  }
});

// Discover
app.get('/api/tmdb/discover', async (req, res) => {
  try {
    const { type = 'movie', ...rest } = req.query;
    const data = await tmdbReq(`/discover/${type}`, rest);
    res.json(data);
  } catch (err) {
    res.status(500).json({ results: [], error: err.message });
  }
});

// Season
app.get('/api/tmdb/season', async (req, res) => {
  try {
    const { id, season = 1 } = req.query;
    const data = await tmdbReq(`/tv/${id}/season/${season}`, { language: req.query.language || 'en-US' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Providers list
app.get('/api/proxy/providers', (req, res) => {
  try {
    const { PROVIDERS } = require('../backend/lib/providers');
    res.json({ default: 'zxc-hindi', providers: PROVIDERS });
  } catch {
    res.json({
      default: 'zxc-hindi',
      providers: [
        { id: 'zxc-hindi', label: '⚡ Server: Hindi Dub (Official)', kind: 'embed', quality: '1080p', tier: 1, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=hi', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=hi' } },
        { id: 'zxc-tamil', label: '⚡ Server: Tamil Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=ta', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=ta' } },
        { id: 'zxc-telugu', label: '⚡ Server: Telugu Dub', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te', tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te' } },
        { id: 'vidlink', label: 'S1: VidLink', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://vidlink.pro/movie/{tmdbId}', tv: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}' } },
        { id: 'vidsrcpm', label: 'S2: VidSrc.pm', kind: 'embed', quality: '1080p', tier: 2, subs: true, patterns: { movie: 'https://vidsrc.pm/embed/movie/{tmdbId}', tv: 'https://vidsrc.pm/embed/tv/{tmdbId}/{season}/{episode}' } }
      ]
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'ZenithFlix Edge API', tmdb: true, time: Date.now() });
});

module.exports = app;
