const version = 'optical-signal-v5';
const assets = ['./', './index.html', './style.css?v=5', './app.js?v=5', './morse.mjs', './receiver.mjs?v=5', './light-detector.mjs', './decoder.mjs', './morse-speed.mjs', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('optical-signal-') && key !== version).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(version).then(cache => cache.match('./index.html'))));
  } else if (assets.some(asset => new URL(asset, self.registration.scope).href === url.href)) {
    event.respondWith(caches.open(version).then(cache => cache.match(event.request)).then(hit => hit || fetch(event.request)));
  }
});
