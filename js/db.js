// IndexedDB storage: everything stays on the phone.
const DB_NAME = 'fairhunter';
const DB_VERSION = 1;
const STORES = ['fairs', 'contacts', 'visits', 'blobs', 'meta'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
          if (s === 'contacts' || s === 'visits') os.createIndex('fairId', 'fairId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    Promise.resolve(fn(os)).then(r => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export async function put(store, obj) { await tx(store, 'readwrite', os => os.put(obj)); return obj; }
export async function get(store, id) { return tx(store, 'readonly', os => wrap(os.get(id))); }
export async function del(store, id) { return tx(store, 'readwrite', os => os.delete(id)); }
export async function all(store) { return tx(store, 'readonly', os => wrap(os.getAll())); }
export async function byFair(store, fairId) {
  return tx(store, 'readonly', os => wrap(os.index('fairId').getAll(fairId)));
}
export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export async function setMeta(key, value) { return put('meta', { key, value }); }

export async function putBlob(blob) {
  const id = uid('blob');
  await put('blobs', { id, blob, type: blob.type, size: blob.size, createdAt: new Date().toISOString() });
  return id;
}
export async function getBlob(id) { const r = await get('blobs', id); return r ? r.blob : null; }

export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
