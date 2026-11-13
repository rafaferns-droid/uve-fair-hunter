// Offline cache: the whole app, OCR engine and fair data are stored on the phone.
const VERSION = 'fairhunter-pub-v0.3.0';
const FILES = [
 "./",
 "app.css",
 "data/fairs/index.json",
 "icons/icon-192.png",
 "icons/icon-512.png",
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
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
