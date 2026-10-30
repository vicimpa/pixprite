import { afterEach, expect, mock, test } from 'bun:test';
import { installSoftwareCanvas } from './Canvas.test-helper';
import { newLayer } from './SpriteModel';
import { compute, transferables, type OpName, type Ops } from './compute';
import { runTask, Cancelled, BackgroundWorkerError } from './BackgroundTask';
import { encodeAseprite, decodeAseprite } from './formats/Aseprite';
import { hydrateCapture } from './BackgroundDocument';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite, createImage, createCelInstance } = await import('./Sprite');
const OriginalWorker = globalThis.Worker;
const workers: TestWorker[] = [];
let pause: (() => Promise<void>) | undefined;
let runtimeFailure = false;

/** Real structured-clone boundaries and the actual worker computation; no DOM/editor imports. */
class TestWorker {
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string; preventDefault(): void }) => void;
  onmessageerror?: () => void;
  terminated = false;
  posted?: { op: OpName; args: Ops[OpName]['args'] };
  constructor() { workers.push(this); }
  terminate() { this.terminated = true; }
  postMessage(message: { op: OpName; args: Ops[OpName]['args'] }, transfer?: Transferable[]) {
    expect(transfer).toBeUndefined(); // Editable buffers must be copied, never transferred.
    const copy = this.posted = structuredClone(message);
    void (async () => {
      await pause?.();
      if (this.terminated) return;
      if (runtimeFailure) return this.onerror?.({ message: 'worker module defect', preventDefault() {} });
      try {
        const result = await compute(copy.op, copy.args, () => {});
        if (!this.terminated) this.onmessage?.({ data: { type: 'done', result: structuredClone(result, { transfer: transferables(result) }) } });
      } catch (error) {
        if (!this.terminated) this.onmessage?.({ data: { type: 'error', message: (error as Error).message } });
      }
    })();
  }
}
function workerMode() { globalThis.Worker = TestWorker as unknown as typeof Worker; }
afterEach(() => { globalThis.Worker = OriginalWorker; workers.length = 0; pause = undefined; runtimeFailure = false; });

function fixture() {
  const doc = new Sprite(2, 2);
  doc.name = 'background';
  doc.frames = [{ duration: 80, ext: { absentPlugin: { frame: true } } }, { duration: 140 }];
  const image = createImage(2, 1, new Uint32Array([0xff010203, 0x80050607]), 'shared');
  const cel = createCelInstance(image, { x: -1, y: 1, flipX: true, opacity: .5, ext: { absentPlugin: ['cel', 1] } });
  doc.layers[0].cels = [cel, cel];
  doc.layers[0].celOpacity = [1, .75];
  doc.layers[0].effects = [{ id: 'fx', type: 'opacity', enabled: true, amount: .7 }];
  doc.ext = { absentPlugin: { nested: [null, false, 'ёж'] } };
  doc.orphanLocks = { owner: 'absentPlugin', frames: { create: true } };
  return doc;
}

test('async v6 encoding equals sync JSON, preserves IDs/aliases/extensions, and captures before live edits', async () => {
  workerMode();
  let release!: () => void;
  pause = () => new Promise<void>(resolve => { release = resolve; });
  const doc = fixture();
  const expected = JSON.parse(JSON.stringify(doc));
  const source = doc.layers[0].cels[0]!.data;
  const raw = doc.captureDocument();
  const pending = runTask('prepareDocument', { raw });
  expect(workers[0].posted?.op).toBe('prepareDocument');
  expect((workers[0].posted!.args as Ops['prepareDocument']['args']).raw.images[0].d).toBeInstanceOf(Uint32Array);
  doc.name = 'edited'; doc.width = 4; source[0] = 0xffffffff;
  doc.ext.absentPlugin = 'new metadata';
  expect(source.byteLength).toBe(8);
  release();
  const result = await pending;
  expect(result.data).toEqual(expected);
  expect(result.bytes).toBe(new TextEncoder().encode(JSON.stringify(expected)).byteLength);
  expect(result.data.images).toHaveLength(1);
  expect(result.data.layers[0].cels[1]).toEqual({ link: 0 });
  expect(workers[0].terminated).toBe(true);
});

