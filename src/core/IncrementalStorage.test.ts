import 'fake-indexeddb/auto';
import { afterEach, expect, mock, test } from 'bun:test';
mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const storage = await import('./Projects');
const { Sprite } = await import('./Sprite');
const { IncrementalDocument } = await import('./IncrementalDocument');
const { prepareDocument } = await import('./BackgroundDocument');
const { createCelInstance, createImage, transformCel } = await import('./DocumentModel');

const ids = new Set<string>();
const id = () => { const value = crypto.randomUUID(); ids.add(value); return value; };
const pixels = (value: number) => btoa(String.fromCharCode(...new Uint8Array(new Uint32Array([value]).buffer)));
const document = (value: number, name = 'Incremental') => ({
  format: 'pixprite', version: 5, width: 1, height: 1, name, frames: [{ duration: 100 }, { duration: 120 }],
  images: [{ id: 'migrated-image-1', w: 1, h: 1, d: pixels(value) }],
  ext: { vendor: { literal: { $resource: 'extension-owned-value' } } },
  layers: [{ name: 'Layer', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'migrated-image-1' } }, { link: 0 }] }],
});
const meta = (value: string, thumb = 'preview') => ({ id: value, name: 'Incremental', width: 1, height: 1, frames: 2, layers: 1, colorMode: 'rgb', created: 1, updated: 1, thumb });
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('pixprite'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function records(store: string) {
  const db = await database();
  try { return await new Promise<any[]>((resolve, reject) => { const req = db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  finally { db.close(); }
}
async function put(store: string, key: string, value: unknown) {
  const db = await database();
  try {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
}
async function writes(work: () => Promise<unknown>) {
  const counts: Record<string, number> = {}, original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    counts[this.name] = (counts[this.name] ?? 0) + 1;
    return original.apply(this, args);
  };
  try { await work(); return counts; } finally { IDBObjectStore.prototype.put = original; }
}
afterEach(async () => {
  for (const value of ids) { await storage.deleteProject(value); await storage.deleteSession(value); await storage.deleteSnapshots(value); }
  ids.clear();
});

test('metadata and preview writes reuse immutable pixels across frames, sessions and independent documents, without ID collisions', async () => {
  const a = id(), b = id(), c = id(), session = id();
  const first = await writes(() => storage.saveProjectData(meta(a), document(0xff000001)));
  expect(first.resources).toBe(1);
  expect((await records('data'))[0]).toMatchObject({ storage: 'pixprite-resources-v1' });
  expect(JSON.stringify((await records('data'))[0])).not.toContain(pixels(0xff000001));
  expect((await records('meta'))[0].thumb).toBeUndefined();
  const metadata = await writes(() => storage.saveProjectData(meta(a), { ...document(0xff000001), info: { author: 'New metadata' } }));
  expect(metadata.resources ?? 0).toBe(0);
  expect(metadata.previews ?? 0).toBe(0);
  const preview = await writes(() => storage.saveProjectData(meta(a, 'new preview'), { ...document(0xff000001), name: 'Renamed' }));
  expect(preview.resources ?? 0).toBe(0);
  expect((await storage.getProjectMeta(a))?.thumb).toBe('new preview');
  const reuse = await writes(async () => {
    await storage.saveProjectData(meta(b), document(0xff000001));
    await storage.saveSessionRecord(session, { head: { projectId: b, name: 'Working' }, data: document(0xff000001), editor: null });
  });
  expect(reuse.resources ?? 0).toBe(0);
  const changed = await writes(() => storage.saveProjectData(meta(c), document(0xff000002)));
  expect(changed.resources).toBe(1);
  expect(await storage.loadProjectData(a)).toEqual({ ...document(0xff000001), name: 'Renamed' });
  expect(await storage.loadProjectData(b)).toEqual(document(0xff000001));
  expect(await storage.loadProjectData(c)).toEqual(document(0xff000002));
  expect((await storage.loadSession(session))?.data).toEqual(document(0xff000001));
});

test('resource abort rolls back manifest, resources, preview, recovery pointers and editor atomically', async () => {
  const owner = id();
  await storage.saveProjectData(meta(owner), document(0xff010001), { zoom: 1 });
  const stores = ['data', 'resources', 'meta', 'previews', 'lastGoodData', 'lastGoodMeta', 'state', 'revisions'];
  const before = await Promise.all(stores.map(records));
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    const req = original.apply(this, args);
    if (this.name === 'resources') queueMicrotask(() => this.transaction.abort());
    return req;
  };
  try { await expect(storage.saveProjectData(meta(owner, 'changed'), document(0xff010002), { zoom: 2 })).rejects.toBeDefined(); }
  finally { IDBObjectStore.prototype.put = original; }
  expect(await Promise.all(stores.map(records))).toEqual(before);
  await storage.saveProjectData(meta(owner, 'changed'), document(0xff010002), { zoom: 2 });
  expect(await storage.loadProjectData(owner)).toEqual(document(0xff010002));
  expect((await storage.loadLastGoodProject(owner))?.data).toEqual(document(0xff010001));
});

test('collection retains current, last-good, session recovery and snapshots, and removes only unreachable pixels', async () => {
  const owner = id(), session = id(), snapshotOwner = id();
  const a = document(0xff020001), b = document(0xff020002), c = document(0xff020003), orphan = document(0xff020004);
  await storage.saveProjectData(meta(owner), orphan);
  await storage.saveProjectData(meta(owner), a);
  await storage.saveProjectData(meta(owner), b);
  await storage.saveSnapshot({ owner: snapshotOwner, name: 'Snapshot', width: 1, height: 1, frames: 2, thumb: 'snapshot' }, orphan);
  await storage.saveSessionRecord(session, { data: c, editor: null });
  await storage.saveSessionRecord(session, { data: b, editor: null });
  await storage.collectUnusedResources();
  expect(await storage.loadProjectData(owner)).toEqual(b);
  expect((await storage.loadLastGoodProject(owner))?.data).toEqual(a);
  expect((await storage.loadLastGoodSession(session))?.data).toEqual(c);
  const snapshot = (await storage.listSnapshots(snapshotOwner))[0];
  expect(await storage.loadSnapshot(snapshot.id)).toEqual(orphan);
  await storage.deleteSnapshots(snapshotOwner);
  expect((await records('resources')).some(resource => resource.payload === pixels(0xff020004))).toBe(false);
  await storage.deleteProject(owner);
  expect((await storage.loadSession(session))?.data).toEqual(b);
  expect((await storage.loadLastGoodSession(session))?.data).toEqual(c);
  await storage.deleteSession(session);
  expect((await records('resources')).some(resource => [1, 2, 3].some(n => resource.payload === pixels(0xff020000 + n)))).toBe(false);
});

test('inline records migrate only on write and a valid-looking corrupted resource is isolated from recovery and other documents', async () => {
  const a = id(), b = id();
  await storage.saveProjectData(meta(a), document(0xff030001));
  const legacy = { format: 'pixprite', version: 4, width: 1, height: 1, name: 'Old inline', frames: [{ duration: 100 }], layers: [{ name: 'Layer', cels: [{ x: 0, y: 0, w: 1, h: 1, d: pixels(0xff030002) }] }] };
  await put('data', a, legacy);
  expect(await storage.loadProjectData(a)).toEqual(legacy);
  expect((await records('data'))[0]).toEqual(legacy);
  await storage.saveProjectData(meta(a), document(0xff030003));
  expect((await storage.loadLastGoodProject(a))?.data).toEqual(legacy);
  await storage.saveProjectData(meta(b), document(0xff030004));
  const knownKey = (await import('./DocumentResources')).splitDocument;
  const targetBundle = await knownKey(document(0xff030003));
  const key = (targetBundle.manifest as any).document.images[0].d.$resource;
  await put('resources', key, { shape: 'image:1:1', payload: pixels(0xff030099) });
  await expect(storage.loadProjectData(a)).rejects.toThrow('Damaged document resource');
  expect((await storage.loadLastGoodProject(a))?.data).toEqual(legacy);
  expect(await storage.loadProjectData(b)).toEqual(document(0xff030004));
});

test('capture dirty resources skip encoding clean images and previews while detecting direct legacy writes and linked transforms', async () => {
  const sprite = new Sprite(2, 1), cache = new IncrementalDocument();
  const source = createImage(2, 1, new Uint32Array([0xff000001, 0xff000002]));
  const first = createCelInstance(source);
  sprite.frames = [{ duration: 100 }, { duration: 100 }, { duration: 100 }];
  sprite.layers[0].cels = [first, first, transformCel(first, { flipX: true, opacity: 0.5 })];
  sprite.layers[0].celOpacity = [1, 1, 1];
  const initial = cache.capture(sprite, false);
  expect(initial.dirtyResources).toBe(1);
  const prepared = await prepareDocument(initial.raw);
  initial.accept(prepared.data, '');
  sprite.name = 'Metadata only'; sprite.info = { author: 'Changed' };
  const clean = cache.capture(sprite, false);
  expect(clean.dirtyResources).toBe(0);
  expect(typeof clean.raw.images[0].d).toBe('string');
  expect((await prepareDocument(clean.raw)).data).toEqual(sprite.toJSON());
  first.data[0] = 0xffaabbcc;
  const edited = cache.capture(sprite, false);
  expect(edited.dirtyResources).toBe(1);
  expect(edited.raw.images).toHaveLength(2); // transformed instance retains the original shared source
  expect(sprite.layers[0].cels[0]).toBe(sprite.layers[0].cels[1]);
  expect((await prepareDocument(edited.raw)).data).toEqual(sprite.toJSON());
  expect(source.data).toEqual(new Uint32Array([0xff000001, 0xff000002]));
  const legacy = { x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([0xff112233]) };
  sprite.layers[0].cels[2] = legacy;
  const old = cache.capture(sprite, false), result = await prepareDocument(old.raw); old.accept(result.data, '');
  legacy.data[0] = 0xff445566;
  const changed = cache.capture(sprite, false);
  expect(changed.dirtyResources).toBe(1);
  expect((await prepareDocument(changed.raw)).data).toEqual(sprite.toJSON());
});

test('different image dimensions have separate content keys even for identical pixel bytes', async () => {
  const a = id(), b = id(), payload = btoa(String.fromCharCode(...new Uint8Array(new Uint32Array([0xff040001, 0xff040002]).buffer)));
  const wide = { ...document(0), width: 2, images: [{ id: 'same-id', w: 2, h: 1, d: payload }], layers: [{ name: 'Layer', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'same-id' } }, { link: 0 }] }] };
  const tall = { ...wide, width: 1, height: 2, images: [{ id: 'same-id', w: 1, h: 2, d: payload }] };
  await storage.saveProjectData({ ...meta(a), width: 2 }, wide);
  const count = await writes(() => storage.saveProjectData({ ...meta(b), height: 2 }, tall));
  expect(count.resources).toBe(1);
  expect(await storage.loadProjectData(a)).toEqual(wide);
  expect(await storage.loadProjectData(b)).toEqual(tall);
});

