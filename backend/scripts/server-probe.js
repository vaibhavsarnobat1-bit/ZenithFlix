/**
 * Which embed hosts actually have a stream for a given title?
 *
 * A 200 from these hosts means nothing on its own — every one of them answers
 * 200 for a title it does not have and renders "no sources" client-side, which
 * is exactly the black rectangle the viewer blames the app for. So this probe
 * scores the *body* of each response for evidence of a player, and prints a
 * table per title so the fleet order can be set from observation instead of
 * guesswork.
 *
 *   node scripts/server-probe.js [tmdbId ...]
 */
const axios = require('axios');
const { PROVIDERS } = require('../lib/providers');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Strings that only appear once a source has actually been resolved. */
const SIGNALS = [
  ['hls', /\.m3u8/i],
  ['mp4', /\.mp4(\?|["'])/i],
  ['video-tag', /<video[\s>]/i],
  ['player-js', /(jwplayer|hls\.js|video\.js|plyr|dashjs|clappr)/i],
  ['source-api', /(\/api\/(venus|mercury|server|sources|movie)|getSources|sources\.json)/i],
];

/** Strings that mean the host is telling us it has nothing. */
const NEGATIVES = [
  ['not-found', /(not found|no sources|no result|404|unavailable)/i],
  ['challenge', /(cloudflare|just a moment|verify you are|access denied|captcha)/i],
];

async function probe(url) {
  const at = Date.now();
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/', Accept: '*/*' },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    const body = typeof r.data === 'string' ? r.data : String(r.data ?? '');
    const lower = body.toLowerCase();
    const hits = SIGNALS.filter(([, re]) => re.test(body)).map(([n]) => n);
    const bad = NEGATIVES.filter(([, re]) => re.test(body)).map(([n]) => n);
    // Scripts are what paint these pages, so a tiny body with a big inline
    // bundle is still a live player — record the size and let the reader judge.
    const inlineBytes = [...body.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].reduce(
      (n, m) => n + m[1].length,
      0
    );
    return {
      status: r.status,
      ms: Date.now() - at,
      bytes: body.length,
      inlineBytes,
      hits,
      bad,
      verdict: bad.length ? 'blocked' : hits.length ? 'player-evidence' : 'shell-only',
      title: (lower.match(/<title[^>]*>([^<]{0,70})/i) || [, ''])[1].trim(),
    };
  } catch (e) {
    return { status: 0, ms: Date.now() - at, bytes: 0, inlineBytes: 0, hits: [], bad: ['fetch-error'], verdict: `error: ${e.code || e.message}`.slice(0, 40), title: '' };
  }
}

async function main() {
  const ids = process.argv.slice(2);
  const titles = ids.length ? ids : ['969681', '157098', '533535'];
  const embeds = PROVIDERS.filter((p) => p.kind === 'embed');

  for (const id of titles) {
    console.log(`\n══════ movie ${id} ══════`);
    const rows = await Promise.all(
      embeds.map(async (p) => {
        const url = p.patterns.movie.replace('{tmdbId}', id);
        return { id: p.id, label: p.label, tier: p.tier, url, ...(await probe(url)) };
      })
    );
    for (const r of rows) {
      console.log(
        `${r.id.padEnd(13)} ${String(r.status).padEnd(4)} ${(r.ms + 'ms').padEnd(9)} ${String(r.bytes).padStart(7)}b inline=${String(r.inlineBytes).padStart(6)} ${r.verdict.padEnd(15)} [${r.hits.join(',')}] ${r.bad.length ? 'X:' + r.bad.join(',') : ''}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
