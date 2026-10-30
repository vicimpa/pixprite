import { beforeAll, expect, mock, test } from 'bun:test';
import { canvasPixels, installSoftwareCanvas } from './Canvas.test-helper';
import { packRgba } from './Image';
import { createCelInstance, createImage, effectsForFrame, imageOf } from './DocumentModel';
import { tinted } from './OnionTint';
import { newLayer } from './SpriteModel';
import { decodeAseprite, encodeAseprite } from './formats/Aseprite';
import { prepareExport, type VideoExport } from './ExportPreparation';
import { decodeGif } from './formats/GifDecode';
import { asepriteDocument, documentContext } from './BackgroundDocument';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite } = await import('./Sprite');
beforeAll(installSoftwareCanvas);
const RED = packRgba(255, 0, 0, 255), BLUE = packRgba(0, 0, 255, 255);
const fx = (id = 'alpha', amount = .5, enabled = true) => ({ id, type: 'opacity' as const, amount, enabled });
const pixels = (sprite: InstanceType<typeof Sprite>) => sprite.frames.map((_, f) => canvasPixels(sprite.render(f)));
function fixture() {
  const sprite = new Sprite(3, 2);
  const image = createImage(2, 1, new Uint32Array([RED, BLUE]));
  const cel = createCelInstance(image, { x: 1, y: -1, rotation: 90, opacity: .5 });
  sprite.frames = Array.from({ length: 4 }, () => ({ duration: 100 }));
  sprite.layers[0].cels = [cel, cel, cel, cel];
  sprite.layers[0].celOpacity = [1, 1, 1, 1];
  sprite.layers[0].continuous = true;
  sprite.setLayerEffects([fx()]);
  return { sprite, image, cel };
}

test('a live stack draft previews every frame without dirtying, changing source pixels/history or captures', () => {
  const { sprite, image, cel } = fixture();
  const before = sprite.toJSON(), history = sprite.history.slice(), version = sprite.version;
  const first = pixels(sprite), firstTint = canvasPixels(tinted(sprite, 0, true));
  sprite.previewLayerEffects([fx('draft', .25)]);
  expect(pixels(sprite)).not.toEqual(first);
  expect(canvasPixels(tinted(sprite, 0, true))).not.toEqual(firstTint);
  expect(sprite.toJSON()).toEqual(before);
  expect(sprite.history).toEqual(history);
  expect(sprite.version).toBe(version);
  expect(sprite.getCel()).toBe(cel);
  expect([...image.data]).toEqual([RED, BLUE]);
  sprite.previewLayerEffects(null);
  expect(pixels(sprite)).toEqual(first);
  expect(canvasPixels(tinted(sprite, 0, true))).toEqual(firstTint);
});

test('frame/range/layer bake preserves appearance, placements and sharing boundaries with exactly one undo/redo', () => {
  for (const scope of ['frame', 'range', 'layer'] as const) {
    const { sprite, image, cel } = fixture();
    sprite.frame = 1;
    sprite.range = { type: 'frames', frames: [1, 2], layers: [0, 0] };
    const before = pixels(sprite), source = sprite.toJSON(), depth = sprite.undoDepth;
    expect(sprite.bakeLayerEffects(scope)).toBe(true);
    const after = sprite.toJSON();
    expect(sprite.undoDepth).toBe(depth + 1);
    expect(pixels(sprite)).toEqual(before);
    expect([...image.data]).toEqual([RED, BLUE]);
    expect(sprite.layers[0].cels[1]).not.toBe(cel);
    expect(sprite.layers[0].cels[1]).toMatchObject({ x: 1, y: -1, w: 1, h: 2 });
    if (scope === 'range') expect(sprite.layers[0].cels[1]).toBe(sprite.layers[0].cels[2]);
    if (scope !== 'layer') {
      expect(sprite.layers[0].cels[0]).toBe(cel);
      expect(sprite.layers[0].cels[3]).toBe(cel);
      expect(imageOf(sprite.layers[0].cels[3]!)).toBe(image);
    } else expect(sprite.layers[0].effects).toEqual([]);
    sprite.undo(); expect(sprite.toJSON()).toEqual(source); expect(sprite.getCel()).toBe(cel);
    sprite.redo(); expect(sprite.toJSON()).toEqual(after); expect(pixels(sprite)).toEqual(before);
    const loaded = new Sprite(); loaded.load(after); expect(pixels(loaded)).toEqual(before);
  }
});

