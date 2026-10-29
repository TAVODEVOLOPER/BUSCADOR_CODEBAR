importScripts('config.js');
const VERSION = 'cablescan-' + self.CABLE_CONFIG.version;   // sale de config.js: una sola cifra que cambiar
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'stats.js', 'config.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png',
  'fonts/b612-latin-400-normal.woff2', 'fonts/b612-latin-700-normal.woff2',
  'fonts/b612-mono-latin-400-normal.woff2', 'fonts/b612-mono-latin-700-normal.woff2',
  'vendor/xlsx.full.min.js', 'vendor/zxing.min.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isData = new URL(req.url).pathname.endsWith('/data.json');
  if (isData) {
    // datos: red primero, caché si no hay conexión
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('data.json', c)); return r; })
      .catch(() => caches.match('data.json')));
    return;
  }
  // resto: caché primero y se refresca en segundo plano
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; }).catch(() => hit);
    return hit || net;
  }));
});
