import { beforeAll, expect, mock, test } from 'bun:test';
import { canvasPixels, installSoftwareCanvas } from './Canvas.test-helper';
import { packRgba } from './Image';
import { Mask } from './Mask';
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

const outline = (patch: Partial<Extract<import('./DocumentModel').LayerFX, { type: 'outline' }>> = {}) => ({
  id: 'outline', type: 'outline' as const, enabled: true, color: BLUE, thickness: 1,
  position: 'outside' as const, join: 'round' as const, ...patch,
});
const { bakeCel } = await import('./DocumentModel');
const glyph = (cel: NonNullable<ReturnType<typeof bakeCel>>) => Array.from({ length: cel.h }, (_, y) =>
  Array.from(cel.data.subarray(y * cel.w, (y + 1) * cel.w), pixel => pixel === RED ? 'R' : pixel === BLUE ? 'B' : '.').join(''));

test('outline golden geometry distinguishes Euclidean round, Chebyshev miter and Manhattan bevel at thickness 3', () => {
  const cel = { x: -7, y: 4, w: 1, h: 1, data: new Uint32Array([RED]) };
  const expected = {
    round: ['...B...', '.BBBBB.', '.BBBBB.', 'BBBRBBB', '.BBBBB.', '.BBBBB.', '...B...'],
    miter: ['BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBRBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB'],
    bevel: ['...B...', '..BBB..', '.BBBBB.', 'BBBRBBB', '.BBBBB.', '..BBB..', '...B...'],
  };
  for (const join of ['round', 'miter', 'bevel'] as const) {
    const result = bakeCel(cel, [outline({ thickness: 3, join })])!;
    expect(result).toMatchObject({ x: -10, y: 1, w: 7, h: 7 });
    expect(glyph(result)).toEqual(expected[join]);
  }
  expect([...cel.data]).toEqual([RED]);
});

test('inside uses exterior transparent space and hole edges; odd center allocates floor inside and ceil outside', () => {
  const filled = { x: 5, y: -5, w: 9, h: 9, data: new Uint32Array(81).fill(RED) };
  const inner = bakeCel(filled, [outline({ position: 'inside', thickness: 3 })])!;
  expect(inner).toMatchObject({ x: 5, y: -5, w: 9, h: 9 });
  expect(glyph(inner)).toEqual(['BBBBBBBBB', 'BBBBBBBBB', 'BBBBBBBBB', 'BBBRRRBBB', 'BBBRRRBBB', 'BBBRRRBBB', 'BBBBBBBBB', 'BBBBBBBBB', 'BBBBBBBBB']);
  const center = bakeCel({ ...filled, w: 5, h: 5, data: new Uint32Array(25).fill(RED) }, [outline({ position: 'center', thickness: 3, join: 'miter' })])!;
  expect(center).toMatchObject({ x: 3, y: -7, w: 9, h: 9 });
  expect(glyph(center)).toEqual(['BBBBBBBBB', 'BBBBBBBBB', 'BBBBBBBBB', 'BBBRRRBBB', 'BBBRRRBBB', 'BBBRRRBBB', 'BBBBBBBBB', 'BBBBBBBBB', 'BBBBBBBBB']);
  const ring = { x: 0, y: 0, w: 5, h: 5, data: new Uint32Array(25).fill(RED) }; ring.data[12] = 0x000000ff;
  expect(bakeCel(ring, [outline({ position: 'inside' })])!.data[11]).toBe(BLUE);
  expect(bakeCel(ring, [outline()])!.data[3 * 7 + 3]).toBe(BLUE);
});

