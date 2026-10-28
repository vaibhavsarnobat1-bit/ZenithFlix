/**
 * Player source registry — the single source of truth for every stream URL.
 *
 * `kind: 'trailer'` → built from TMDB's YouTube trailer list. Availability,
 *                      embedding permission and rights depend on the uploader.
 * `kind: 'embed'`   → third-party iframe player, framed directly.
 * `kind: 'proxy'`   → same upstream, fetched by /api/proxy/stream and stripped
 *                      of ad scripts before it reaches the iframe.
 *
 * URLs live in `patterns` (string templates) so the browser can interpolate the
 * exact same shape the server uses — no duplicated templates, no drift.
 */

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

/** Substitute {tmdbId} {season} {episode} placeholders. */
function interpolate(pattern, args) {
  return pattern
    .replace(/\{tmdbId\}/g, String(args.tmdbId))
    .replace(/\{season\}/g, String(args.season || 1))
    .replace(/\{episode\}/g, String(args.episode || 1));
}

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

  P('zxc-hindi', '⚡ Server: Hindi Dub (Official)', {
    kind: 'embed',
    blurb: 'Dedicated Multi-Language server with direct Hindi Dub priority (?dubLang=hi, ta, te).',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
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
    sandboxOk: true,
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
    sandboxOk: true,
    patterns: {
      movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te',
      tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te',
    },
  }),

  // Line-up below was widened from the curated `tmdb-embed-providers` package
  // (npm/GitHub) and every host was then probed from this machine on 2026-10-23
  // with `node backend/scripts/probe-providers.js` and driven in a real browser.
  // Dropped along the way: player.autoembed.cc (DNS gone), vidsrc.cc + vidsrc.to
  // (timeout), multiembed.mov + moviesapi.to + nontongo.win (X-Frame-Options:
  // SAMEORIGIN — can never be framed), embed.smashystream.com (dead; the
  // player.smashystream.com mirror is alive and is what ships now).
  //
  // `tier` is the advertised ceiling: 3 = 4K, 2 = 1080p, 1 = 720p.
  // No iframe provider has a verified audio-track API connected.
  // VidLink displayed "Please Disable Sandbox" in a live browser, so its
  // sandbox flag is off. Other existing sandbox flags are unchanged.

  P('vidlink', 'Server 1 · VidLink', {
    kind: 'embed',
    blurb: 'Lean player, least overlay chrome — starts fastest here.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: {
      movie: 'https://vidlink.pro/movie/{tmdbId}',
      tv: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}',
    },
  }),

  P('vidlink-clean', 'Server 1 · VidLink + AdShield', {
    kind: 'proxy',
    upstream: 'vidlink',
    blurb: 'AdShield: we fetch VidLink and strip its ad SDKs, and every asset it loads afterwards relays through us. VidLink still opens its player over a WebSocket that can see our origin, so this can stall where the direct server plays.',
    quality: 'up to 1080p',
    tier: 2,
  }),

  P('vidsrcpm', 'Server 2 · VidSrc.pm', {
    kind: 'embed',
    blurb: 'Full HTML5 player: subtitles, auto next-episode.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://vidsrc.pm/embed/movie/{tmdbId}',
      tv: 'https://vidsrc.pm/embed/tv/{tmdbId}/{season}/{episode}',
    },
  }),

  P('vidsrcpm-clean', 'Server 2 · VidSrc.pm + AdShield', {
    kind: 'proxy',
    upstream: 'vidsrcpm',
    subs: true,
    blurb: 'AdShield: VidSrc.pm ships a plain HTML player rather than a WebSocket app, so it is the best candidate for cleaning — its ad scripts come out and its remaining assets relay through us.',
    quality: 'up to 1080p',
    tier: 2,
  }),

  P('2embed', 'Server 3 · 2Embed', {
    kind: 'embed',
    blurb: 'Has its own internal server picker — good last resort.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: true,
    patterns: {
      movie: 'https://www.2embed.cc/embed/{tmdbId}',
      tv: 'https://www.2embed.cc/embedtv/{tmdbId}?s={season}&e={episode}',
    },
  }),

  P('2embed-clean', 'Server 3 · 2Embed + AdShield', {
    kind: 'proxy',
    upstream: '2embed',
    blurb: 'AdShield: 2Embed creates its player frame empty and fills it from script, so the relay re-routes that assignment too and the inner page gets cleaned as well.',
    quality: 'up to 1080p',
    tier: 2,
  }),

  P('2embedskin', 'Server 4 · 2Embed Mirror', {
    kind: 'embed',
    blurb: 'Same fleet on a second domain — use when 2Embed rate-limits.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: true,
    patterns: {
      movie: 'https://www.2embed.skin/embed/{tmdbId}',
      tv: 'https://www.2embed.skin/embedtv/{tmdbId}?s={season}&e={episode}',
    },
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

  P('autoembed-clean', 'Server 5 · AutoEmbed + AdShield', {
    kind: 'proxy',
    upstream: 'autoembed',
    blurb: 'AdShield: we clean AutoEmbed and the player page it opens, so the ads on both are stripped. AutoEmbed then gates its source behind a bot check, which a proxied page often fails — if it sits idle, pick a source inside the frame.',
    quality: 'up to 1080p',
    tier: 2,
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

  // Last because its own upstream API answers "(500) something went wrong" more
  // often than the rest — probed on 2026-10-23 against both a 1999 title and a
  // current Spider-Man, and it errored on both while every other host played.
  // It is still the only one advertising 4K, so it stays in the fleet.
  P('vidfast', 'Server 7 · VidFast', {
    kind: 'embed',
    blurb: 'Only 4K advertiser we have — but the flakiest source API too.',
    quality: 'up to 4K',
    tier: 3,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://vidfast.pro/movie/{tmdbId}?autoPlay=true',
      tv: 'https://vidfast.pro/tv/{tmdbId}/{season}/{episode}?autoPlay=true',
    },
  }),

  // Two more hosts, probed from this machine on 2026-10-24 with
  // `node backend/scripts/probe-providers.js` (alive, framable, no
  // X-Frame-Options/CSP frame-ancestors). Everything else that list surfaced is
  // dead from here: vidsrc.to and vidsrc.cc time out, vidsrcinhis.top /
  // vidsrc.best / flixer.ai / vidlink.sbs have no DNS at all, widestream.io
  // answers 521, nontongo.win and moviesapi.to send SAMEORIGIN so they can never
  // be framed, and frembed.icu / vidsrc.wtf fail their TLS handshake.
  //
  // Videasy is the engine VidSrc.pm itself wraps. Its page's
  // "select_language" label refers to subtitle language, not audio tracks.
  P('videasy', 'Server 8 · Videasy', {
    kind: 'embed',
    blurb: 'The engine behind VidSrc.pm on its own domain. Its menu picks subtitle language and source — a second route to a print.',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://player.videasy.net/movie/{tmdbId}',
      tv: 'https://player.videasy.net/tv/{tmdbId}/{season}/{episode}',
    },
  }),

  P('vidfastvc', 'Server 9 · VidFast Mirror', {
    kind: 'embed',
    blurb: 'VidFast on its second domain — same 4K fleet, used when vidfast.pro rate-limits.',
    quality: 'up to 4K',
    tier: 3,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://vidfast.vc/movie/{tmdbId}?autoPlay=true',
      tv: 'https://vidfast.vc/tv/{tmdbId}/{season}/{episode}?autoPlay=true',
    },
  }),
];