test('missing resource in an old record without bytes does not hide healthy project or snapshot listings', async () => {
  const broken = id(), healthy = id();
  await storage.saveProjectData(meta(broken), document(0xff050001));
  await storage.saveProjectData(meta(healthy), document(0xff050002));
  const snapshotMeta = { owner: broken, name: 'Broken snapshot', width: 1, height: 1, frames: 2, thumb: '' };
  await storage.saveSnapshot(snapshotMeta, document(0xff050001));
  const snapshot = (await storage.listSnapshots(broken))[0];
  const db = await database();
  try {
    const tx = db.transaction(['meta', 'snapshots', 'resources', 'data'], 'readwrite');
    const project = tx.objectStore('meta').get(broken), snap = tx.objectStore('snapshots').get(snapshot.id), data = tx.objectStore('data').get(broken);
    project.onsuccess = () => { const { bytes: _, ...record } = project.result; tx.objectStore('meta').put(record); };
    snap.onsuccess = () => { const { bytes: _, ...record } = snap.result; tx.objectStore('snapshots').put(record); };
    data.onsuccess = () => tx.objectStore('resources').delete(data.result.resources[0]);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
  const projects = await storage.listProjects();
  expect(projects.some(project => project.id === healthy && project.bytes! > 0)).toBe(true);
  expect(projects.find(project => project.id === broken)?.bytes).toBeUndefined();
  expect((await storage.listSnapshots(broken))[0].id).toBe(snapshot.id);
  expect((await storage.listSnapshots(broken))[0].bytes).toBeUndefined();
});

test('worker failure during hydration of the previous manifest aborts a save visibly and retains all pointers', async () => {
  const owner = id();
  await storage.saveProjectData(meta(owner), document(0xff060001));
  const original = globalThis.Worker, { compute } = await import('./compute'), { BackgroundWorkerError } = await import('./BackgroundTask');
  class FailureWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string; preventDefault(): void }) => void;
    terminate() {}
    postMessage(message: any) {
      if (message.op === 'hydrateStorageDocument') queueMicrotask(() => this.onerror?.({ message: 'hydrate runtime failed', preventDefault() {} }));
      else void compute(message.op, structuredClone(message.args), () => {}).then(result => this.onmessage?.({ data: { type: 'done', result } }));
    }
  }
  globalThis.Worker = FailureWorker as unknown as typeof Worker;
  try { await expect(storage.saveProjectData(meta(owner), document(0xff060002))).rejects.toBeInstanceOf(BackgroundWorkerError); }
  finally { globalThis.Worker = original; }
  expect(await storage.loadProjectData(owner)).toEqual(document(0xff060001));
  expect((await storage.loadLastGoodProject(owner))?.data).toEqual(document(0xff060001));
});