test('identity/disabled baking detaches compatibility bitmaps across the scope boundary', () => {
  for (const effect of [fx('identity', 1), fx('disabled', .5, false)]) {
    const { sprite, cel, image } = fixture();
    sprite.setLayerEffects([effect]);
    sprite.bakeLayerEffects('frame');
    const baked = sprite.layers[0].cels[0]!;
    const expected = cel.data.slice();
    baked.data[0] = BLUE;
    expect(cel.data).toEqual(expected);
    expect(sprite.layers[0].cels[1]).toBe(cel);
    expect([...image.data]).toEqual([RED, BLUE]);
    expect(imageOf(baked).data[0]).toBe(BLUE);
  }
});

test('baking a changed dialog draft accepts it and bakes in one undo step', () => {
  const { sprite, cel } = fixture();
  const before = sprite.toJSON(), depth = sprite.undoDepth;
  const draft = [fx('draft', .25)];
  sprite.previewLayerEffects(draft);
  const expected = pixels(sprite);
  sprite.previewLayerEffects(null);
  sprite.bakeLayerEffects('frame', 0, draft);
  expect(sprite.undoDepth).toBe(depth + 1);
  expect(pixels(sprite)).toEqual(expected);
  expect(sprite.layers[0].cels[1]).toBe(cel);
  expect(sprite.layers[0].effects).toEqual(draft);
  sprite.undo(); expect(sprite.toJSON()).toEqual(before);
  sprite.redo(); expect(pixels(sprite)).toEqual(expected);
});

test('disabled/reordered/edited/deleted effects and fresh effects respect baked scope and saved stack order', async () => {
  const { sprite } = fixture();
  sprite.setLayerEffects([fx('a', .5), fx('disabled', 0, false), fx('b', .5)]);
  sprite.bakeLayerEffects('frame');
  const baked = canvasPixels(sprite.render(0));
  sprite.setLayerEffects([fx('b', .25), fx('disabled', 0, true), fx('a', .25)]);
  expect(canvasPixels(sprite.render(0))).toEqual(baked);
  expect(canvasPixels(sprite.render(1)).every(p => p === 0)).toBe(true);
  sprite.setLayerEffects([fx('a', .25), fx('fresh', .5)]);
  expect(effectsForFrame(sprite.layers[0], 0).map(effect => effect.id)).toEqual(['fresh']);
  expect(sprite.toJSON().layers[0].effects?.map(effect => effect.id)).toEqual(['a', 'fresh']);
  const before = pixels(sprite);
  const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(sprite.toDocument())));
  expect(pixels(exported)).toEqual(before);
  expect(exported.toDocument().layers[0]).not.toHaveProperty('effects');
});

function scopedFixture() {
  const { sprite } = fixture();
  sprite.layers[0].cels = sprite.frames.map(() => createCelInstance(createImage(1, 1, new Uint32Array([RED]))));
  sprite.bakeLayerEffects('frame');
  sprite.setLayerEffects([fx('alpha', .25)]);
  return sprite;
}
const alphas = (sprite: InstanceType<typeof Sprite>) => pixels(sprite).map(frame => frame[0] >>> 24);

test('baked scope follows duplicate, empty, move, copy, delete and reverse timeline frames', () => {
  const run = (operation: (sprite: InstanceType<typeof Sprite>) => void, expected: number[]) => {
    const sprite = scopedFixture(); operation(sprite);
    expect(alphas(sprite)).toEqual(expected);
    const saved = sprite.toJSON(), loaded = new Sprite(); loaded.load(saved); expect(alphas(loaded)).toEqual(expected);
    sprite.undo();
    expect(alphas(sprite)).toEqual([128, 64, 64, 64]);
  };
  run(sprite => { sprite.addFrame('duplicate'); }, [128, 128, 64, 64, 64]);
  run(sprite => { sprite.addFrame('empty'); }, [128, 0, 64, 64, 64]);
  run(sprite => sprite.moveFrames([0, 0], 4, false), [64, 64, 64, 128]);
  run(sprite => sprite.moveFrames([0, 0], 2, true), [128, 64, 128, 64, 64]);
  run(sprite => { sprite.removeFrames(); }, [64, 64, 64]);
  run(sprite => sprite.reverseFrames(), [64, 64, 64, 128]);
});

