import { beforeEach, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { exportStorage, importStorage, type Migration } from './migration';
function storage() {
  const value: Record<string, any> = {};
  Object.defineProperties(value, {
    getItem: { value(key: string) { return value[key] ?? null; } },
    setItem: { value(key: string, item: string) { value[key] = String(item); } },
    removeItem: { value(key: string) { delete value[key]; } },
  });
  return value as Storage;
}
beforeEach(() => { Object.assign(globalThis, { indexedDB: new IDBFactory(), localStorage: storage() }); });
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
test('a portable backup preserves binary resources, blobs, indices, keys and preferences', async () => {
  const open = indexedDB.open('pixprite', 8);
  open.onupgradeneeded = () => {
    open.result.createObjectStore('resources');
    open.result.createObjectStore('meta', { keyPath: 'id' }).createIndex('name', 'name');
  };
  const db = await request(open), tx = db.transaction(['resources', 'meta'], 'readwrite');
  await Promise.all([
    request(tx.objectStore('resources').put({ pixels: new Uint8ClampedArray([1, 2, 128, 255]), buffer: new Uint16Array([500]).buffer, blob: new Blob(['preview'], { type: 'image/png' }) }, 'resource-1')),
    request(tx.objectStore('meta').put({ id: 'doc-1', name: 'Sprite', created: new Date('2026-01-01') })),
  ]);
  db.close(); localStorage.setItem('pixprite:theme', 'light'); localStorage.setItem('pixprite:running', '1'); localStorage.setItem('unrelated', 'secret');
  const dump: Migration = JSON.parse(JSON.stringify(await exportStorage()));
  Object.assign(globalThis, { indexedDB: new IDBFactory(), localStorage: storage() });
  await importStorage(dump); await importStorage(dump); // retry after a native acknowledgement was interrupted
  const restored = await request(indexedDB.open('pixprite'));
  try {
    const resources = await request(restored.transaction('resources').objectStore('resources').get('resource-1'));
    expect(resources.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect([...resources.pixels]).toEqual([1, 2, 128, 255]);
    expect([...new Uint16Array(resources.buffer)]).toEqual([500]);
    expect(await resources.blob.text()).toBe('preview');
    const meta = await request(restored.transaction('meta').objectStore('meta').index('name').get('Sprite'));
    expect(meta.created).toEqual(new Date('2026-01-01'));
    expect(localStorage.getItem('pixprite:theme')).toBe('light');
    expect(localStorage.getItem('pixprite:running')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBeNull();
  } finally { restored.close(); }
});
test('migration never overwrites an existing editor database', async () => {
  const db = await request(indexedDB.open('pixprite')); db.close();
  await expect(importStorage({ format: 'pixprite-browser-storage', version: 1, id: 'migration', localStorage: {}, databases: [] })).rejects.toThrow('already contains');
  expect((await indexedDB.databases()).map(db => db.name)).toEqual(['pixprite']);
});
test('failed imports roll back newly created databases', async () => {
  await expect(importStorage({ format: 'pixprite-browser-storage', version: 1, id: 'migration', localStorage: {}, databases: [
    { name: 'pixprite', version: 1, stores: [{ name: 'resources', keyPath: null, autoIncrement: false, indexes: [], keys: ['one'], values: [{ $pixprite: 'Unknown', data: '' }] }] },
  ] })).rejects.toThrow('Unsupported');
  expect(await indexedDB.databases()).toEqual([]);
});
test('legacy extension Blob files import as portable package bytes for WebKit', async () => {
  const open = indexedDB.open('pixprite-extensions');
  open.onupgradeneeded = () => open.result.createObjectStore('installed', { keyPath: 'id' });
  const db = await request(open);
  const icons = new Blob(['{}'], { type: 'application/json' });
  await request(db.transaction('installed', 'readwrite').objectStore('installed').put({ id: 'legacy-icons', files: { 'icons.json': icons } }));
  db.close(); const dump = JSON.parse(JSON.stringify(await exportStorage()));
  Object.assign(globalThis, { indexedDB: new IDBFactory(), localStorage: storage() });
  await importStorage(dump);
  const restored = await request(indexedDB.open('pixprite-extensions'));
  try {
    const installed = await request(restored.transaction('installed').objectStore('installed').get('legacy-icons'));
    expect(installed.files['icons.json'].bytes).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(installed.files['icons.json'].bytes)).toBe('{}');
    expect(installed.files['icons.json'].type).toBe(icons.type);
  } finally { restored.close(); }
});
