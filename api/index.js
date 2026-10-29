require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Hardcoded fallback TMDB key if not present in env
if (!process.env.TMDB_API_KEY) {
  process.env.TMDB_API_KEY = '53197d3e62a7727696caf69c6a2dd55e';
}

const tmdbRoutes = require('../backend/routes/tmdb');
const proxyRoutes = require('../backend/routes/proxy');

app.use('/api/tmdb', tmdbRoutes);
app.use('/api/proxy', proxyRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'ZenithFlix Serverless API',
    tmdb: Boolean(process.env.TMDB_API_KEY),
    time: Date.now()
  });
});

module.exports = app;
