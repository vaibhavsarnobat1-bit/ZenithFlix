/**
 * ZenithFlix Service Worker — Ad-Shield VPN Network Filter
 * Intercepts & blocks requests to known ad, popup, betting, and tracking networks
 * across all browsers without requiring any user extension.
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
  'hilltopads.com',
  'clickadu.com',
  'monetag.com',
  'richads.com',
  'evadav.com',
  'ad-maven.com',
  'admaven.com',
  'popunder.net',
  'zeroredirect.com',
  'trafficfactory.biz',
  'trafficjunky.com',
  'onclickbright.com',
  'onclickalgo.com',
  'galaksion.com',
  'mondiad.com',
  'yllix.com',
  'bidvertiser.com',
  'infolinks.com',
  'adcash.com',
  'bet365.com',
  '1xbet.com',
  'parimatch.com',
  'mostbet.com',
  'melbet.com',
  'stake.com',
  'dafabet.com',
  '1win.pro',
  '1win.com',
  'pin-up.bet'
];

const isAdDomain = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
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