test('async decoding migrates v3/v4 identically and commits only a completely validated model', async () => {
  workerMode();
  for (const version of [3, 4]) {
    const pixels = btoa(String.fromCharCode(1, 2, 3, 255));
    const data = { format: 'pixprite', version, name: 'old', width: 1, height: 1, frames: [{ duration: 100 }, { duration: 100 }],
      layers: [{ name: 'old', cels: [version === 3 ? pixels : { x: -2, y: 4, w: 1, h: 1, d: pixels, ext: { missing: { value: 42 } } }, { link: 0 }] }], ext: { missing: [true, 'value'] } };
    const sync = new Sprite(2, 2); sync.load(data);
    const async = new Sprite(3, 3); await async.loadAsync(JSON.stringify(data));
    expect(async.toJSON()).toEqual(sync.toJSON());
    expect(async.layers[0].cels[0]).toBe(async.layers[0].cels[1]);
    const before = async.toJSON();
    await expect(async.loadAsync({ ...data, version: 999 })).rejects.toThrow('Newer pixprite');
    expect(async.toJSON()).toEqual(before);
    await expect(async.loadAsync({ ...data, layers: [{ name: 'broken', cels: [{ link: 1 }, null] }] })).rejects.toThrow('linked cel');
    expect(async.toJSON()).toEqual(before);
  }
});

test('worker reads v5 live FX into v6, preserves v6 baked scopes and rejects v7 before replacing pixels/history', async () => {
  workerMode(); installSoftwareCanvas();
  const legacy = fixture().toJSON(); legacy.version = 5;
  const sync = new Sprite(); sync.load(legacy);
  const doc = new Sprite(); await doc.loadAsync(legacy);
  expect(doc.toJSON()).toEqual(sync.toJSON());
  expect(doc.toJSON().version).toBe(7);
  doc.bakeLayerEffects('frame');
  const baked = doc.toJSON(), history = doc.history.slice();
  expect(baked.layers[0].bakedEffects).toEqual([['fx'], []]);
  const restored = new Sprite(); await restored.loadAsync(baked);
  expect(restored.toJSON()).toEqual(baked);
  await expect(doc.loadAsync({ ...baked, version: 8 })).rejects.toThrow('Newer pixprite version: 8; supported up to 7');
  expect(doc.toJSON()).toEqual(baked); expect(doc.history).toEqual(history);
});

test('async decode keeps shared resources distinct from continuous aliases and rejects malformed pixel/tile payloads', async () => {
  workerMode();
  const doc = fixture();
  const source = doc.layers[0].cels[0]!;
  doc.layers[0].cels[1] = createCelInstance((source as ReturnType<typeof createCelInstance>).image, { x: 4, y: 2 });
  const data = doc.toJSON(), result = new Sprite(1, 1);
  await result.loadAsync(data);
  const first = result.layers[0].cels[0] as ReturnType<typeof createCelInstance>;
  const second = result.layers[0].cels[1] as ReturnType<typeof createCelInstance>;
  expect(first).not.toBe(second); expect(first.image).toBe(second.image);
  const before = result.toJSON();
  const bad = structuredClone(data); bad.images[0].d = '!!!!!!!!!!!!';
  await expect(result.loadAsync(bad)).rejects.toThrow();
  expect(result.toJSON()).toEqual(before);
  const tile = structuredClone(data);
  tile.layers[0].cels[0].t = 'AQAAAA=='; tile.layers[0].cels[0].tc = 2; tile.layers[0].cels[0].tr = 1;
  await expect(result.loadAsync(tile)).rejects.toThrow('buffer length');
});

test('project export bakes transforms and effects and compresses in worker without changing source pixels', async () => {
  workerMode();
  const doc = fixture(), before = doc.toJSON(), raw = doc.captureDocument();
  const result = await runTask('projectFile', { raw, format: 'aseprite', palette: [] });
  const expected = await decodeAseprite(await encodeAseprite(doc.toDocument()));
  expect(await decodeAseprite(new Uint8Array(await result.arrayBuffer()))).toEqual(expected);
  expect(doc.toJSON()).toEqual(before);
  const file = await runTask('projectFile', { raw, format: 'pixprite', palette: [] });
  expect(JSON.parse(await file.text())).toEqual(before);
  const hydrated = hydrateCapture(raw);
  expect(hydrated.layers[0].cels[0]).toBe(hydrated.layers[0].cels[1]);
});

