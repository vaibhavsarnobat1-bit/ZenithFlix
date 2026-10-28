const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const tmdb = require('../lib/tmdb');
const {
  byId,
  buildUpstreamUrl,
  serialize,
  PROVIDERS,
  FALLBACK_ORDER,
} = require('../lib/providers');

const router = express.Router();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ──────────────────────────────────────────────────────────────
   AD NETWORK BLOCKLIST
   ────────────────────────────────────────────────────────────── */
const AD_DOMAINS = [
  'popads', 'popcash', 'propellerads', 'adcash', 'exoclick', 'trafficjunky',
  'juicyads', 'hilltopads', 'adsterra', 'mgid', 'revcontent', 'taboola',
  'outbrain', 'doubleclick', 'googleads', 'googlesyndication', 'adsbygoogle',
  'adsystem', 'adnxs', 'advertising', 'popunder', 'pounder', 'onclick',
  'clickunder', 'trackad', 'adservice', 'adtrack', 'smartadserver', 'openx',
  'pubmatic', 'rubicon', 'appnexus', 'criteo', 'bidswitch', 'casalemedia',
  'dotomi', 'valueclick', 'zedo', 'adblade', 'vibrantmedia', 'adsonar',
  'adcaptcha', 'captchabear', 'ad-gate', 'blockreport',
  // analytics / fingerprint beacons — not ads, but they cost a request and
  // track the viewer, so the sanitizer drops them too
  'histats', 'hotlog', 'google-analytics', 'googletagmanager', 'mc.yandex',
  'yandex.ru/metrika', 'scorecardresearch', 'statcounter', 'insights.stat',
  'cloudflareinsights', 'cetrk', 'amplitude', 'mparticle', 'segment.io',
];

/**
 * Tokens that name a real ad network. A generic browser API is not one of
 * these — see `isAdInline()` for why that distinction matters.
 */
const AD_PATTERNS = [
  'popunder', 'popads', 'clickunder', 'onclick', 'popcash', 'adcash',
  'exoclick', 'propellerads', 'adsterra', 'hilltopads', 'juicyads',
  'trafficjunky', 'trafficstars', 'revcontent', 'adsbygoogle', 'googletag',
  'adserver', 'eval(atob',
];

