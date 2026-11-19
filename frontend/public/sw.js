/**
 * ZenithFlix Service Worker — Ad domain blocker
 * Blocks requests to known ad/tracker networks originating from our own pages.
 * Cross-origin iframe internal requests cannot be intercepted (browser security).
 */

const AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'adservice.google.co',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'partner.googleadservices.com',
  'amazon-adsystem.com',
  'ads.pubmatic.com',
  'secure.adnxs.com',
  'ib.adnxs.com',
  'rubiconproject.com',
  'openx.net',
  'servenobid.com',
  'adsrvr.org',
  'advertising.com',
  'adtech.de',
  'yieldmanager.com',
  'atdmt.com',
  'casalemedia.com',
  'contextweb.com',
  'bidswitch.net',
  'media.net',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'sharethrough.com',
  'connatix.com',
  'spotxchange.com',
  'springserve.com',
  'aniview.com',
  'adlightning.com',
  'freewheel.tv',
  'smartadserver.com',
  'pubmatic.com',
  'appnexus.com',
  'criteo.com',
  'criteo.net',
  'moatads.com',
  'ad.gt',
  'adnow.com',
  'popcash.net',
  'popads.net',
  'propellerads.com',
  'traffic.js',
  'adf.ly',
  'linkvertise.com',
  'go2ads.link',
  'clksite.com',
  'exoclick.com',
  'juicyads.com',
  'traffic-media.co',
  'adsterra.com',
  'pushcrew.com',
  'onesignal.com',
];

const isAdDomain = (url) => {
  try {
    const host = new URL(url).hostname;
    return AD_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
};

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (isAdDomain(e.request.url)) {
    // Return empty 200 response — silently drops the ad request
    e.respondWith(new Response('', { status: 200 }));
    return;
  }
  // Everything else: normal network
  e.respondWith(fetch(e.request));
});