test('cancellation terminates in-flight preparation, preserves editable buffers, and leaves decode target unchanged', async () => {
  workerMode();
  pause = () => new Promise(() => {});
  const doc = fixture(), before = doc.toJSON(), ctrl = new AbortController();
  const pending = doc.loadAsync(before, { signal: ctrl.signal });
  ctrl.abort();
  await expect(pending).rejects.toBeInstanceOf(Cancelled);
  expect(workers[0].terminated).toBe(true);
  expect(doc.toJSON()).toEqual(before);
  expect(doc.layers[0].cels[0]!.data.byteLength).toBe(8);
  await expect(runTask('prepareDocument', { raw: doc.captureDocument() }, { signal: ctrl.signal })).rejects.toBeInstanceOf(Cancelled);
  expect(workers).toHaveLength(1);
});

test('worker runtime defects reject visibly instead of silently retrying on the main thread', async () => {
  workerMode(); runtimeFailure = true;
  await expect(runTask('prepareDocument', { raw: fixture().captureDocument() })).rejects.toBeInstanceOf(BackgroundWorkerError);
  expect(workers).toHaveLength(1);
  runtimeFailure = false;
  await expect(runTask('prepareDocument', { raw: fixture().captureDocument() })).resolves.toHaveProperty('data');
  expect(workers).toHaveLength(2);
});

