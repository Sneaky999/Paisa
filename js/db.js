// Thin promise wrapper over IndexedDB, with an in-memory fallback when IndexedDB is unavailable
// (e.g. some private-browsing modes). `persistent` tells the UI whether data will survive a reload.

const DB_NAME = 'paisa';
const DB_VERSION = 1;
export const STORES = ['accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals'];

export let persistent = true;
let dbPromise = null;
let mem = null;

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function useMemory() {
  mem = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  persistent = false;
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available in this browser'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('Database is blocked by another tab'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const txDone = (t) => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('Transaction aborted'));
});

export async function getAll(store) {
  if (mem) return [...mem[store].values()].map(clone);
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function putMany(store, objs) {
  if (!objs.length) return;
  if (mem) { objs.forEach((o) => mem[store].set(o.id, clone(o))); return; }
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  objs.forEach((o) => os.put(o));
  return txDone(t);
}
export const put = (store, obj) => putMany(store, [obj]);

export async function removeMany(store, ids) {
  if (!ids.length) return;
  if (mem) { ids.forEach((id) => mem[store].delete(id)); return; }
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  ids.forEach((id) => os.delete(id));
  return txDone(t);
}
export const remove = (store, id) => removeMany(store, [id]);

/** Atomically replace every store's contents. `data` maps store name -> array. */
export async function replaceAll(data) {
  if (mem) {
    for (const s of STORES) { mem[s].clear(); (data[s] || []).forEach((o) => mem[s].set(o.id, clone(o))); }
    return;
  }
  const db = await open();
  const t = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = t.objectStore(s);
    os.clear();
    (data[s] || []).forEach((o) => os.put(o));
  }
  return txDone(t);
}