test('RGBA outline preserves semitransparent sources, ignores hidden RGB, and uses source-atop inside', () => {
  const redHalf = packRgba(255, 0, 0, 128), blueHalf = packRgba(0, 0, 255, 128);
  const source = createImage(2, 1, new Uint32Array([redHalf, 0x0000ffff]));
  const cel = createCelInstance(source);
  const result = bakeCel(cel, [outline({ color: blueHalf })])!;
  expect(result.data[1 * 4 + 1]).toBe(redHalf);
  expect(result.data[1 * 4 + 2]).toBe(blueHalf);
  expect(result.data[0]).toBe(0);
  const inner = bakeCel(cel, [outline({ color: blueHalf, position: 'inside' })])!;
  expect(inner.data[0]).toBe(packRgba(127, 0, 128, 128));
  expect(inner.data[1]).toBe(0x0000ffff);
  expect([...source.data]).toEqual([redHalf, 0x0000ffff]);
  expect(bakeCel(cel, [outline({ color: 0x00ff00ff })])!).toMatchObject({ x: 0, y: 0, w: 2, h: 1 });
  expect(bakeCel({ ...cel, data: new Uint32Array(2) }, [outline()])!.data.every(pixel => pixel === 0)).toBe(true);
});

test('outline and opacity execute in stored order; disable, reorder and partial bake preserve the residual stack', async () => {
  const sprite = new Sprite(7, 7), source = createImage(1, 1, new Uint32Array([RED]));
  const cel = createCelInstance(source, { x: 3, y: 3 });
  sprite.frames = [{ duration: 100 }, { duration: 100 }]; sprite.layers[0].cels = [cel, cel]; sprite.layers[0].celOpacity = [1, 1];
  sprite.setLayerEffects([fx(), outline()]);
  const alphaBefore = pixels(sprite);
  expect(alphaBefore[0][3 * 7 + 2]).toBe(BLUE);
  sprite.setLayerEffects([outline(), fx()]);
  const alphaAfter = pixels(sprite);
  expect(alphaAfter[0][3 * 7 + 2]).toBe(packRgba(0, 0, 255, 128));
  expect(alphaAfter).not.toEqual(alphaBefore);
  sprite.setLayerEffects([outline({ enabled: false }), fx()]);
  expect(pixels(sprite)[0][3 * 7 + 2]).toBe(0);
  sprite.setLayerEffects([outline(), fx()]);
  const saved = sprite.toJSON(), depth = sprite.undoDepth;
  sprite.bakeLayerEffects('frame');
  expect(sprite.undoDepth).toBe(depth + 1); expect(pixels(sprite)).toEqual(alphaAfter);
  expect(sprite.layers[0].cels[0]).toMatchObject({ x: 2, y: 2, w: 3, h: 3 });
  expect(sprite.layers[0].cels[1]).toBe(cel);
  sprite.undo(); expect(sprite.toJSON()).toEqual(saved);
  sprite.redo(); expect(pixels(sprite)).toEqual(alphaAfter);
  const baked = sprite.toJSON();
  sprite.setLayerEffects([fx('alpha', .25), outline({ thickness: 2, color: RED })]);
  expect(pixels(sprite)[0]).toEqual(alphaAfter[0]); expect(pixels(sprite)[1]).not.toEqual(alphaAfter[1]);
  sprite.load(baked);
  const loaded = new Sprite(); loaded.load(sprite.toJSON()); expect(pixels(loaded)).toEqual(alphaAfter);
  const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(sprite.toDocument())));
  expect(pixels(exported)).toEqual(alphaAfter);
  expect([...source.data]).toEqual([RED]);
});

test('off-canvas nested group composites include expanded children before group FX, with matching export and partial bake', async () => {
  const sprite = new Sprite(5, 3);
  sprite.frames = [{ duration: 100 }, { duration: 100 }];
  const cel = createCelInstance(createImage(1, 1, new Uint32Array([RED])), { x: -2, y: 1 });
  const child = { ...newLayer('Off-canvas', 2), depth: 2, cels: [cel, cel], effects: [outline({ id: 'child' })] };
  const nested = { ...newLayer('Nested', 2), depth: 1, group: true, effects: [outline({ id: 'nested' })] };
  const outer = { ...newLayer('Outer', 2), group: true, effects: [outline({ id: 'outer' })] };
  sprite.layers = [child, nested, outer]; sprite.layer = 2;
  const before = pixels(sprite), saved = sprite.toJSON();
  expect(before[0][5]).toBe(BLUE); expect(before[0][6]).toBe(BLUE); expect(before[0][7]).toBe(0);
  expect(canvasPixels(documentContext(sprite.captureDocument()).render())).toEqual(before[0]);
  const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(sprite.toDocument())));
  expect(pixels(exported)).toEqual(before);
  sprite.bakeLayerEffects('frame'); expect(pixels(sprite)).toEqual(before);
  expect(sprite.layers[0].cels).toEqual([null, cel]);
  sprite.undo(); expect(sprite.toJSON()).toEqual(saved);
});

