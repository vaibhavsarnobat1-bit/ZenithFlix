// Routes and libraries read configuration at require-time.
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const setupSyncEngine = require('./socket/syncEngine');
const proxyRoutes = require('./routes/proxy');
const tmdbRoutes = require('./routes/tmdb');
const authRoutes = require('./routes/auth');

const production = process.env.NODE_ENV === 'production';
function configuredOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}
const developmentOrigins = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://127.0.0.1:5174',
  'http://localhost:5175', 'http://127.0.0.1:5175',
  'http://localhost:5176', 'http://127.0.0.1:5176',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5000', 'http://127.0.0.1:5000',
];
const corsConfigured = Boolean(process.env.CORS_ORIGIN?.trim());
const allowedOrigins = new Set((corsConfigured ? process.env.CORS_ORIGIN.split(',') : production ? [] : developmentOrigins)
  .map((value) => configuredOrigin(value.trim())).filter(Boolean));
if (production && !corsConfigured) {
  console.warn('[ZenithFlix] CORS_ORIGIN is missing: browser REST and Socket.IO origins will be rejected. Configure a comma-separated HTTPS origin allowlist.');
} else if (corsConfigured && !allowedOrigins.size) {
  console.warn('[ZenithFlix] CORS_ORIGIN contains no valid origins: browser origins will be rejected.');
}
const originAllowed = (origin) => {
  if (!origin) return true;
  if (!production) {
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    } catch {
      // invalid URL
    }
  }
  return allowedOrigins.has(origin);
};
const corsOptions = {
  origin: (origin, callback) => callback(null, originAllowed(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  // CORS alone does not protect the WebSocket transport.
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin)),
  maxHttpBufferSize: 64 * 1024,
});

app.use((req, res, next) => {
  if (!originAllowed(req.headers.origin)) {
    return res.status(403).json({ error: 'This browser origin is not allowed. Configure CORS_ORIGIN on the backend.' });
  }
  next();
});
app.use(cors(corsOptions));
app.use(express.json());

function publicHttps(value, originOnly = false) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      host.includes('.') && !host.endsWith('.localhost') && !host.endsWith('.local') && !host.endsWith('.internal') &&
      !/^\d+(\.\d+){3}$/.test(host) && (originOnly ? url.pathname === '/' : true);
  } catch {
    return false;
  }
}

// Routes
app.use('/api/proxy', proxyRoutes);
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/auth', authRoutes);

// Health exposes readiness flags only, never credentials or configured values.
app.get('/api/health', (req, res) =>
  res.json({
    status: 'ok', name: 'ZenithFlix API', tmdb: Boolean(process.env.TMDB_API_KEY), time: Date.now(),
    publicDeployment: {
      configured: publicHttps(process.env.PUBLIC_WEB_ORIGIN, true) && publicHttps(process.env.PUBLIC_API_BASE),
    },
  })
);

// Socket.io sync engine
setupSyncEngine(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[ZenithFlix] Server running on port ${PORT}`);
  // Warm the home catalogue in the background — first paint stays fast.
  if (process.env.TMDB_API_KEY) {
    setTimeout(() => {
      require('./lib/tmdb')
        .warm()
        .then((r) => console.log(`[tmdb] catalogue warmed: ${r.ok}/${r.total} feeds`))
        .catch(() => {});
    }, 600);
  }
});