test('unsupported Worker uses the same capture/decoder pipeline and still honors cancellation before commit', async () => {
  globalThis.Worker = undefined as unknown as typeof Worker;
  const doc = fixture(), expected = doc.toJSON();
  const result = await runTask('prepareDocument', { raw: doc.captureDocument() });
  expect(result.data).toEqual(expected);
  const loaded = new Sprite(1, 1); await loaded.loadAsync(result.data);
  expect(loaded.toJSON()).toEqual(expected);
  const before = loaded.toJSON(), controller = new AbortController();
  const pending = loaded.loadAsync(result.data, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toBeInstanceOf(Cancelled);
  expect(loaded.toJSON()).toEqual(before);
});

test('raw tile buffers are encoded off-thread and preserve tile links, flags, user data and capture isolation', async () => {
  workerMode();
  const doc = new Sprite(2, 2);
  doc.frames = [{ duration: 100 }, { duration: 150 }];
  const pixels = new Uint32Array([0xff123456]);
  const refs = new Uint32Array([1, 0, 0, 0x80000001]);
  doc.tilesets = [{ name: 'Tiles', tw: 1, th: 1, baseIndex: 8, tiles: [new Uint32Array(1), pixels], userData: { text: 'tile metadata', color: '#abc' } }];
  const cel = createCelInstance(createImage(2, 2, new Uint32Array([pixels[0], 0, 0, pixels[0]]), 'tile-bitmap'));
  cel.tiles = { cols: 2, rows: 2, refs };
  doc.layers[0].tileset = 0;
  doc.layers[0].cels = [cel, cel]; doc.layers[0].celOpacity = [1, 1];
  const expected = doc.toJSON();
  const pending = runTask('prepareDocument', { raw: doc.captureDocument() });
  const posted = workers[0].posted!.args as Ops['prepareDocument']['args'];
  expect(posted.raw.tilesets[0].d[1]).toBeInstanceOf(Uint32Array);
  expect(posted.raw.layers[0].cels[0].t).toBeInstanceOf(Uint32Array);
  refs[0] = 0; pixels[0] = 0;
  const prepared = await pending;
  expect(prepared.data).toEqual(expected);
  expect(refs.byteLength).toBe(16); expect(pixels.byteLength).toBe(4);
  const decoded = new Sprite(1, 1); await decoded.loadAsync(prepared.data);
  expect(decoded.toJSON()).toEqual(expected);
  expect(decoded.layers[0].cels[0]).toBe(decoded.layers[0].cels[1]);
  expect([...decoded.layers[0].cels[0]!.tiles!.refs]).toEqual([1, 0, 0, 0x80000001]);
});

test('background persistence retains JSON normalization of optional fields and unknown extension values', async () => {
  workerMode();
  const doc = fixture();
  doc.layers[0].userData = undefined;
  doc.ext.optional = { omitted: undefined, negativeZero: -0, nested: [undefined, 'value'] };
  const expected = JSON.parse(JSON.stringify(doc));
  const result = await runTask('prepareDocument', { raw: doc.captureDocument() });
  expect(result.data).toEqual(expected);
  expect(Object.hasOwn(result.data.layers[0], 'userData')).toBe(false);
  expect(result.data.ext).toMatchObject({ optional: { negativeZero: 0, nested: [null, 'value'] } });
  expect(result.bytes).toBe(new TextEncoder().encode(JSON.stringify(expected)).byteLength);
});


test('worker sheet export splits visible layers and tags while retaining nested-group and slice metadata', async () => {
  workerMode();
  const originalCanvas = globalThis.OffscreenCanvas, originalImageData = globalThis.ImageData;
  installSoftwareCanvas();
  const Canvas = globalThis.OffscreenCanvas;
  const encodedSizes: number[][] = [];
  // Unit renderer supplies pixels; the platform PNG encoder is a boundary stub.
  globalThis.OffscreenCanvas = class extends Canvas {
    override async convertToBlob() {
      encodedSizes.push([this.width, this.height]);
      return new Blob([], { type: 'image/png' });
    }
  };
  try {
    const doc = new Sprite(1, 1);
    doc.frames = [{ duration: 80 }, { duration: 140 }];
    const layer = (name: string, depth: number, group = false) => ({ ...newLayer(name, 2), depth, group });
    const hidden = layer('Hidden leaf', 2), nested = layer('Hidden nested', 1, true);
    nested.visible = false;
    const child = layer('Visible child', 1), root = layer('Root', 0, true), outside = layer('Outside', 0);
    const cel = (pixel: number) => ({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([pixel]) });
    hidden.cels = [cel(0xffffffff), cel(0xffffffff)];
    child.cels = [cel(0xff0000ff), cel(0xff00ff00)];
    outside.cels = [cel(0xffff0000), cel(0xffff00ff)];
    child.userData = { text: 'child notes' };
    doc.layers = [hidden, nested, child, root, outside];
    doc.tags = [
      { name: 'Idle', from: 0, to: 0, direction: 'forward', color: '#ff0000' },
      { name: 'Run', from: 1, to: 1, direction: 'reverse', color: '#00ff00', userData: { text: 'tag notes' } },
    ];
    doc.slices = [{ name: 'Hit', color: '#abcdef', keys: [{ frame: 0, x: 0, y: 0, w: 1, h: 1 }] }];
    const before = doc.toJSON();
    const result = await runTask('export', {
      raw: doc.captureDocument(), base: 'Sheet', frames: [0, 1],
      areas: { 0: { x: 0, y: 0, w: 1, h: 1 }, 1: { x: 0, y: 0, w: 1, h: 1 } },
      grid: { gridX: 0, gridY: 0, gridW: 1, gridH: 1 },
      opts: { kind: 'sheet', scale: 1, json: 'array', sheet: {
        type: 'horizontal', count: 0, splitLayers: true, splitTags: true, border: 0, spacing: 0, inner: 0,
        trim: 'none', trimByGrid: false, extrude: false, mergeDuplicates: false, ignoreEmpty: false,
        powerOfTwo: false, template: '{layer}-{tag}-{frame01}.png',
      } },
    });
    if (!Array.isArray(result)) throw new Error('Expected sheet files');
    expect(workers[0].posted?.op).toBe('export');
    expect(result.map(output => output.name)).toEqual(['Sheet-sheet.png', 'Sheet-sheet.json']);
    expect(result[0].blob.type).toBe('image/png');
    expect(encodedSizes).toEqual([[1, 4]]);
    const json = JSON.parse(await result[1].blob.text());
    expect(json.frames.map((frame: any) => [frame.filename, frame.frame.y, frame.duration])).toEqual([
      ['Outside-Idle-01.png', 0, 80], ['Visible child-Idle-02.png', 1, 80],
      ['Outside-Run-03.png', 2, 140], ['Visible child-Run-04.png', 3, 140],
    ]);
    expect(json.meta.size).toEqual({ w: 1, h: 4 });
    expect(json.meta.frameTags).toEqual([
      { name: 'Idle', from: 0, to: 0, direction: 'forward', color: '#ff0000' },
      { name: 'Run', from: 1, to: 1, direction: 'reverse', color: '#00ff00', data: 'tag notes' },
    ]);
    expect(json.meta.layers.find((entry: any) => entry.name === 'Hidden leaf').group).toBe('Hidden nested');
    expect(json.meta.layers.find((entry: any) => entry.name === 'Hidden nested').group).toBe('Root');
    expect(json.meta.layers.find((entry: any) => entry.name === 'Visible child')).toMatchObject({ group: 'Root', data: 'child notes' });
    expect(json.meta.slices).toEqual([{ name: 'Hit', color: '#abcdef', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 1, h: 1 } }] }]);
    expect(doc.toJSON()).toEqual(before);
  } finally {
    globalThis.OffscreenCanvas = originalCanvas; globalThis.ImageData = originalImageData;
  }
});