test('floating composition and transformed linked instances retain their source and render/bake placement', () => {
  const sprite = new Sprite(7, 7), image = createImage(2, 1, new Uint32Array([RED, BLUE]));
  const cel = createCelInstance(image, { x: 2, y: 2, rotation: 90, flipX: true });
  sprite.layers[0].cels[0] = cel; sprite.setLayerEffects([outline()]);
  const before = canvasPixels(sprite.render());
  sprite.paste({ w: 1, h: 1, data: new Uint32Array([RED]) }, { x: 5, y: 5 });
  const preview = canvasPixels(sprite.render());
  expect(preview).not.toEqual(before);
  sprite.dropFloating(); expect(canvasPixels(sprite.render())).toEqual(preview);
  sprite.bakeLayerEffects(); expect(canvasPixels(sprite.render())).toEqual(preview);
  expect([...image.data]).toEqual([RED, BLUE]);
});

test('outline honors group blend and clipping, selection does not limit layer FX baking', () => {
  const { sprite } = groupFixture();
  sprite.setLayerEffects([outline(), fx('outer-alpha', .5)]);
  sprite.mask = Mask.rect(sprite.width, sprite.height, { x: 0, y: 0, w: 1, h: 1 });
  const before = pixels(sprite), source = sprite.toJSON();
  sprite.bakeLayerEffects('range'); expect(pixels(sprite)).toEqual(before);
  sprite.undo(); expect(sprite.toJSON()).toEqual(source);
});

test('outline custom RGBA in indexed tilemaps promotes export/bake to RGB and rasterizes geometry, retaining editable sources', async () => {
  const sprite = new Sprite(5, 5), cel = createCelInstance(createImage(1, 1, new Uint32Array([RED])), { x: 2, y: 2 });
  cel.tiles = { cols: 1, rows: 1, refs: new Uint32Array([1]) };
  sprite.layers[0].cels[0] = cel; sprite.layers[0].tileset = 0;
  sprite.tilesets = [{ name: 'T', tw: 1, th: 1, baseIndex: 1, tiles: [new Uint32Array(1), new Uint32Array([RED])] }];
  sprite.colorMode = 'indexed'; sprite.transparentIndex = 0; sprite.framePalettes = [{ frame: 0, colors: ['#00000000', '#ff0000'] }];
  sprite.setLayerEffects([outline({ color: packRgba(10, 20, 30, 120) })]);
  const before = pixels(sprite), saved = sprite.toJSON(), doc = sprite.toDocument();
  expect(doc.colorMode).toBe('rgb'); expect(doc.layers[0].tileset).toBe(-1);
  expect(doc.layers[0].cels[0]).toMatchObject({ x: 1, y: 1, w: 3, h: 3 }); expect(doc.layers[0].cels[0]).not.toHaveProperty('tiles');
  const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(doc)));
  expect(pixels(exported)).toEqual(before); expect(sprite.toJSON()).toEqual(saved);
  sprite.bakeLayerEffects(); expect(String(sprite.colorMode)).toBe('rgb'); expect(pixels(sprite)).toEqual(before);
  sprite.undo(); expect(sprite.toJSON()).toEqual(saved);
});

