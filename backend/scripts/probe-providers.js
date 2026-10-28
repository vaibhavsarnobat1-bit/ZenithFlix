/**
 * Throwaway diagnostic: which embed hosts are actually alive, framable and
 * dub-aware from this machine, right now.
 *
 *   node backend/scripts/probe-providers.js
 *
 * The candidate list is seeded from the curated `tmdb-embed-providers` package
 * (github.com search: "tmdb-embed-providers") plus the Indian/regional hosts we
 * care about, so new domains get considered instead of trusting our own memory.
 * Nothing here ships — the surviving rows get copied into lib/providers.js by
 * hand, because "200 with no XFO" is necessary but not sufficient: a host still
 * has to render a player that starts (see the sandbox column).
 */
const https = require('https');
const dns = require('dns');

// [label, movie URL, does it take a lang= dub parameter?]
const CANDIDATES = [
  ['vidlink.pro', 'https://vidlink.pro/movie/550', 'hi'],
  ['vidfast.pro', 'https://vidfast.pro/movie/550?autoPlay=true', 'hi'],
  ['vidfast.vc', 'https://vidfast.vc/movie/550', 'hi'],
  ['vidsrc.pm', 'https://vidsrc.pm/embed/movie/550', 'hi'],
  ['2embed.cc', 'https://www.2embed.cc/embed/550', null],
  ['2embed.skin', 'https://www.2embed.skin/embed/550', null],
  ['vidsrc.to', 'https://vidsrc.to/embed/movie/550', null],
  ['vidsrc.cc', 'https://vidsrc.cc/v2/embed/movie/550', 'hi'],
  ['nontongo.win', 'https://www.nontongo.win/embed/movie/550', 'hi'],
  ['autoembed.co', 'https://player.autoembed.co/embed/movie/550', 'hi'],
  ['autoembed.co site', 'https://autoembed.co/movie/tmdb/550', null],
  ['moviesapi.to', 'https://moviesapi.to/movie/550', null],
  ['smashystream', 'https://player.smashystream.com/playere.php?tmdb=550', null],
  ['frembed.icu', 'https://frembed.icu/api/film.php?id=550', null],
  ['vidsrc.wtf', 'https://vidsrc.wtf/embed/movie/550', null],
  ['vidsrcww.io', 'https://vidsrcww.io/embed/movie/550', null],
  ['vidsrc.in', 'https://vidsrc.in/embed/movie?tmdb=550&language=en', null],
  ['vidsrc.best', 'https://vidsrc.best/embed/movie/550', null],
  ['vidlink.sbs', 'https://vidlink.sbs/movie/550', 'hi'],
  ['vidsrcinhis.top', 'https://vidsrcinhis.top/embed/movie/550', null],
  ['embedu', 'https://embedu.com/embed/movie/550', null],
  ['flixer.ai', 'https://embed.flixer.ai/movie/550', null],
  ['vidify.top', 'https://vidify.top/embed/movie/550', null],
  ['vidsrc-embed.ru', 'https://vidsrc-embed.ru/embed/movie/550', null],
  ['superembed', 'https://2.superembed.stream/embed/movie/550', null],
  ['rabbitstream', 'https://rabbitstream.net/v3/embed-4.php?id=550', null],
  // Second sweep, 2026-10-24: the viewer asked specifically for servers that can
  // switch AUDIO, so these are the hosts whose own players expose a language
  // menu — the vidsrc family (videasy is what vidsrc.pm wraps), plus the
  // Hindi-labelled ones that turn up in the same GitHub lists.
  ['videasy.net', 'https://player.videasy.net/movie/550?lang=hi', 'hi'],
  ['vidsrc.xyz', 'https://vidsrc.xyz/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.pro', 'https://vidsrc.pro/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.dev', 'https://vidsrc.dev/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc12.pro', 'https://vidsrc12.pro/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc-embed.ru', 'https://vidsrc-embed.ru/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.vip', 'https://vidsrc.vip/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc123.ru', 'https://vidsrc123.ru/embed/movie/550?lang=hi', 'hi'],
  ['widestream.io', 'https://widestream.io/watch/movie/550?lang=hi', 'hi'],
  ['luluvdo.com', 'https://luluvdo.com/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.mov', 'https://vidsrc.mov/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.sbs', 'https://vidsrc.sbs/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.chat', 'https://vidsrc.chat/embed/movie/550?lang=hi', 'hi'],
  ['vidsrc.best hi', 'https://vidsrc.best/embed/movie/550?lang=hi', 'hi'],
  ['2embed hindi', 'https://www.2embed.cc/embedhi/tt0114744', 'hi'],
  ['vidsrcinhis hi', 'https://vidsrcinhis.top/embed/movie/550?lang=hi', 'hi'],
  ['autoembed hi', 'https://player.autoembed.co/embed/movie/550?lang=hi', 'hi'],
];

function probe(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      u,
      {
        timeout: 9000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Referer: 'http://localhost:5173/',
          Accept: 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 400000) req.destroy();
        });
        res.on('end', () => {
          const csp = res.headers['content-security-policy'] || '';
          const loc = res.headers.location;
          if (loc && depth < 3 && res.statusCode >= 300 && res.statusCode < 400) {
            return probe(new URL(loc, u).href, depth + 1).then((r) => resolve({ ...r, redirectedTo: new URL(loc, u).href }));
          }
          resolve({
            status: res.statusCode,
            bytes: body.length,
            xfo: res.headers['x-frame-options'] || '-',
            cspFrame: /frame-ancestors/i.test(csp) ? (csp.match(/frame-ancestors[^;]*/i) || [''])[0].slice(0, 28) : '-',
            // player markup present, or a JS shell that fetches it later
            hasSources: /sources|<video|file:|hls|m3u8|jwplayer|vid_source/i.test(body),
            // hosts that refuse to run inside a sandboxed frame
            sandboxSniff: /disable sandbox|sandbox/i.test(body),
            langHint: /available_lang|languages|dub|multi-?lang/i.test(body),
          });
        });
      }
    );
    const fail = (s) => resolve({ status: s, bytes: 0, xfo: '-', cspFrame: '-', hasSources: false, sandboxSniff: false, langHint: false });
    req.on('error', (e) => fail('ERR ' + e.code));
    req.on('timeout', () => {
      req.destroy();
      fail('TIMEOUT');
    });
  });
}

(async () => {
  for (const [label, url, lang] of CANDIDATES) {
    const host = new URL(url).hostname;
    const dnsOk = await new Promise((res) => dns.lookup(host, (e) => res(!e)));
    if (!dnsOk) {
      console.log(label.padEnd(18), 'DNS FAIL');
      continue;
    }
    const r = await probe(url);
    const framable = r.status === 200 && r.xfo === '-' && !/deny|sameorigin/i.test(r.cspFrame);
    const bits = [framable && 'FRAMABLE', r.hasSources && 'player', r.langHint && 'lang-aware', r.sandboxSniff && 'sandbox-sniffs']
      .filter(Boolean)
      .join(' ');
    console.log(
      label.padEnd(18),
      String(r.status).padEnd(9),
      (r.bytes + 'b').padEnd(9),
      'XFO:' + String(r.xfo).padEnd(11),
      'csp:' + String(r.cspFrame).padEnd(29),
      lang ? 'lang=' + lang : 'lang:-   ',
      bits
    );
  }
  process.exit(0);
})();
