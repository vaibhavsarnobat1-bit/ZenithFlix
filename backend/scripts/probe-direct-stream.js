/**
 * One-off spike: can our backend pull a DIRECT HLS stream for a title instead of
 * framing a host's player?
 *
 * Why this matters: a direct stream removes the pop-under entirely (there is no
 * third-party document at all), and an HLS manifest can carry more than one
 * audio rendition — which is the only way to switch to a Hindi track ourselves
 * rather than hoping a host's `?lang=` is honoured.
 *
 * Source of the protocol: github.com/Inside4ndroid/TMDB-Embed-API (providers/videasy.js).
 * The API answers an encrypted base64 blob; the seed endpoint hands out the key
 * for one media id. Nothing here ships until a real run returns playable URLs.
 *
 *   node backend/scripts/probe-direct-stream.js [tmdbId] [movie|tv] [season] [episode]
 */
require('dotenv').config();
const axios = require('axios');
const { details: tmdbDetails } = require('../lib/tmdb');

const API = 'https://api.speedracelight.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://player.videasy.net',
  Referer: 'https://player.videasy.net/',
};
const SERVERS = {
  CDN: `${API}/cdn/sources-with-title`,
  LaMovie: `${API}/lamovie/sources-with-title`,
  Meine: `${API}/meine/sources-with-title`,
};

/* ── the seed cipher, ported verbatim from the repo ─────────────────────── */
const MAGIC = [109, 118, 109, 49];
const HASH_TABLE = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];
const u32x = (x) => x >>> 0;
const mul32 = (a, b) => Math.imul(a, b) >>> 0;
const rotl32 = (x, n) => {
  x >>>= 0;
  n &= 31;
  return n === 0 ? x : ((x << n) | (x >>> (32 - n))) >>> 0;
};
function hash32(x) {
  x = u32x(x);
  x ^= x >>> 16;
  x = mul32(x, 2246822507);
  x ^= x >>> 13;
  x = mul32(x, 3266489909);
  x ^= x >>> 16;
  return u32x(x);
}
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = mul32(h ^ str.charCodeAt(i), 16777619);
  return hash32(h);
}
function initStream(seed, secondKey) {
  const S = new Array(61);
  let a = u32x(hash32(fnv1a(seed) ^ hash32(u32x((secondKey >>> 0) ^ 2654435769))));
  for (let i = 0; i < 8; i++) {
    if ((i * (i + 1) & 1) === 0) {
      const idx = a % 61;
      a = rotl32(a + u32x(2654435769), 7 + (7 & i));
      S[idx] = u32x(a ^ hash32(a));
      a = hash32(u32x(a + idx));
    } else {
      S[i] = HASH_TABLE[15 & i];
    }
  }
  return { S, acc: u32x(hash32(2779096485 ^ a)) };
}
function nextByte(st, ctr) {
  const r = st.S;
  const o = st.acc;
  const n = o % 61;
  const inSet = 0 - Number(n in r);
  const d = r[n] >>> 0;
  const x = u32x(d ^ mul32(2654435769, ctr + 1));
  const y = u32x((o ^ x) | (o & x & inSet));
  const no = hash32(u32x(rotl32(u32x(y + o), 31 & n) ^ rotl32(o, 31 & Math.imul(n, 7))) + 2654435769);
  r[n] = no >>> 0;
  st.acc = no;
  return no >>> 0;
}
function keystream(seed, secondKey, len) {
  const st = initStream(seed, secondKey);
  const out = new Uint8Array(len);
  let ctr = 0;
  for (let i = 0; i < len;) {
    const b = nextByte(st, ctr++);
    out[i++] = 255 & b;
    if (i < len) out[i++] = (b >>> 8) & 255;
    if (i < len) out[i++] = (b >>> 16) & 255;
    if (i < len) out[i++] = (b >>> 24) & 255;
  }
  return out;
}
function decryptPayload(payload, seed, secondKey) {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(4 * Math.ceil(payload.length / 4), '=');
  const data = Buffer.from(b64, 'base64');
  const ks = keystream(seed, secondKey, data.length);
  for (let i = 0; i < data.length; i++) data[i] ^= ks[i];
  for (let i = 0; i < MAGIC.length; i++) if (data[i] !== MAGIC[i]) throw new Error('bad magic — protocol changed');
  return data.subarray(MAGIC.length).toString('utf8');
}

(async () => {
  const tmdbId = Number(process.argv[2] || 550);
  const mediaType = process.argv[3] === 'tv' ? 'tv' : 'movie';
  const season = Number(process.argv[4] || 1);
  const episode = Number(process.argv[5] || 1);

  const details = await tmdbDetails({ type: mediaType, id: tmdbId });
  const title = details.title || details.name || '';
  const year = (details.release_date || details.first_air_date || '').slice(0, 4);
  const imdbId = details.external_ids?.imdb_id || '';
  console.log('title:', title, '| year:', year, '| imdb:', imdbId);

  let seed;
  try {
    const r = await axios.get(`${API}/seed?mediaId=${tmdbId}`, { headers: HEADERS, timeout: 10000 });
    seed = r.data?.seed;
  } catch (e) {
    console.log('seed failed:', e.response?.status || e.code, String(e.message).slice(0, 120));
    process.exit(1);
  }
  console.log('seed:', seed ? `${String(seed).slice(0, 12)}… (${String(seed).length})` : 'none');
  if (!seed) process.exit(1);

  for (const [name, base] of Object.entries(SERVERS)) {
    let url = `${base}?title=${encodeURIComponent(title)}&mediaType=${mediaType === 'tv' ? 'TV Series' : 'Movie'}&year=${year}&tmdbId=${tmdbId}&imdbId=${imdbId}`;
    if (mediaType === 'tv') url += `&seasonId=${season}&episodeId=${episode}`;
    url += `&enc=2&seed=${seed}`;
    try {
      const r = await axios.get(url, { headers: HEADERS, timeout: 12000, responseType: 'text' });
      const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      if (!raw || raw.length < 20 || raw.startsWith('<')) {
        console.log(name.padEnd(8), 'no payload, got', raw.length, 'bytes');
        continue;
      }
      const plain = decryptPayload(raw, seed, String(tmdbId));
      const data = JSON.parse(plain);
      const sources = Array.isArray(data.sources) ? data.sources : [];
      console.log(name.padEnd(8), `${sources.length} source(s)`);
      for (const s of sources.slice(0, 4)) console.log('   ', s.quality || 'auto', '→', String(s.url).slice(0, 110));
      if (data.subtitles) console.log('    subtitles:', (data.subtitles || []).length);
    } catch (e) {
      console.log(name.padEnd(8), 'failed:', String(e.message).slice(0, 90));
    }
  }
  process.exit(0);
})();