test('scope follows frame/cel/layer clipboard and duplicate/link operations without aliasing snapshots', () => {
  for (const type of ['frames', 'cels', 'layers'] as const) {
    const sprite = scopedFixture();
    sprite.range = { type, frames: [0, 0], layers: [0, 0] };
    const clip = sprite.copyRange()!;
    sprite.frame = 2; sprite.range = null;
    sprite.pasteRange(clip);
    if (type === 'frames') expect(alphas(sprite)).toEqual([128, 64, 128, 64, 64]);
    if (type === 'cels') expect(alphas(sprite)).toEqual([128, 64, 128, 64]);
    if (type === 'layers') {
      expect(sprite.layers[1].bakedEffects).toEqual(sprite.layers[0].bakedEffects);
      expect(sprite.layers[1].bakedEffects).not.toBe(sprite.layers[0].bakedEffects);
    }
    const loaded = new Sprite(); loaded.load(sprite.toJSON()); expect(pixels(loaded)).toEqual(pixels(sprite));
  }
  const sprite = scopedFixture();
  sprite.duplicateCels(true); expect(alphas(sprite)).toEqual([128, 128, 64, 64]);
  sprite.undo();
  sprite.range = { type: 'cels', frames: [0, 2], layers: [0, 0] };
  sprite.linkCels(); expect(alphas(sprite)).toEqual([128, 128, 128, 64]);
  sprite.undo(); expect(alphas(sprite)).toEqual([128, 64, 64, 64]);
  sprite.moveCels({ type: 'cels', frames: [0, 0], layers: [0, 0] }, 0, 1, false);
  expect(alphas(sprite)).toEqual([0, 128, 64, 64]);
  sprite.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) }, 0, 0);
  expect(alphas(sprite)).toEqual([64, 128, 64, 64]);
  sprite.addLayer();
  sprite.setLayerEffects([fx('other', .75)]);
  sprite.frame = 0;
  sprite.range = { type: 'cels', layers: [0, 0], frames: [1, 1] };
  const clip = sprite.copyRange()!;
  sprite.pasteRange(clip);
  expect(sprite.layers[1].bakedEffects?.[0] ?? []).toEqual([]);
  expect(effectsForFrame(sprite.layers[1], 0).map(effect => effect.id)).toEqual(['other']);
});

function groupFixture() {
  const { sprite, cel } = fixture();
  const bottom = { ...newLayer('Backdrop', 4), cels: sprite.frames.map(() => ({ x: 0, y: 0, w: 3, h: 2, data: new Uint32Array(6).fill(BLUE) })) };
  const child = { ...sprite.layers[0], name: 'Original child', depth: 1, effects: [fx('child', .75)] };
  const group = { ...newLayer('Group', 4), group: true, opacity: 128 / 255, blend: 'multiply' as const, clip: true, effects: [fx('group', .5)] };
  sprite.layers = [bottom, child, group]; sprite.layer = 2;
  sprite.range = { type: 'frames', frames: [1, 2], layers: [0, 2] };
  return { sprite, cel };
}

test('partial group bake changes only selected child cels, retaining hierarchy, outer blend/clip and other frame links', async () => {
  const { sprite, cel } = groupFixture();
  sprite.layers[1].bakedEffects = [[], ['child'], ['child'], []];
  const before = pixels(sprite), saved = sprite.toJSON(), depth = sprite.undoDepth;
  expect(sprite.bakeLayerEffects('range')).toBe(true);
  expect(sprite.undoDepth).toBe(depth + 1);
  expect(sprite.layers.map(layer => layer.name)).toEqual(['Backdrop', 'Original child', 'Group FX', 'Group']);
  expect(sprite.layers[3].group).toBe(true);
  expect(sprite.layers[1].cels).toEqual([cel, null, null, cel]);
  expect(sprite.layers[1].bakedEffects).toEqual([[], [], [], []]);
  expect(sprite.layers[1].cels[0]).toBe(sprite.layers[1].cels[3]);
  expect(sprite.layers[2].cels[0]).toBeNull(); expect(sprite.layers[2].cels[3]).toBeNull();
  expect(pixels(sprite)).toEqual(before);
  const loaded = new Sprite(); loaded.load(sprite.toJSON()); expect(pixels(loaded)).toEqual(before);
  const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(sprite.toDocument())));
  expect(pixels(exported)).toEqual(before);
  sprite.undo(); expect(sprite.toJSON()).toEqual(saved); expect(sprite.layers[1].cels[3]).toBe(cel);
  sprite.redo(); expect(pixels(sprite)).toEqual(before);
});

test('group bounds and locked descendants refuse baking before mutation/history; ordinary layer locks refuse FX editing', () => {
  const { sprite } = groupFixture();
  sprite.layers[1].cels[0] = { x: -10000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  sprite.layers.splice(2, 0, { ...newLayer('Distant', 4), depth: 1, cels: [{ x: 10000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) }, null, null, null] });
  sprite.layer = 1; sprite.frame = 3;
  sprite.paste({ w: 1, h: 1, data: new Uint32Array([BLUE]) }, { x: 1, y: 0 });
  sprite.layer = 3;
  const floating = sprite.floating;
  const before = sprite.layers.map(layer => ({ ...layer, cels: layer.cels.slice() })), depth = sprite.undoDepth;
  expect(() => sprite.bakeLayerEffects('layer')).toThrow(RangeError);
  expect(sprite.layers).toEqual(before); expect(sprite.undoDepth).toBe(depth); expect(sprite.floating).toBe(floating);
  sprite.layers[1].locked = true;
  expect(sprite.bakeLayerEffects('layer')).toBe(false);
  expect(sprite.setLayerEffects([fx()], 1)).toBe(false);
});

