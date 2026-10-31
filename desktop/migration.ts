import { packFiles } from '../src/core/extensions/packageStorage';

/** Portable structured-clone backup for moving IndexedDB between Chromium and the system WebView. */
export type Migration = {
  format: 'pixprite-browser-storage'; version: 1; id: string;
  localStorage: Record<string, string>;
  databases: { name: string; version: number; stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean;
    indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[]; keys: unknown[]; values: unknown[] }[] }[];
};
export async function exportStorage(): Promise<Migration> {
  const encode = async (value: any): Promise<any> => {
    const binary = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
    if (value instanceof ArrayBuffer) return { $pixprite: 'ArrayBuffer', data: binary(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { $pixprite: value.constructor.name, data: binary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (value instanceof Blob) return { $pixprite: 'Blob', type: value.type, data: binary(new Uint8Array(await value.arrayBuffer())) };
    if (value instanceof Date) return { $pixprite: 'Date', data: value.toISOString() };
    if (Array.isArray(value)) return Promise.all(value.map(encode));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])));
    return value;
  };
  const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const databases: Migration['databases'] = [];
  for (const info of await indexedDB.databases()) {
    if (!info.name?.startsWith('pixprite')) continue;
    const db = await request(indexedDB.open(info.name));
    try {
      const names = [...db.objectStoreNames];
      if (!names.length) { databases.push({ name: db.name, version: db.version, stores: [] }); continue; }
      const tx = db.transaction(names);
      const raw = await Promise.all(names.map(async name => {
        const store = tx.objectStore(name);
        const indexes = [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, keys, values };
      }));
      databases.push({ name: db.name, version: db.version, stores: await encode(raw) });
    } finally { db.close(); }
  }
  return { format: 'pixprite-browser-storage', version: 1, id: crypto.randomUUID(),
    localStorage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('pixprite:') && !key.startsWith('pixprite:running'))), databases };
}
export async function importStorage(dump: Migration) {
  if (dump.format !== 'pixprite-browser-storage' || dump.version !== 1 || typeof dump.id !== 'string' || !Array.isArray(dump.databases)) throw new Error('Invalid Electron storage backup');
  if (localStorage.getItem('pixprite:electron-migration') === dump.id) return;
  const decode = (value: any): any => {
    if (value && typeof value === 'object' && '$pixprite' in value) {
      if (value.$pixprite === 'Date') return new Date(value.data);
      const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
      if (value.$pixprite === 'ArrayBuffer') return bytes.buffer;
      if (value.$pixprite === 'Blob') return new Blob([bytes], { type: value.type });
      const types: Record<string, any> = { Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView };
      const ctor = types[value.$pixprite]; if (!ctor) throw new Error('Unsupported storage binary type'); return new ctor(bytes.buffer);
    }
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
    return value;
  };
  // Refuse merging with an existing destination. Import is idempotent; its source is never deleted.
  for (const db of await indexedDB.databases()) if (db.name?.startsWith('pixprite')) throw new Error('Tauri storage already contains projects. Export them before importing an Electron backup.');
  const imported: string[] = [];
  try {
    for (const entry of dump.databases) {
      if (!entry.name.startsWith('pixprite') || !Number.isSafeInteger(entry.version)) throw new Error('Invalid database in backup');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(entry.name, entry.version);
        open.onupgradeneeded = () => {
          for (const store of entry.stores) {
            const created = open.result.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
            for (const index of store.indexes) created.createIndex(index.name, index.keyPath, index);
          }
        };
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      imported.push(entry.name);
      try {
        if (!entry.stores.length) continue;
        const decoded = await Promise.all(entry.stores.map(async store => Promise.all(store.values.map(async raw => {
          const value = decode(raw);
          return entry.name === 'pixprite-extensions' && store.name === 'installed' ? packFiles(value) : value;
        }))));
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(entry.stores.map(store => store.name), 'readwrite');
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Storage import aborted'));
          for (const [index, store] of entry.stores.entries()) for (let i = 0; i < store.values.length; i++) {
            const target = tx.objectStore(store.name), value = decoded[index][i];
            if (store.keyPath === null) target.put(value, decode(store.keys[i])); else target.put(value);
          }
        });
      } finally { db.close(); }
    }
    for (const [key, value] of Object.entries(dump.localStorage)) if (key.startsWith('pixprite:') && !key.startsWith('pixprite:running') && typeof value === 'string') localStorage.setItem(key, value);
    localStorage.setItem('pixprite:electron-migration', dump.id);
  } catch (error) { for (const name of imported) await new Promise(resolve => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = () => resolve(undefined); }); throw error; }
}