test('metadata-only preview capture reuses its thumbnail and mutable tile buffers dirty independently', async () => {
  const sprite = new Sprite(1, 1), cache = new IncrementalDocument();
  sprite.layers[0].cels[0] = createCelInstance(createImage(1, 1, new Uint32Array([0xff070001])));
  const first = cache.capture(sprite, true), prepared = await prepareDocument(first.raw);
  expect(first.preview).toBe(true);
  first.accept(prepared.data, 'cached-preview');
  sprite.name = 'Metadata'; sprite.info = { author: 'Changed' };
  const metadata = cache.capture(sprite, true);
  expect(metadata.preview).toBe(false);
  expect(metadata.dirtyResources).toBe(0);
  expect(metadata.accept((await prepareDocument(metadata.raw)).data, '')).toBe('cached-preview');
  sprite.tilesets = [{ name: 'Tiles', tw: 1, th: 1, baseIndex: 1, tiles: [new Uint32Array([0xff070002])] }];
  sprite.layers[0].tileset = 0;
  sprite.layers[0].cels[0]!.tiles = { cols: 1, rows: 1, refs: new Uint32Array([0]) };
  const tiles = cache.capture(sprite, false), encoded = await prepareDocument(tiles.raw); tiles.accept(encoded.data, '');
  const clean = cache.capture(sprite, false);
  expect(clean.dirtyResources).toBe(0);
  expect(typeof clean.raw.tilesets[0].d).toBe('string');
  sprite.tilesets[0].tiles[0][0] = 0xff070003;
  const changed = cache.capture(sprite, false);
  expect(changed.dirtyResources).toBe(1);
  expect((await prepareDocument(changed.raw)).data).toEqual(sprite.toJSON());
  expect(sprite.tilesets[0].tiles[0].byteLength).toBe(4);
});


test('collection conservatively retains actual image pointers when a manifest resource inventory is incomplete', async () => {
  const owner = id();
  await storage.saveProjectData(meta(owner), document(0xff080001));
  await storage.saveProjectData(meta(owner), document(0xff080002));
  const db = await database();
  let original: any;
  try {
    const tx = db.transaction('data', 'readwrite'), store = tx.objectStore('data'), req = store.get(owner);
    req.onsuccess = () => { original = req.result; store.put({ ...original, resources: [] }, owner); };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
  await storage.collectUnusedResources();
  expect((await records('resources')).some(resource => resource.payload === pixels(0xff080002))).toBe(true);
  await expect(storage.loadProjectData(owner)).rejects.toThrow('Invalid document resource reference');
  // Restoring the inventory still recovers the pixels, even after collection ran.
  await put('data', owner, original);
  expect(await storage.loadProjectData(owner)).toEqual(document(0xff080002));
  expect((await storage.loadLastGoodProject(owner))?.data).toEqual(document(0xff080001));
});