test('tilemap/indexed bake promotes only necessary model properties; undo returns exact resources and structure', () => {
  const { sprite, image, cel } = fixture();
  sprite.colorMode = 'indexed'; sprite.transparentIndex = 0;
  sprite.tilesets = [{ name: 'Tiles', tw: 2, th: 1, baseIndex: 1, tiles: [new Uint32Array(2), image.data] }];
  sprite.layers[0].tileset = 0;
  cel.tiles = { cols: 1, rows: 1, refs: new Uint32Array([1]) };
  const before = pixels(sprite), source = sprite.toJSON();
  sprite.bakeLayerEffects('frame');
  expect(String(sprite.colorMode)).toBe('rgb'); expect(sprite.layers[0].tileset).toBe(-1);
  expect(sprite.layers[0].cels.every(cel => !cel?.tiles)).toBe(true);
  expect(imageOf(sprite.layers[0].cels[1]!)).toBe(image);
  expect(pixels(sprite)).toEqual(before);
  const loaded = new Sprite(); loaded.load(sprite.toJSON()); expect(pixels(loaded)).toEqual(before);
  sprite.undo(); expect(sprite.toJSON()).toEqual(source); expect(sprite.getCel()).toBe(cel);
});

test('worker hydration and Aseprite baking consume the same residual stack and never export draft effects', () => {
  const sprite = scopedFixture();
  sprite.previewLayerEffects([fx('draft', 0)]);
  const raw = sprite.captureDocument();
  const worker = documentContext(raw);
  sprite.previewLayerEffects(null);
  expect(sprite.frames.map((_, f) => canvasPixels(worker.render(f)))).toEqual(pixels(sprite));
  expect(asepriteDocument(raw)).toEqual(sprite.toDocument());
});

test('malformed residual scope is rejected atomically; unusual valid IDs do not collide in bake caches', () => {
  const { sprite } = fixture();
  sprite.bakeLayerEffects('frame');
  const before = sprite.toJSON();
  expect(before.version).toBe(6);
  expect(() => sprite.load({ ...before, version: 5 })).toThrow('Layer baked effects require pixprite version 6');
  expect(sprite.toJSON()).toEqual(before);
  for (const bad of [[['alpha']], Array(4).fill(['alpha', 'alpha']), Array(4).fill([7]), Array(4).fill(['x'.repeat(257)])]) {
    const data = structuredClone(before); data.layers[0].bakedEffects = bad as string[][];
    expect(() => sprite.load(data)).toThrow('Invalid baked layer effects');
    expect(sprite.toJSON()).toEqual(before);
  }
  sprite.setLayerEffects([fx('a\0b'), fx('a'), fx('b')]);
  sprite.layers[0].bakedEffects = [['a', 'b'], ['a\0b'], [], []];
  const rendered = pixels(sprite);
  sprite.bakeLayerEffects('layer'); expect(pixels(sprite)).toEqual(rendered);
});


test('GIF and video preparation bake residual FX per frame, including disabled effects and animation delays', async () => {
  const sprite = scopedFixture();
  const args = {
    raw: sprite.captureDocument(), base: 'FX', frames: [0, 1, 2, 3],
    areas: Object.fromEntries(sprite.frames.map((_, f) => [f, sprite.canvasRect])),
    grid: { gridW: 1, gridH: 1, gridX: 0, gridY: 0 },
  };
  const video = await prepareExport({ ...args, opts: { kind: 'webm', scale: 1 } }) as VideoExport;
  expect(video.frames.map(frame => Array.from(frame.data))).toEqual(pixels(sprite).map(data => Array.from(new Uint8ClampedArray(data.buffer))));
  expect(video.frames.map(frame => frame.delay)).toEqual([100, 100, 100, 100]);
  const gif = await prepareExport({ ...args, opts: { kind: 'gif', scale: 1 } });
  if (!Array.isArray(gif)) throw new Error('Expected a GIF file');
  const decoded = decodeGif(new Uint8Array(await gif[0].blob.arrayBuffer()));
  expect(decoded.frames.map(frame => frame.data[0] >>> 24)).toEqual([255, 0, 0, 0]);
  expect(sprite.captureDocument()).toEqual(args.raw);
});