test('outline bounds preflight refuses cumulative expansion, distant/nested groups and floating before history or pixels change', () => {
  const sprite = new Sprite(4096, 1);
  sprite.layers[0].cels[0] = createCelInstance(createImage(4096, 1, new Uint32Array(4096).fill(RED)));
  const before = sprite.toJSON(), depth = sprite.undoDepth;
  expect(() => sprite.previewLayerEffects([outline()])).toThrow(RangeError);
  expect(() => sprite.setLayerEffects([outline()])).toThrow(RangeError);
  expect(() => sprite.bakeLayerEffects('layer', 0, [outline()])).toThrow(RangeError);
  expect(sprite.toJSON()).toEqual(before); expect(sprite.undoDepth).toBe(depth);
  const malformedBounds = structuredClone(before); malformedBounds.layers[0].effects = [outline()];
  sprite.load(malformedBounds); expect(sprite.effectsBoundsNotice).toBe(true);
  expect(() => sprite.toDocument()).toThrow(RangeError); sprite.load(before);
  sprite.layers[0].cels[0] = { x: -4000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  sprite.paste({ w: 1, h: 1, data: new Uint32Array([RED]) }, { x: 4000, y: 0 });
  const floating = sprite.floating, history = sprite.undoDepth;
  expect(() => sprite.bakeLayerEffects('layer', 0, [outline()])).toThrow(RangeError);
  expect(sprite.floating).toBe(floating); expect(sprite.undoDepth).toBe(history);
  const { sprite: grouped } = groupFixture();
  grouped.layers[1].cels[0] = { x: -3000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  grouped.layers.splice(2, 0, { ...newLayer('Far', 4), depth: 1, cels: [{ x: 3000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) }, null, null, null] });
  grouped.layer = 3;
  const groupedSaved = grouped.toJSON();
  expect(() => grouped.setLayerEffects([outline()])).toThrow(RangeError);
  expect(() => grouped.toDocument()).toThrow(RangeError);
  expect(() => grouped.render()).not.toThrow(); expect(grouped.effectsBoundsNotice).toBe(true);
  expect(grouped.toJSON()).toEqual(groupedSaved);
});

test('outline malformed discriminants and parameters refuse atomically; maximum thickness remains bounded on large cels', () => {
  const sprite = new Sprite(1, 1), saved = sprite.toJSON();
  for (const patch of [{ type: 'shadow' }, { color: -1 }, { color: 2 ** 32 }, { color: NaN }, { thickness: 0 }, { thickness: 129 },
    { thickness: 1.5 }, { position: 'elsewhere' }, { join: 'sharp' }, { enabled: 1 }, { color: undefined }]) {
    const malformed = structuredClone(saved); malformed.layers[0].effects = [{ ...outline(), ...patch } as any];
    expect(() => sprite.load(malformed)).toThrow('effect'); expect(sprite.toJSON()).toEqual(saved);
  }
  const cel = { x: 0, y: 0, w: 768, h: 512, data: new Uint32Array(768 * 512).fill(RED) };
  const start = performance.now();
  for (const join of ['round', 'miter', 'bevel'] as const) {
    const result = bakeCel(cel, [outline({ thickness: 128, join })])!;
    expect(result).toMatchObject({ x: -128, y: -128, w: 1024, h: 768 });
    expect(result.data[128 * 1024]).toBe(BLUE);
  }
  // A quadratic-in-radius scan would require ~150 billion neighbor visits here.
  expect(performance.now() - start).toBeLessThan(5000);
});


test('opacity-only v5/v6 stacks retain single-rounding alpha, including disabled gaps', () => {
  const cel = { x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([packRgba(255, 0, 0, 1)]) };
  expect(bakeCel(cel, [fx('a'), outline({ enabled: false }), fx('b')])!.data[0]).toBe(0);
  expect(bakeCel(cel, [fx('a'), outline({ color: 0x00ff0000 }), fx('b')])!.data[0]).toBe(0);
  expect(bakeCel(cel, [fx('a'), outline(), fx('b')])!.data[4]).toBe(packRgba(255, 0, 0, 1));
});


test('growing source geometry pauses FX with a notice, survives save/reload, and resumes automatically after shrink/undo', () => {
  const sprite = new Sprite(4096, 3);
  const cel = createCelInstance(createImage(4094, 1, new Uint32Array(4094).fill(RED)), { x: 1, y: 1 });
  sprite.layers[0].cels[0] = cel; sprite.setLayerEffects([outline()]);
  expect(sprite.effectsBoundsNotice).toBe(false);
  const original = sprite.toJSON(), visible = pixels(sprite);
  sprite.checkpoint('Grow');
  sprite.setCel({ x: 0, y: 1, w: 4096, h: 1, data: new Uint32Array(4096).fill(RED) });
  expect(sprite.effectsBoundsNotice).toBe(true);
  expect(canvasPixels(sprite.render())[0]).toBe(0);
  expect(sprite.layers[0].effects).toEqual([outline()]);
  const grown = sprite.toJSON(), loaded = new Sprite(); loaded.load(grown);
  expect(loaded.effectsBoundsNotice).toBe(true); expect(pixels(loaded)).toEqual(pixels(sprite));
  expect(canvasPixels(documentContext(sprite.captureDocument()).render())).toEqual(pixels(sprite)[0]);
  expect(() => sprite.bakeLayerEffects()).toThrow(RangeError); expect(() => sprite.toDocument()).toThrow(RangeError);
  expect(sprite.toJSON()).toEqual(grown);
  loaded.setCel(cel); expect(loaded.effectsBoundsNotice).toBe(false); expect(pixels(loaded)).toEqual(visible);
  sprite.undo(); expect(sprite.toJSON()).toEqual(original); expect(sprite.effectsBoundsNotice).toBe(false); expect(pixels(sprite)).toEqual(visible);
});

test('paused stacks do not block repairing another layer, or fixing children one at a time under a paused ancestor', () => {
  const sprite = new Sprite(4096, 1), large = () => ({ x: 0, y: 0, w: 4096, h: 1, data: new Uint32Array(4096).fill(RED) });
  sprite.layers = [
    { ...newLayer('A', 1), depth: 1, cels: [large()], effects: [outline({ id: 'a' })] },
    { ...newLayer('B', 1), depth: 1, cels: [large()], effects: [outline({ id: 'b' })] },
    { ...newLayer('Parent', 1), group: true, effects: [outline({ id: 'p' })] },
    { ...newLayer('Independent', 1), cels: [{ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) }] },
  ];
  expect(() => sprite.setLayerEffects([outline()], 3)).not.toThrow();
  sprite.layer = 3; expect(sprite.bakeLayerEffects()).toBe(true);
  expect(() => sprite.previewLayerEffects([outline({ id: 'a', enabled: false })], 0)).not.toThrow();
  sprite.previewLayerEffects(null);
  expect(() => sprite.setLayerEffects([outline({ id: 'a', enabled: false })], 0)).not.toThrow();
  expect(() => sprite.setLayerEffects([outline({ id: 'b', enabled: false })], 1)).not.toThrow();
  expect(() => sprite.setLayerEffects([outline({ id: 'p', enabled: false })], 2)).not.toThrow();
  expect(sprite.effectsBoundsNotice).toBe(false);
});