const byId = (id) => PROVIDERS.find((p) => p.id === id);

/** Order the watchdog walks when a server refuses to start. */
const FALLBACK_ORDER = ['vidlink', 'vidsrcpm', '2embed', '2embedskin', 'autoembed', 'smashy', 'vidfast', 'videasy', 'vidfastvc'];

/** Embed servers only — used for host allowlisting and reachability probes. */
const EMBED_IDS = PROVIDERS.filter((p) => p.kind === 'embed').map((p) => p.id);

/**
 * Upstream URL for a provider. Proxy entries resolve through their `upstream`,
 * so each host's URL shape is declared exactly once.
 * Audio language requests are ignored without a verified audio-track API.
 */
function buildUpstreamUrl(providerId, args) {
  const provider = byId(providerId);
  if (!provider) return null;
  const source = provider.kind === 'proxy' ? byId(provider.upstream) : provider;
  if (!source?.patterns) return null;
  const key = args.type === 'tv' ? 'tv' : 'movie';
  return interpolate(source.patterns[key], args);
}

/**
 * Resolve what the <iframe> should load.
 * Returns { ok:false, reason } instead of throwing, so the player can show a
 * per-server explanation rather than a blank black box.
 */
function resolve(providerId, args) {
  const provider = byId(providerId);
  if (!provider) return { ok: false, reason: `Unknown server "${providerId}"` };

  if (provider.kind === 'trailer') {
    if (!args.youtubeKey) return { ok: false, reason: 'No official trailer on TMDB for this title' };
    // YouTube throws "Error 153" when enablejsapi is on but the embedding
    // origin cannot be resolved, so pass it through when the caller knows it.
    const origin = args.origin ? `&origin=${encodeURIComponent(args.origin)}` : '';
    return {
      ok: true,
      kind: 'trailer',
      provider,
      url: `https://www.youtube-nocookie.com/embed/${args.youtubeKey}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origin}`,
    };
  }

  if (provider.kind === 'proxy') {
    const qs = new URLSearchParams({ provider: provider.id, tmdbId: String(args.tmdbId), type: args.type || 'movie' });
    if (args.type === 'tv') {
      qs.set('season', String(args.season || 1));
      qs.set('episode', String(args.episode || 1));
    }
    return { ok: true, kind: 'proxy', provider, url: `${args.origin || ''}/api/proxy/stream?${qs.toString()}` };
  }

  if (provider.kind === 'hls') {
    const key = args.type === 'tv' ? 'tv' : 'movie';
    const url = provider.patterns?.[key] || provider.patterns?.movie || args.customHlsUrl;
    return { ok: true, kind: 'hls', provider, url };
  }

  return { ok: true, kind: 'embed', provider, url: buildUpstreamUrl(provider.id, args) };
}

/** JSON shape served at GET /api/proxy/providers (browser interpolates it). */
function serialize() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    upstream: p.upstream || null,
    blurb: p.blurb,
    audio: [],
    quality: p.quality,
    tier: p.tier || 1,
    subs: Boolean(p.subs),
    langParam: null,
    sandboxOk: Boolean(p.sandboxOk),
    ownAudioMenu: false,
    audioControl: {
      status: 'unsupported',
      canSelect: false,
      reason: 'No verified audio-track API is connected for this iframe provider.',
    },
    patterns: p.patterns || null,
  }));
}

module.exports = {
  PROVIDERS,
  byId,
  resolve,
  buildUpstreamUrl,
  interpolate,
  serialize,
  FALLBACK_ORDER,
  EMBED_IDS,
};
