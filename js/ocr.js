// Business-card reading on the phone with Tesseract (files bundled in /vendor, works offline).
let workerP = null;

function base() { return new URL('.', document.baseURI).href; }

export function warmUp(langs = 'eng+deu+spa') {
  if (workerP) return workerP;
  workerP = (async () => {
    const T = window.Tesseract;
    if (!T) throw new Error('ocr_not_loaded');
    const b = base();
    // Optional: language files published under another extension (e.g. inside a claude.ai artifact).
    const ext = document.querySelector('meta[name="fh-lang-ext"]');
    let langList = langs.split('+');
    if (ext) {
      langList = await Promise.all(langList.map(async code => {
        const r = await fetch(b + 'vendor/tesseract/lang/' + code + ext.content);
        if (!r.ok) throw new Error('lang_' + code);
        return { code, data: new Uint8Array(await r.arrayBuffer()) };
      }));
    }
    return T.createWorker(langList, 1, {
      workerPath: b + 'vendor/tesseract/worker.min.js',
      corePath: b + 'vendor/tesseract/core/',
      langPath: b + 'vendor/tesseract/lang/',
      cacheMethod: 'none',
      workerBlobURL: false
    });
  })();
  workerP.catch(() => { workerP = null; });
  return workerP;
}

// Shrink big photos: faster and usually more accurate.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const max = 1800;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.25)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function readCard(file, onProgress) {
  const w = await warmUp();
  onProgress && onProgress('Leyendo la tarjeta…');
  const img = await prepare(file);
  const { data } = await w.recognize(img, {}, { blocks: true, text: true });
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push({ text: l.text, bbox: l.bbox, conf: l.confidence });
  if (!lines.length && data.text) data.text.split('\n').forEach(t => lines.push({ text: t, bbox: null }));
  return { lines, text: data.text };
}