test('distant floating unions with disabled or identity stacks render in a bounded window', () => {
  for (const effects of [[outline({ enabled: false })], [fx('identity', 1)]]) {
    const sprite = new Sprite(4096, 1);
    sprite.layers[0].cels[0] = { x: -4000, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
    sprite.layers[0].effects = effects;
    sprite.paste({ w: 1, h: 1, data: new Uint32Array([BLUE]) }, { x: 4000, y: 0 });
    expect(() => sprite.render()).not.toThrow();
    expect(canvasPixels(sprite.render())[4000]).toBe(BLUE);
  }
});


test('canvas-sized brush overrides use trimmed content bounds, including groups and temporary oversized previews', () => {
  const sprite = new Sprite(4096, 1);
  sprite.layers[0].cels[0] = { x: 2, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  sprite.setLayerEffects([outline()]);
  const data = new Uint32Array(4096); data[2] = RED; data[3] = RED;
  expect(() => sprite.render(0, undefined, { layer: 0, data })).not.toThrow();
  expect(canvasPixels(sprite.render(0, undefined, { layer: 0, data }))[4]).toBe(BLUE);
  data[0] = RED; data[4095] = RED; // proposed stroke exceeds FX output; preview uses bounded source fallback
  expect(() => sprite.render(0, undefined, { layer: 0, data })).not.toThrow();
  expect(canvasPixels(sprite.render(0, undefined, { layer: 0, data }))[4]).toBe(0);
  sprite.layers[0].depth = 1;
  sprite.layers.push({ ...newLayer('Group', 1), group: true, effects: [outline({ id: 'group' })] });
  data[0] = 0; data[4095] = 0;
  expect(() => sprite.render(0, undefined, { layer: 0, data })).not.toThrow();
  expect(canvasPixels(sprite.render(0, undefined, { layer: 0, data }))[5]).toBe(BLUE);
  data[0] = RED; data[4095] = RED;
  expect(() => sprite.render(0, undefined, { layer: 0, data })).not.toThrow();
  data.fill(0); expect(canvasPixels(sprite.render(0, undefined, { layer: 0, data })).every(pixel => pixel === 0)).toBe(true);
});


test('GIF/video exports include ordered Outline pixels and match bounded live fallback after source growth', async () => {
  const sprite = new Sprite(5, 5);
  sprite.layers[0].cels[0] = { x: 2, y: 2, w: 1, h: 1, data: new Uint32Array([RED]) };
  sprite.setLayerEffects([fx('before', .5), outline()]);
  const args = { raw: sprite.captureDocument(), base: 'Outline', frames: [0], areas: { 0: sprite.canvasRect }, grid: { gridW: 1, gridH: 1, gridX: 0, gridY: 0 } };
  const video = await prepareExport({ ...args, opts: { kind: 'webm', scale: 1 } }) as VideoExport;
  expect(Array.from(video.frames[0].data)).toEqual(Array.from(new Uint8ClampedArray(pixels(sprite)[0].buffer)));
  const gif = await prepareExport({ ...args, opts: { kind: 'gif', scale: 1 } });
  if (!Array.isArray(gif)) throw new Error('Expected GIF');
  const decoded = decodeGif(new Uint8Array(await gif[0].blob.arrayBuffer()));
  expect(decoded.frames[0].data[2 * 5 + 1]).toBe(BLUE);
  sprite.width = 4096; sprite.height = 1;
  sprite.setCel({ x: 0, y: 0, w: 4096, h: 1, data: new Uint32Array(4096).fill(RED) });
  const fallback = await prepareExport({ ...args, raw: sprite.captureDocument(), areas: { 0: sprite.canvasRect }, opts: { kind: 'webm', scale: 1 } }) as VideoExport;
  expect(Array.from(fallback.frames[0].data)).toEqual(Array.from(new Uint8ClampedArray(pixels(sprite)[0].buffer)));
});

test('colored Outline promotes grayscale bake/export to RGB while opacity-only grayscale retains its mode', async () => {
  for (const group of [false, true]) for (const colored of [false, true]) {
    const sprite = new Sprite(5, 5), gray = packRgba(120, 120, 120, 255);
    sprite.layers[0].cels[0] = createCelInstance(createImage(1, 1, new Uint32Array([gray])), { x: 2, y: 2 });
    if (group) {
      sprite.layers[0].depth = 1;
      sprite.layers.push({ ...newLayer('Group', 1), group: true }); sprite.layer = 1;
    }
    sprite.colorMode = 'gray';
    sprite.setLayerEffects(colored ? [outline()] : [fx()]);
    const saved = sprite.toJSON(), expected = pixels(sprite), doc = sprite.toDocument();
    expect(doc.colorMode).toBe(colored ? 'rgb' : 'gray');
    const exported = new Sprite(); exported.fromDocument(await decodeAseprite(await encodeAseprite(doc)));
    expect(pixels(exported)).toEqual(expected); expect(sprite.toJSON()).toEqual(saved);
    sprite.bakeLayerEffects(); expect(String(sprite.colorMode)).toBe(colored ? 'rgb' : 'gray'); expect(pixels(sprite)).toEqual(expected);
    sprite.undo(); expect(sprite.toJSON()).toEqual(saved);
  }
});
