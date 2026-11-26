// Wealth Planner service worker — lets the app open without signal.
// The page itself is fetched fresh when online (so updates show up right away)
// and served from the cache when offline. Calls to Apps Script are never cached.
// Money Tracker shares this github.io address and its cache storage, so only touch caches named "wealth-planner-…".
var CACHE = 'wealth-planner-v9';
var SHELL = ['./', './index.html', './manifest.json', './css/app.css', './js/lock.js', './js/core.js', './js/lockscreen.js', './js/grouping.js', './js/holdings.js', './js/portfolio.js', './js/brokers.js', './js/settings.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) {
    return Promise.all(SHELL.map(function(u) { return c.add(u).catch(function(){}); }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k){ return k.indexOf('wealth-planner-') === 0 && k !== CACHE; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;                                  // API calls are POST
  var url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  if (req.mode === 'navigate' || url.origin === location.origin) {
    // network first, cache fallback
    e.respondWith(fetch(req).then(function(res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function() {
      return caches.match(req, { cacheName: CACHE }).then(function(hit) { return hit || caches.match('./index.html', { cacheName: CACHE }); });
    }));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE }).then(function(hit) { return hit || fetch(req); }));
});