/** Calls that only exist to open or redirect a window. */
const POPUP_ONLY = /window\.(?:top\.)?open\(|window\.top\.location|top\.location\s*=/;

/**
 * Embed hosts ship tripwires that detect how they are being framed and then
 * either blank the page or bounce it to a warning screen. They are not part of
 * the player, so the sanitizer drops them:
 *   · `documentElement.innerHTML = ''`  — the "die" guard, fired when it can
 *     tell storage is blocked (which is exactly what a proxied frame looks like)
 *   · `document.domain = …` / `asb.html` — the anti-sandbox / anti-proxy snitch
 */
const ANTI_PROXY = [/documentElement\.innerHTML\s*=/, /document\.domain\s*=/, /asb\.html/, /hasAttribute\(["']sandbox["']\)/];

/**
 * Should this inline script be removed?
 *
 * The previous version of this rule tested for `window.open` / `document.write`
 * on their own, and that made us our own worst enemy: AutoEmbed ships its entire
 * 68 KB player bundle as a single inline script, that bundle mentions `window.open`
 * once, and the sanitizer cheerfully deleted the thing the viewer came to watch —
 * which is why the "+ AdShield" twin painted a black rectangle. So an application
 * script is kept unless it names an ad network; only short scripts whose whole job
 * is opening a window are treated as popunder loaders.
 */
function isAdInline(code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (ANTI_PROXY.some((re) => re.test(trimmed))) return true;
  if (AD_PATTERNS.some((t) => lower.includes(t))) return true;
  if (AD_DOMAINS.some((d) => lower.includes(d))) return true;
  return trimmed.length < 3000 && POPUP_ONLY.test(trimmed);
}

/**
 * TLDs that carry the popunder networks these hosts lease.
 *
 * The blocklist above names networks, and that is useless against a fleet whose
 * domains are registered weekly — `meatusbyway.cfd` and
 * `ovinae.fungicdiauloschemmy.qpon` were both fetched by VidSrc.pm's own page
 * while we were cleaning it. Not one provider we embed lives on one of these
 * suffixes, so for an embed page they are as close to a signature as a rotating
 * campaign gets, and matching on the suffix rather than a substring means
 * `vidsrc.pm` and `2embed.cc` keep their ordinary names.
 */
const SHADY_TLDS = new Set([
  'cfd', 'qpon', 'icu', 'sbs', 'top', 'buzz', 'beauty', 'monster', 'hair',
  'skint', 'auto', 'tackles', 'webcam', 'play', 'quest', 'rest', 'bond', 'fit',
]);

function isShadyHost(url) {
  try {
    const { hostname } = new URL(/^https?:/.test(url) ? url : `http://${url}`);
    return SHADY_TLDS.has(hostname.split('.').pop());
  } catch {
    return false;
  }
}

const isAdUrl = (url) => {
  if (!url) return false;
  const lower = String(url).toLowerCase();
  return isShadyHost(lower) || AD_DOMAINS.some((d) => lower.includes(d));
};

/**
 * Only upstream hosts we are allowed to fetch — no open proxy.
 * Derived from the registry so the allowlist can never drift from the
 * provider patterns.
 */
const ALLOWED_HOSTS = new Set(
  PROVIDERS.flatMap((p) =>
    Object.values(p.patterns || {}).reduce((hosts, pattern) => {
      const match = pattern.match(/https?:\/\/([^/]+)/);
      return match ? [...hosts, match[1]] : hosts;
    }, [])
  )
);

/**
 * Hosts discovered *inside* an upstream document.
 *
 * This is the difference between a sanitizer and a proxy. An embed page is a
 * door: AutoEmbed hands off to a CDN player, VidSrc streams from a file server,
 * and neither of those domains appear in our registry. Rewriting their URLs to
 * point back at us is what makes AdShield work — and for that, our fetch route
 * has to be allowed to ask them for bytes.
 *
 * So the list is not static, it is learned, and it is only ever written by the
 * sanitizer while it is already talking to a host we trust. An attacker cannot
 * stuff it: to get a hostname in here you first have to be served inside a
 * document we chose to fetch. Ad domains are filtered on the way in, and the
 * set rotates like an LRU so a long-lived process cannot accumulate the whole
 * internet.
 */
const DERIVED_HOSTS = new Set();
const DERIVED_CAP = 400;

function rememberHost(hostname) {
  if (!hostname || isAdUrl(hostname)) return;
  if (DERIVED_HOSTS.size >= DERIVED_CAP) DERIVED_HOSTS.delete(DERIVED_HOSTS.keys().next().value);
  DERIVED_HOSTS.add(hostname);
}

function isAllowedTarget(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    if (ALLOWED_HOSTS.has(hostname) || DERIVED_HOSTS.has(hostname)) return true;
    // sub/sibling hosts of an allowlisted domain (embed.x.com when x.com is listed)
    const hosts = [...ALLOWED_HOSTS, ...DERIVED_HOSTS];
    return hosts.some((h) => hostname.endsWith(`.${h}`) || h.endsWith(`.${hostname}`));
  } catch {
    return false;
  }
}

/** Our own asset routes, used both when rewriting documents and when shimming fetch(). */
const RAW_ROUTE = '/api/proxy/raw';
const DOC_ROUTE = '/api/proxy/doc';

/** A URL-safe tag for one upstream origin, used as the first path segment of the relay. */
const originTag = (origin) => Buffer.from(String(origin)).toString('base64url');
const originFromTag = (tag) => {
  try {
    return new URL(Buffer.from(String(tag), 'base64url').toString()).origin;
  } catch {
    return null;
  }
};

/**
 * Route a URL an upstream document asked for back through us.
 * Returns null when the URL must be left exactly as it is — our own routes
 * (loop guard), data blobs, and anything on an ad network.
 *
 * The relay mirrors the upstream's own path (`/raw/<origin>/hls/seg-7.ts`) rather
 * than flattening it into a query string, and that is the whole reason the
 * previous version of this file could not play anything: a bundled module that
 * imports `./vidstack-abc.js`, or an HLS playlist that lists `seg-1.ts` below it,
 * resolves those against *its own URL*. Hand it `/raw?url=https://host/a/b.m3u8`
 * and every relative child becomes a request against our API path, which answers
 * 404 for a movie that was streaming fine before we "improved" it.
 */
function viaProxy(url, docOrigin, route, proxyBase) {
  if (!url || /^(data|blob|javascript|about):/i.test(url)) return null;
  if (url.startsWith(route) || url.includes('/api/proxy/')) return null;
  let abs;
  try {
    abs = new URL(url, docOrigin);
  } catch {
    return null;
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
  if (isAdUrl(abs.href)) return null;
  rememberHost(abs.hostname);
  // Absolute, every time. The sanitized document carries `<base href="{upstream}/">`
  // so that the page's own bare-relative fetches resolve upstream, and a root-relative
  // `/api/proxy/…` would be swallowed by that base and asked for on *their* domain.
  if (route === DOC_ROUTE) return `${proxyBase}${DOC_ROUTE}?url=${encodeURIComponent(abs.href)}`;
  const path = abs.pathname.replace(/^\/+/, '');
  return `${proxyBase}${RAW_ROUTE}/${originTag(abs.origin)}/${path}${abs.search}`;
}

/* ──────────────────────────────────────────────────────────────
   GET /api/proxy/providers
   ────────────────────────────────────────────────────────────── */
router.get('/providers', (req, res) => {
  res.json({
    providers: serialize(),
    fallbackOrder: FALLBACK_ORDER,
    allowedHosts: [...ALLOWED_HOSTS],
  });
});

/* ──────────────────────────────────────────────────────────────
   GET /api/proxy/health
   Free embed hosts die and get seized constantly, so rather than
   handing the player a black rectangle we ask the backend — which
   has a real network path and no CORS — whether each upstream is
   actually alive and frameable right now. Cached for 5 minutes.
   ────────────────────────────────────────────────────────────── */
const HEALTH_TTL_MS = 5 * 60 * 1000;
const PROBE_SAMPLE = { tmdbId: 550, type: 'movie' };
let healthCache = null;

async function probeProvider(id) {
  const provider = byId(id);
  const url = buildUpstreamUrl(id, PROBE_SAMPLE);
  if (!url) return { id, ok: false, reason: `${id} has no probeable upstream` };
  const t0 = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 4,
      responseType: 'text',
      validateStatus: () => true,
      headers: {
        'User-Agent': UA,
        Referer: 'http://localhost:5173/',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
    const body = typeof res.data === 'string' ? res.data : '';
    const csp = String(res.headers['content-security-policy'] || '');
    const xfo = String(res.headers['x-frame-options'] || '');
    const ms = Date.now() - t0;
    if (res.status >= 400) return { id, label: provider.label, ok: false, status: res.status, ms, reason: `answered ${res.status}` };
    if (/deny|sameorigin/i.test(xfo)) return { id, label: provider.label, ok: false, status: res.status, ms, reason: `blocks embedding (${xfo})` };
    const ancestors = (csp.match(/frame-ancestors[^;]*/i) || [])[0];
    if (ancestors && !/(\*|localhost)/i.test(ancestors)) {
      return { id, label: provider.label, ok: false, status: res.status, ms, reason: 'blocks embedding (CSP frame-ancestors)' };
    }
    if (body.length < 900) return { id, label: provider.label, ok: false, status: res.status, ms, reason: 'returned an empty shell' };
    return { id, label: provider.label, ok: true, status: res.status, ms, bytes: body.length, reason: null };
  } catch (err) {
    const code = err.code === 'ECONNABORTED' ? 'timed out' : (err.code || 'unreachable');
    return { id, label: provider.label, ok: false, ms: Date.now() - t0, reason: code };
  }
}

router.get('/health', async (req, res) => {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return res.json(healthCache);
  const embedIds = PROVIDERS.filter((p) => p.kind === 'embed').map((p) => p.id);
  const results = await Promise.all(embedIds.map(probeProvider));
  const byIdResult = Object.fromEntries(results.map((r) => [r.id, r]));
  // Mirror each embed verdict onto its AdShield proxy twin.
  for (const p of PROVIDERS) {
    if (p.kind === 'proxy' && byIdResult[p.upstream]) {
      const src = byIdResult[p.upstream];
      byIdResult[p.id] = { ...src, id: p.id, label: p.label };
    }
  }
  const working = FALLBACK_ORDER.filter((id) => byIdResult[id]?.ok);
  healthCache = { at: now, checkedAt: new Date(now).toISOString(), servers: byIdResult, working, order: FALLBACK_ORDER };
  res.json(healthCache);
});

/* ──────────────────────────────────────────────────────────────
   GET /api/proxy/stream?tmdbId&type&season&episode&provider
   Fetches the upstream embed page, strips ad scripts/overlays,
   injects stealth JS + CSS and serves it as a frameable document.
   ────────────────────────────────────────────────────────────── */
router.get('/stream', async (req, res) => {
  const { tmdbId, type = 'movie', season = 1, episode = 1 } = req.query;
  const providerId = req.query.provider || 'vidlink-clean';

  if (!tmdbId) return res.status(400).send('Missing tmdbId');

  const provider = byId(providerId);
  if (!provider || (provider.kind !== 'proxy' && provider.kind !== 'embed')) {
    return res.status(400).send(`Provider "${providerId}" has no proxyable upstream`);
  }

  const targetUrl = buildUpstreamUrl(providerId, { tmdbId, type, season, episode });
  if (!targetUrl || !isAllowedTarget(targetUrl)) {
    return res.status(400).send('Unsupported stream target');
  }

  try {
    const { html, origin } = await sanitizedPage(targetUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The document is cached server-side, so the browser may revalidate cheaply;
    // `no-store` here used to mean every player mount paid the full upstream wait.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-ZenithFlix-Upstream', targetUrl);
    // NOTE: deliberately no X-Frame-Options / CSP frame-ancestors here.
    // The old handler set SAMEORIGIN, which blocked our own player iframe
    // (frontend runs on :5173, backend on :5000).
    res.send(sanitize(html, targetUrl, origin, proxyBaseFor(req)));
  } catch (error) {
    const status = error.response?.status;
    console.error(`[proxy] ${providerId} ${targetUrl} → ${error.message}`);
    res
      .status(502)
      .send(unavailablePage(providerId, targetUrl, status, error.message));
  }
});

/**
 * GET /api/proxy/raw?url=…
 *
 * The asset arm of AdShield. A sanitized page is useless if everything it loads
 * afterwards goes direct: the player's own XHR to its CDN is cross-origin, the
 * CDN sends no CORS headers, the request dies, and the viewer sees a black frame
 * on a page we fetched perfectly. Routing the bytes through us makes the whole
 * document same-origin with itself, which is what the upstream was expecting when
 * it was served from its own domain.
 *
 * Only hosts the sanitizer learned about are fetchable (see DERIVED_HOSTS), so
 * this is not an open proxy — and ad networks are refused on the way in as well.
 */
router.options('/raw/{*rest}', (req, res) => {
  res
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', '*')
    .setHeader('Access-Control-Max-Age', '86400')
    .status(204)
    .end();
});

router.get('/raw/{*rest}', async (req, res) => {
  const segments = [].concat(req.params.rest || []).filter(Boolean);
  const origin = segments.length ? originFromTag(segments.shift()) : null;
  if (!origin) return res.status(400).send('Malformed relay address');
  const query = new URLSearchParams(req.query).toString();
  const target = `${origin}/${segments.join('/')}${query ? `?${query}` : ''}`;
  if (!isAllowedTarget(target)) return res.status(403).send('Not a ZenithFlix stream host');
  let upstream;
  try {
    upstream = await axios.get(target, {
      headers: {
        'User-Agent': UA,
        Referer: origin + '/',
        Origin: origin,
        Accept: req.headers.accept || '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        // Seeking is a Range request, and a relay that drops it turns every
        // progress-bar drag into a full re-download of the file.
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
  } catch (error) {
    const status = error.response?.status;
    res.status(status && status < 500 ? status : 502).send(`Upstream refused: ${error.message}`);
    return;
  }
  const pick = (h) => upstream.headers[h];
  res.status(upstream.status);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', pick('accept-ranges') || 'bytes');
  res.setHeader('Content-Type', pick('content-type') || 'application/octet-stream');
  if (pick('content-length')) res.setHeader('Content-Length', pick('content-length'));
  if (pick('content-range')) res.setHeader('Content-Range', pick('content-range'));
  // Tokenized media URLs go dead in minutes, so nothing in this chain is cacheable
  // by the browser beyond a short private window.
  res.setHeader('Cache-Control', 'private, max-age=120');
  upstream.data.pipe(res);
  upstream.data.on('error', () => res.end());
});

/**
 * GET /api/proxy/doc?url=…
 *
 * Nested documents. An embed page opens an inner frame on a domain we have never
 * seen, and that frame carries the second generation of ad scripts. Pointing the
 * iframe at /raw would hand it over unsanitized, so any frame src gets sent here
 * instead and runs through the same sanitizer — the learning and the cleaning
 * recurse exactly as far as the upstream's own nesting does.
 */
router.get('/doc', async (req, res) => {
  const target = req.query.url;
  if (!target || !isAllowedTarget(target)) return res.status(403).send('Not a ZenithFlix stream host');
  try {
    const { html, origin } = await sanitizedPage(target);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(sanitize(html, target, origin, proxyBaseFor(req)));
  } catch (error) {
    res.status(502).send(unavailablePage('doc', target, error.response?.status, error.message));
  }
});

/**
 * A cleaned embed page is a pure function of its upstream URL, and the upstreams
 * are slow — AutoEmbed alone takes 7–9 s just to serve its HTML. Without a cache
 * every player mount pays that round trip, and the request timeout lands on top of
 * it (which is exactly how the "+ AdShield" twin ended up painting our
 * "server is not responding" page instead of a player). So: cache the fetched
 * document, share one in-flight fetch between concurrent viewers of the same
 * title, and when upstream goes quiet serve the last good copy rather than
 * admitting defeat.
 */
const PAGE_TTL_MS = 5 * 60 * 1000;
const pageCache = new Map(); // targetUrl -> { at, html, origin }
const pageJobs = new Map(); // targetUrl -> Promise<{ html, origin }>

async function fetchUpstreamPage(targetUrl) {
  const upstream = await axios.get(targetUrl, {
    headers: {
      'User-Agent': UA,
      Referer: new URL(targetUrl).origin + '/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
    // These hosts routinely answer in 8–12 s; 15 s made a slow-but-alive server
    // look dead, and the player's watchdog then rerouted away from a working stream.
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  return {
    html: typeof upstream.data === 'string' ? upstream.data : String(upstream.data),
    origin: new URL(targetUrl).origin,
  };
}

function sanitizedPage(targetUrl) {
  const hit = pageCache.get(targetUrl);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return Promise.resolve(hit);

  if (pageJobs.has(targetUrl)) return pageJobs.get(targetUrl);

  const job = fetchUpstreamPage(targetUrl)
    .then((page) => {
      pageCache.set(targetUrl, { ...page, at: Date.now() });
      return page;
    })
    .catch((error) => {
      // Stale beats dead: an embed page from four minutes ago still plays.
      if (hit) {
        console.warn(`[proxy] ${targetUrl} → ${error.message}; serving stale`);
        return hit;
      }
      throw error;
    })
    .finally(() => pageJobs.delete(targetUrl));

  pageJobs.set(targetUrl, job);
  return job;
}

/* ──────────────────────────────────────────────────────────────
   GET /api/proxy/stream/check — reachability probe so the UI can mark
   a known-down server before the user clicks it. Checks the direct
   embed hosts (proxy entries resolve to the same upstream).
   ────────────────────────────────────────────────────────────── */
router.get('/stream/check', async (req, res) => {
  const { tmdbId, type = 'movie', season = 1, episode = 1 } = req.query;
  const ids = (req.query.providers || FALLBACK_ORDER.join(',')).split(',');

  const results = await Promise.all(
    ids.map(async (rawId) => {
      const id = rawId.trim();
      const provider = byId(id);
      if (!provider || provider.kind === 'trailer') return { id, ok: false, reason: 'not an embed server' };

      const url = buildUpstreamUrl(id, { tmdbId, type, season, episode });
      if (!isAllowedTarget(url)) return { id, ok: false, reason: 'blocked target' };

      try {
        const r = await axios.head(url, { headers: { 'User-Agent': UA }, timeout: 8000, maxRedirects: 3 });
        return { id, ok: r.status < 400, status: r.status, url };
      } catch (err) {
        return { id, ok: false, reason: err.message, status: err.response?.status, url };
      }
    })
  );

  res.json({ checked: results, firstOk: results.find((r) => r.ok)?.id || null });
});

/* ──────────────────────────────────────────────────────────────
   HTML sanitizer
   ────────────────────────────────────────────────────────────── */

/**
 * The absolute address of this backend as the browser sees it.
 *
 * Everything the sanitizer rewrites is rooted here, and the sanitized document
 * carries a `<base>` tag pointing at the upstream — so a relative rewrite would
 * silently resolve against *their* domain. Behind a tunnel or a deploy proxy, set
 * PUBLIC_API_BASE to the origin the player actually loads.
 */
function proxyBaseFor(req) {
  return String(process.env.PUBLIC_API_BASE || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function sanitize(html, targetUrl, origin, proxyBase) {
  const $ = cheerio.load(html);

  // 1 · external scripts from ad networks
  $('script[src]').each((_, el) => {
    if (isAdUrl($(el).attr('src'))) $(el).remove();
  });

  // 2 · inline ad loaders and framing tripwires. The domain half matters: a
  //     Metrika loader written as `createElement('script'); s.src="https://mc.yandex…"
  //     has no src attribute for rule 1 to see, so without the domain check it
  //     ships straight to the viewer.
  $('script:not([src])').each((_, el) => {
    if (isAdInline($(el).html() || '')) $(el).remove();
  });

  // 3 · ad iframes only — zero-size or on a known ad domain.
  //
  // This rule used to also delete every iframe with no `src`, on the theory that
  // a src-less frame is an ad container. It is not: AutoEmbed creates its player
  // frame empty and assigns the source a tick later, so we were removing the
  // player and calling the result "server not responding". Same mistake as the
  // inline-script rule above — an ad blocker that blocks the thing you asked it
  // to play is not a feature.
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    const style = $(el).attr('style') || '';
    const looksTiny = /(?:width|height)\s*:\s*(?:0px|1px)/i.test(style);
    if (isAdUrl(src) || looksTiny) $(el).remove();
  });

  // 3b · beacon carriers that are not scripts. A tracking pixel is just an
  //      <img>, and hosts warm the connection with <link rel="preload"> or
  //      prefetch long before any of them run — all three cost a request to the
  //      ad network, so they go too. <noscript> is dropped whole because cheerio
  //      keeps its contents inert, and the only things in it here are pixels.
  $('link[rel="preload"], link[rel="prefetch"], link[rel="dns-prefetch"], link[rel="preconnect"], img').each(
    (_, el) => {
      const url = $(el).attr('href') || $(el).attr('src') || '';
      if (isAdUrl(url)) $(el).remove();
    }
  );
  $('noscript').each((_, el) => {
    const inside = $(el).html() || '';
    if (AD_DOMAINS.some((d) => inside.toLowerCase().includes(d)) || $(el).find('img').length) $(el).remove();
  });

  // 4 · neuter ad links instead of nuking layout
  $('a[href]').each((_, el) => {
    if (isAdUrl($(el).attr('href'))) {
      $(el).removeAttr('href').removeAttr('onclick').removeAttr('target');
    }
  });

  // 5 · common overlay containers, but never the player shell
  try {
    $('[id*="ad-"], [class*="ad-"], [class*="-ad "], [class*="ads-"], [id*="popup"], [class*="popup"], [id*="banner"], [class*="banner"], [class*="sponsor"]').each(
      (_, el) => {
        const blob = `${$(el).attr('id') || ''} ${$(el).attr('class') || ''}`.toLowerCase();
        if (!/(player|video|episode|season|server|controls|subtitle|audio)/.test(blob)) $(el).remove();
      }
    );
  } catch {}

  // 6 · route every sub-resource back through us.
  //     `//host/path` is protocol-relative — a different animal, and prefixing it
  //     with the origin is what produced `https://vidlink.pro//wsrv.nl/?url=…`,
  //     a request that can only 404.
  const absolutize = (raw) => {
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('/')) return `${origin}${raw}`;
    return raw;
  };
  /**
   * Even the upstream's *own* assets go through us, and that is the part that
   * used to break AdShield. A page served from our origin but loading its player
   * straight from `player.autoembed.co` sends `Referer: localhost:5000` and an
   * `Origin` of localhost — which is precisely the fingerprint these hosts check
   * before they hand over a source, and their answer is a 404 on a page that
   * looked perfectly sanitized. Detouring the bytes makes the document look, to
   * its own backend, exactly like the real thing.
   */
  $('[src]').each((_, el) => {
    const raw = $(el).attr('src') || '';
    if (!raw || isAdUrl(raw)) return;
    const abs = absolutize(raw);
    const tag = String(el.tagName || '').toLowerCase();
    const proxied = viaProxy(abs, origin, tag === 'iframe' ? DOC_ROUTE : RAW_ROUTE, proxyBase);
    if (proxied) $(el).attr('src', proxied);
    else if (abs !== raw) $(el).attr('src', abs);
  });
  $('[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith('/')) $(el).attr('href', absolutize(href));
  });

  // 7 · base href keeps bare-relative fetches pointed upstream
  if (!$('base').length) $('head').prepend(`<base href="${origin}/">`);

  // 8 · stealth bootstrap — must be the very first script in <head>
  $('head').prepend(stealthJs(proxyBase, origin));
  $('head').append(STEALTH_CSS);

  return $.html();
}

/**
 * The bootstrap that runs inside every sanitized document.
 *
 * Static rules only cover the HTML we were handed, and the ads that actually
 * reach a viewer are created after load — `document.createElement` plus a timer.
 * So this runs in the page, and it does the two jobs a redactor cannot do from
 * outside:
 *
 *   1. refuse to be the document that opens an ad window, and
 *   2. let the player keep talking to its own backend as though it were still
 *      upstream.
 *
 * (2) is what turns AdShield from a redactor into a proxy. Without it, the
 * request for the inner source carries `Origin: http://localhost:5000` and a
 * referrer we never issued, the host's own anti-leech check fires, and the viewer
 * gets a 404 on a document we had just cleaned perfectly. Everything the page
 * asks for is relayed through /api/proxy/raw, frames through /api/proxy/doc so
 * the next generation of scripts gets sanitized too.
 */
function stealthJs(proxyBase, origin) {
  return `<script>
(function () {
  var BASE = ${JSON.stringify(String(proxyBase))};
  var RAW = BASE + '/api/proxy/raw';
  var DOC = BASE + '/api/proxy/doc';
  var SELF = location.origin;
  var HOME = ${JSON.stringify(String(origin))};
  var UPSTREAM = /(autoembed|vidsrc|smashystream|multiembed|vidlink|vidfast|2embed|wsrv)/i;
  var AD = ['popads','popcash','exoclick','adcash','propellerads','adsterra','clickunder','onclick','hilltopads','juicyads','trafficjunky','googlesyndication','doubleclick','adnetwork','taboola','mgid','mc.yandex','metrika','hotlog','histats'];

  var SHADY = ['cfd','qpon','icu','sbs','top','buzz','beauty','monster','hair','skint','auto','tackles','webcam','play','quest','rest','bond','fit'];

  function isAdUrl(u) {
    if (!u) return false;
    var l = String(u).toLowerCase();
    for (var i = 0; i < AD.length; i++) if (l.indexOf(AD[i]) > -1) return true;
    // The popunder fleets register a fresh domain weekly and none of our providers
    // live on the suffixes they rent, so the suffix is the usable signal.
    try { var h = new URL(l, document.baseURI || location.href).hostname; if (SHADY.indexOf(h.split('.').pop()) > -1) return true; } catch (e) {}
    return false;
  }

  // The page believes it is running on its own domain, because that is what its
  // own scripts check. document.referrer is the last thing that still says
  // localhost, and player backends use it to decide whether to hand over a source.
  try {
    Object.defineProperty(document, 'referrer', { get: function () { return HOME + '/'; }, configurable: true });
  } catch (e) {}

  // Resolve whatever the page asked for against ITS base tag, not ours, then send
  // it back through us keeping the upstream's own path. Returns '' for a refused
  // ad request, and the unmodified string for anything already on us.
  // The path has to survive the trip: a module that imports './x.js' and a
  // playlist that lists 'seg-1.ts' both resolve those against the URL they were
  // served from, so a flattened ?url= form turns every child request into a 404.
  function b64u(s) { try { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (e) { return ''; } }
  function via(u, route) {
    if (!u) return u;
    var s = String(u);
    if (/^(data|blob|javascript|about):/i.test(s)) return s;
    if (s.indexOf('/api/proxy/') > -1) return s;
    var abs;
    try { abs = new URL(s, document.baseURI || location.href); } catch (e) { return s; }
    if (abs.origin === SELF) return s;
    // An ad request is relayed rather than refused here. Refusing it in the page
    // means an XHR that never opened, and player code that retries on a failed
    // send does that in a loop — the enforcement point is the relay, which answers
    // 403 for anything outside the learned host list, so the browser never touches
    // the ad domain and the page just gets an ordinary HTTP error.
    if (route === DOC) return DOC + '?url=' + encodeURIComponent(abs.href);
    var tok = b64u(abs.origin);
    if (!tok) return s;
    return RAW + '/' + tok + '/' + abs.pathname.replace(/^\/+/, '') + abs.search;
  }

  // Block top-frame navigation (the classic tab-napping popup target).
  // The deny-list alone is not enough here: these networks rotate domains
  // weekly, so a URL that is not obviously an ad is not obviously safe either.
  // Inside a sanitized embed there is exactly one legitimate reason to open a
  // window — the player's own PiP/fullscreen helper — and that always points at
  // our upstream, so everything else is refused.
  try {
    var realOpen = window.open;
    window.open = function (u) {
      var s = String(u || '');
      if (isAdUrl(s)) return null;
      if (s && !UPSTREAM.test(s) && !/^(about:blank|blob:|data:)/i.test(s) && s.indexOf(location.origin) !== 0) return null;
      try { return realOpen.apply(window, arguments); } catch (e) { return null; }
    };
  } catch (e) {}

  // A pop-under that already grabbed a window still cannot point it anywhere.
  // Only writes that obviously carry an ad URL are refused — the player bundle
  // is allowed to document.write its own script/iframe tags.
  try {
    var realWrite = document.write.bind(document);
    document.write = function (s) {
      if (isAdUrl(String(s || ''))) return;
      return realWrite.apply(null, arguments);
    };
  } catch (e) {}

  // window.top / parent redirects are how these players escape into an ad tab
  ['assign','replace'].forEach(function (fn) {
    try {
      var orig = window.location[fn].bind(window.location);
      window.location[fn] = function (u) { if (isAdUrl(u)) return; return orig(u); };
    } catch (e) {}
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      var href = (t.getAttribute && t.getAttribute('href')) || '';
      if (isAdUrl(href) || href === '#' || !href) { if (isAdUrl(href)) { e.preventDefault(); e.stopPropagation(); } }
      t = t.parentNode;
    }
  }, true);

  // Kill alert/confirm/prompt overlays
  window.alert = function () {}; window.confirm = function () { return false; }; window.prompt = function () { return null; };

  // The source API is fetched with XHR or fetch, cross-origin, from a document
  // whose real host is us. Left alone, both fail on CORS and the player sits at
  // "Loading" forever on a page we served without a single error.
  try {
    var realFetch = window.fetch;
    if (realFetch) {
      window.fetch = function (input, init) {
        try {
          if (typeof input === 'string') {
            var next = via(input, RAW);
            if (next === '') return Promise.reject(new TypeError('ZenithFlix refused an ad request'));
            return realFetch.call(this, next, init);
          }
        } catch (e) {}
        return realFetch.apply(this, arguments);
      };
    }
  } catch (e) {}
  try {
    if (window.XMLHttpRequest) {
      var realOpen2 = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          if (typeof url === 'string') {
            var next = via(url, RAW);
            if (next === '') return;
            arguments[1] = next;
          }
        } catch (e) {}
        return realOpen2.apply(this, arguments);
      };
    }
  } catch (e) {}

  // Remove ad nodes injected after load, and pull anything the page builds itself
  // back through us — a JS-created player frame is the common case, and left as
  // it is it loads unsanitized, with its own popunder SDK.
  function reroute(el) {
    if (!el || !el.tagName || !el.getAttribute) return;
    var tag = el.tagName.toLowerCase();
    var isHref = tag === 'link';
    if (tag !== 'iframe' && tag !== 'script' && tag !== 'source' && !isHref) return;
    var attr = isHref ? 'href' : 'src';
    var raw = el.getAttribute(attr);
    if (!raw) return;
    var next = via(raw, tag === 'iframe' ? DOC : RAW);
    if (next === '') { el.removeAttribute(attr); if (tag === 'script' || isHref) el.remove && el.remove(); return; }
    if (next !== raw) el.setAttribute(attr, next);
  }
  function purge(node) {
    if (!node || !node.tagName) return;
    var tag = node.tagName.toLowerCase();
    if ((tag === 'img' || tag === 'link') && isAdUrl(node.src || node.href)) { node.remove && node.remove(); return; }
    if (tag === 'iframe') {
      // Only frames that are provably ads: a known ad domain, or a 0/1px frame.
      // "Not on our provider list" is not evidence of an ad — the embed hosts
      // route to dozens of file servers we have never heard of, and deleting
      // those deletes the movie.
      var s = node.src || '';
      var dim = (node.getAttribute('style') || '') + ' ' + (node.width || '') + 'x' + (node.height || '');
      if (isAdUrl(s) || /(?:width|height)\s*:\s*(?:0px|1px)/i.test(dim) || /^(?:0|1)$/.test(String(node.width) + 'x' + String(node.height))) {
        node.remove && node.remove();
        return;
      }
    }
    if (tag === 'div' || tag === 'ins') {
      var cls = (node.className || '') + ' ' + (node.id || '');
      if (/ad-|-ad|ads|popup|overlay|banner|sponsor/i.test(cls) && !/player|video|subtitle/i.test(cls)) {
        node.style && (node.style.setProperty('display', 'none', 'important'));
      }
    }
    reroute(node);
  }
  try {
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'attributes') { reroute(m.target); return; }
        m.addedNodes.forEach(purge);
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
  } catch (e) {}
})();
</script>`;
}

const STEALTH_CSS = `<style>
/* ZenithFlix Ad Shield */
[id*="ad-" i]:not([id*="player"]):not([id*="video"]),
[class*="ad-" i]:not([class*="player"]):not([class*="video"]):not([class*="badge"]),
[class*="popup" i], [class*="banner" i], [class*="sponsor" i],
ins.adsbygoogle, .report-btn {
  display: none !important;
  pointer-events: none !important;
}
html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; color: #fff; }
video { width: 100% !important; max-height: 100vh !important; }
</style>`;

function unavailablePage(providerId, targetUrl, status, message) {
  const safeTarget = String(targetUrl).replace(/[&<>"']/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#07070b;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .box{max-width:34rem;padding:2rem;text-align:center}
  h1{font-size:1.1rem;margin:0 0 .6rem}
  p{color:#64748b;font-size:.85rem;line-height:1.6;margin:.35rem 0;word-break:break-all}
  code{color:#818cf8}.tip{margin-top:1.2rem;font-size:.8rem;color:#94a3b8}
  </style></head><body><div class="box">
  <h1>Server ${providerId} is not responding</h1>
  <p>Upstream status: <code>${status || 'unreachable'}</code></p>
  <p>${String(message).replace(/[&<>"']/g, '')}</p>
  <p>${safeTarget}</p>
  <div class="tip">Pick a different server above — the player switches in one click.</div>
  </div></body></html>`;
}

/* ──────────────────────────────────────────────────────────────
   LEGACY: GET /api/proxy/tmdb — kept so older pages keep working.
   New code should use /api/tmdb/*.
   ────────────────────────────────────────────────────────────── */
router.get('/tmdb', async (req, res) => {
  const { query, type, page, id, media_type, language } = req.query;

  if (!tmdb.keyConfigured()) {
    return res.json({
      results: [
        { id: 27205, title: 'Inception', media_type: 'movie', vote_average: 8.8, release_date: '2010-07-16', poster_path: '/ljsZTbZruTCZG7b1sY3Q4c1cJ8.jpg' },
        { id: 157336, title: 'Interstellar', media_type: 'movie', vote_average: 8.6, release_date: '2014-11-05', poster_path: null },
      ],
      _mock: true,
    });
  }

  try {
    let data;
    if (query) data = await tmdb.search({ query, page, language });
    else if (id && media_type) data = await tmdb.details({ type: media_type, id, language });
    else if (type) data = await tmdb.feed({ name: type, page, language });
    else data = await tmdb.feed({ name: 'trending', page, language });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'TMDB fetch failed', detail: err.message });
  }
});

module.exports = router;
