/**
 * The extensions database: installed packages and the per-extension key-value storage.
 * Kept apart from the projects database so wiping one never touches the other.
 */

const DB = 'pixprite-extensions';
export const INSTALLED = 'installed';
export const STORAGE = 'storage';

let db: Promise<IDBDatabase> | null = null;

function open() {
  return db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(INSTALLED)) d.createObjectStore(INSTALLED, { keyPath: 'id' });
      // Keys are `<extension id>\n<key>`, so one extension's keys are a contiguous range
      if (!d.objectStoreNames.contains(STORAGE)) d.createObjectStore(STORAGE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { db = null; reject(req.error); };
  });
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Runs one request against `store` */
export async function idb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await open();
  return done(fn(d.transaction(store, mode).objectStore(store)));
}
