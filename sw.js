// Offline cache: the whole app, OCR engine and fair data are stored on the phone.
const VERSION = 'fairhunter-pub-v0.4.0';
const FILES = [
 "./",
 "app.css",
 "data/fairs/index.json",
 "fairhunter/app/app.css",
 "fairhunter/app/js/app.js",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/uve-logo.svg",
 "index.html",
 "js/ai.js",
 "js/app.js",
 "js/db.js",
 "js/export.js",
 "js/ocr.js",
 "js/parse.js",
 "js/voice.js",
 "manifest.webmanifest",
 "vendor/tesseract/LICENSE.md",
 "vendor/tesseract/core/tesseract-core-lstm.wasm.js",
 "vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
 "vendor/tesseract/lang/deu.traineddata.gz",
 "vendor/tesseract/lang/eng.traineddata.gz",
 "vendor/tesseract/lang/spa.traineddata.gz",
 "vendor/tesseract/tesseract.min.js",
 "vendor/tesseract/worker.min.js"
];
// Montserrat (UVE font) comes from jsDelivr and is kept offline too; if it fails the app falls back to system fonts
const FONTS = [600, 700, 800].map(w => `https://cdn.jsdelivr.net/npm/@fontsource/montserrat@5.0.19/files/montserrat-latin-${w}-normal.woff2`);
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))).then(() => Promise.allSettled(FONTS.map(u => c.add(new Request(u, { mode: 'cors' })))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.startsWith('https://cdn.jsdelivr.net/npm/@fontsource/'))) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
