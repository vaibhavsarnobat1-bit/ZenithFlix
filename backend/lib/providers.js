/**
 * Player source registry — the single source of truth for every stream URL.
 *
 * `kind: 'trailer'` → built from TMDB's YouTube trailer list. Availability,
 *                      embedding permission and rights depend on the uploader.
 * `kind: 'embed'`   → third-party iframe player, framed directly.
 * `kind: 'proxy'`   → same upstream, fetched by /api/proxy/stream and stripped
 *                      of ad scripts before it reaches the iframe. No registry
 *                      entry ships as a proxy any more: the strip needs an
 *                      always-on host, so the server bar is embeds only. The
 *                      route stays for local experimentation.
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

  P('autoembed-multi', '🔥 AutoEmbed · Multi-Audio (Nitro)', {
    kind: 'embed',
    blurb: 'AutoEmbed Multi-Language player with in-player Audio menu (Hindi, Tamil, Telugu, Malayalam, Kannada), Nitro server & 1080p quality selector.',
    quality: '1080p',
    tier: 1,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}',
    },
  }),

  P('autoembed-hindi', '⚡ AutoEmbed · Hindi Dub (Official)', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Hindi Dub server stream (?lang=hindi).',
    quality: '1080p',
    tier: 1,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=hindi&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=hindi&autoplay=true',
    },
  }),

  P('autoembed-tamil', '⚡ AutoEmbed · Tamil Dub', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Tamil Dub server stream (?lang=tamil).',
    quality: '1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=tamil&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=tamil&autoplay=true',
    },
  }),

  P('autoembed-telugu', '⚡ AutoEmbed · Telugu Dub', {
    kind: 'embed',
    blurb: 'AutoEmbed direct Telugu Dub server stream (?lang=telugu).',
    quality: '1080p',
    tier: 2,
    subs: true,
    sandboxOk: true,
    patterns: {
      movie: 'https://nxsha.space/embed/movie/{tmdbId}?lang=telugu&autoplay=true',
      tv: 'https://nxsha.space/embed/tv/{tmdbId}/{season}/{episode}?lang=telugu&autoplay=true',
    },
  }),

  P('zxc-hindi', '⚡ Server: Hindi Dub (Official)', {
    kind: 'embed',
    blurb: 'Dedicated Multi-Language server with direct Hindi Dub priority (?dubLang=hi, ta, te).',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    // Proven in a live browser: inside a sandboxed frame it paints its own
    // "Sandbox Not Supported" wall instead of a player, so it must be framed
    // uncaged — which costs us the pop-up guard on this host. No server here
    // is ad-free; the dub simply has no caged alternative that carries it.
    sandboxOk: false,
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
    sandboxOk: false,
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
    sandboxOk: false,
    patterns: {
      movie: 'https://zxcstream.cc/player/movie/{tmdbId}?dubLang=te',
      tv: 'https://zxcstream.cc/player/tv/{tmdbId}/{season}/{episode}?dubLang=te',
    },
  }),
  P('embed-su-hindi', '🎬 Server: Hindi Dub · Embed.su', {
    kind: 'embed',
    blurb: 'Fast embed host with a subtitle/language menu; requests Hindi audio first (?dub_lang=hi).',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: {
      movie: 'https://embed.su/embed/movie/{tmdbId}?dub_lang=hi',
      tv: 'https://embed.su/embed/tv/{tmdbId}/{season}/{episode}?dub_lang=hi',
    },
  }),
  P('moviebox-hindi', '🎬 Server: Hindi Dub · MovieBox', {
    kind: 'embed',
    blurb: 'Lean multi-language player; requests Hindi audio first (?dub_lang=hi).',
    quality: 'up to 1080p',
    tier: 2,
    subs: true,
    sandboxOk: false,
    patterns: {
      movie: 'https://movie-box.live/embed/movie/{tmdbId}?dub_lang=hi',
      tv: 'https://movie-box.live/embed/tv/{tmdbId}/{season}/{episode}?dub_lang=hi',
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
  //
  // `sandboxOk: false` means the host detects our pop-up cage and refuses to
  // play inside it, so it is framed uncaged and its ads fall to the browser.
  // Measured from this machine on 2026-11-01 by fetching every movie template
  // and reading its own HTML: 2Embed and its mirror ship a literal
  // "Sandbox not allowed — remove sandbox from the iframe to play" overlay with
  // an `isReallySandboxed()` probe, and VidLink, ZXCStream (Hindi/Tamil/Telugu)
  // were each seen painting the same wall in a live browser. VidSrc.pm,
  // AutoEmbed, Smashy, VidFast (both domains) and Videasy carry no such check.

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

  P('2embed', 'Server 3 · 2Embed', {
    kind: 'embed',
    blurb: 'Has its own internal server picker — good last resort.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: false,
    patterns: {
      movie: 'https://www.2embed.cc/embed/{tmdbId}',
      tv: 'https://www.2embed.cc/embedtv/{tmdbId}?s={season}&e={episode}',
    },
  }),

  P('2embedskin', 'Server 4 · 2Embed Mirror', {
    kind: 'embed',
    blurb: 'Same fleet on a second domain — use when 2Embed rate-limits.',
    quality: 'up to 1080p',
    tier: 2,
    sandboxOk: false,
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

/**
 * Order the watchdog walks when a server refuses to start.
 * Cage-tolerant hosts lead: with the pop-up guard on, a host that sulks inside
 * a sandbox wastes the whole startup budget before the watchdog moves on.
 */
const FALLBACK_ORDER = ['autoembed-multi', 'autoembed-hindi', 'zxc-hindi', 'vidsrcpm', 'autoembed-tamil', 'autoembed-telugu', 'videasy', 'autoembed', 'vidlink', 'smashy', '2embed', '2embedskin', 'vidfast', 'vidfastvc'];

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
