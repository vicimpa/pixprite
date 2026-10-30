import { beforeAll, expect, mock, test } from 'bun:test';
import { installSoftwareCanvas, canvasPixels } from './Canvas.test-helper';
import { applyLayerMask, createCelInstance, createImage, createLayerMask, layerMaskAlpha, imageOf, type LayerMask } from './DocumentModel';
import { documentContext, decodeCapture, encodeCapture } from './BackgroundDocument';
import { IncrementalDocument } from './IncrementalDocument';
import { migratePixpriteV6 } from './SpriteValidation';
import { retainedHistoryMemory } from './SpriteHistory';
import type { SpriteContext } from './SpriteContext';
import { Mask } from './Mask';
import { prepareExport } from './ExportPreparation';
import { decodeGif } from './formats/GifDecode';
beforeAll(installSoftwareCanvas);
mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite } = await import('./Sprite');
const RED = 0xff0000ff, BLUE = 0xffff0000, WHITE = 0xffffffff, BLACK = 0xff000000;
const alphaMask = (values: number[], options: Partial<LayerMask> = {}) => createLayerMask(createImage(values.length, 1, Uint32Array.from(values, a => (a << 24) >>> 0)), options);
const pixels = (sprite: InstanceType<typeof Sprite>, frame = 0) => [...canvasPixels(sprite.render(frame))];
function fixture() {
  const sprite = new Sprite(3, 1), image = createImage(3, 1, new Uint32Array([RED, RED, RED]));
  sprite.setCel(createCelInstance(image)); sprite.addFrame();
  return { sprite, cel: sprite.getCel()!, image };
}

test('post-FX mask multiplies alpha once in sprite coordinates, including outside, inversion and zero-alpha RGB', () => {
  const source = { x: -1, y: 0, w: 5, h: 1, data: new Uint32Array([RED, RED, RED, RED, 0x00ffffff]) };
  const mask = alphaMask([0, 128, 255], { outside: 64 });
  expect([...applyLayerMask(source, mask)!.data]).toEqual([0x400000ff, 0, 0x800000ff, RED, 0]);
  expect(layerMaskAlpha(createLayerMask(mask.image, { ...mask, inverted: true }), -1, 0)).toBe(191);
  expect(applyLayerMask(source, createLayerMask(mask.image, { enabled: false }))).toBe(source);
  expect([...mask.image.data]).toEqual([0, 0x80000000, BLACK]);
  mask.image.data.fill(0); expect(layerMaskAlpha(mask, 2, 0)).toBe(255);
});

test('mask writes preserve transformed continuous source links, alpha lock, off-canvas data and resource identity on toggles', () => {
  const { sprite, image, cel } = fixture();
  sprite.layers[0].lockAlpha = true;
  sprite.createLayerMask();
  const maskImage = sprite.current.mask!.image, checkpoint = sprite.historyPosition;
  sprite.updateLayerMask({ inverted: true });
  expect(sprite.current.mask!.image).toBe(maskImage);
  sprite.updateLayerMask({ enabled: false }); expect(sprite.current.mask!.image).toBe(maskImage);
  sprite.updateLayerMask({ enabled: true });
  sprite.checkpoint('Paint mask'); sprite.putLayerMaskPixels(new Uint32Array([WHITE, BLACK, 0xff808080]));
  expect([...sprite.layerMaskPixels()]).toEqual([WHITE, BLACK, 0xff808080]);
  expect(sprite.getCel(0, 0)).toBe(cel); expect(sprite.getCel(0, 1)).toBe(cel); expect(imageOf(cel)).toBe(image);
  expect(pixels(sprite)).toEqual([RED, 0, 0x800000ff]);
  sprite.undo(); expect(sprite.current.mask!.image).toBe(maskImage); expect(pixels(sprite)).toEqual([0, 0, 0]);
  sprite.rollback(checkpoint); expect(pixels(sprite)).toEqual([RED, RED, RED]);
  // All color accessors keep reading color while mask editing is active.
  expect([...sprite.canvasPixels()]).toEqual([RED, RED, RED]);
  sprite.putCanvas(new Uint32Array([BLUE, BLUE, BLUE]));
  expect([...sprite.current.mask!.image.data]).toEqual([BLACK, BLACK, BLACK]);
  expect([...sprite.getCel()!.data]).toEqual([BLUE, BLUE, BLUE]);
});

test('mask factories snapshot selection, another layer alpha, and exact RGB including transparent-color semantics', () => {
  const { sprite } = fixture();
  sprite.setMask(Mask.rect(3, 1, { x: 1, y: 0, w: 1, h: 1 }));
  expect(sprite.createLayerMask('selection')).toBe(true); expect(pixels(sprite)).toEqual([0, RED, 0]);
  expect(sprite.current.mask!.outside).toBe(0);
  sprite.addLayer(); sprite.setCel({ x: 0, y: 0, w: 3, h: 1, data: new Uint32Array([0x800000ff, BLUE, 0]) });
  sprite.setLayerEffects([{ id: 'alpha', type: 'opacity', enabled: true, amount: .5 }]);
  sprite.layer = 0;
  expect(sprite.createLayerMask('alpha', 1)).toBe(true);
  expect([...sprite.layerMaskPixels()]).toEqual([0xff404040, 0xff808080, BLACK]);
  sprite.layers[1].visible = false; expect(pixels(sprite)).toEqual([0x400000ff, 0x800000ff, 0]);
  sprite.setCel({ x: 0, y: 0, w: 3, h: 1, data: new Uint32Array([0x800000ff, BLUE, 0x000000ff]) });
  sprite.createLayerMask('color', -1, RED); expect([...sprite.layerMaskPixels()]).toEqual([WHITE, BLACK, BLACK]);
  sprite.updateLayerMask({ inverted: true }); expect([...sprite.layerMaskPixels()]).toEqual([BLACK, WHITE, WHITE]);
  sprite.createLayerMask('color', -1, 0); expect([...sprite.layerMaskPixels()]).toEqual([BLACK, BLACK, WHITE]);
  const before = sprite.toJSON(); expect(sprite.createLayerMask('alpha', 0)).toBe(false); expect(sprite.toJSON()).toEqual(before);
});

test('channel switch cancels floating color changes; locks and selection protect explicit mask edits and clear', () => {
  const { sprite, cel } = fixture();
  sprite.createLayerMask(); sprite.setEditingChannel('color');
  sprite.selectAll(); sprite.liftSelection(); expect(sprite.floating).not.toBeNull();
  sprite.setEditingChannel('mask'); expect(sprite.floating).toBeNull(); expect(sprite.getCel()).toBe(cel);
  sprite.setMask(Mask.rect(3, 1, { x: 1, y: 0, w: 1, h: 1 })); sprite.clearSelection();
  expect([...sprite.layerMaskPixels()]).toEqual([WHITE, BLACK, WHITE]); expect(sprite.getCel()).toBe(cel);
  sprite.undo(); expect([...sprite.layerMaskPixels()]).toEqual([WHITE, WHITE, WHITE]);
  sprite.current.locked = true;
  const before = sprite.toJSON(), depth = sprite.undoDepth;
  expect(sprite.putLayerMaskPixels(new Uint32Array(3))).toBe(false); expect(sprite.updateLayerMask({ inverted: true })).toBe(false);
  expect(sprite.createLayerMask()).toBe(false); expect(sprite.toJSON()).toEqual(before); expect(sprite.undoDepth).toBe(depth);
  sprite.current.locked = false; sprite.addGroup(); sprite.layers[0].depth = 1; sprite.createLayerMask();
  const child = sprite.layers[0].cels[0]; sprite.putLayerMaskPixels(new Uint32Array([BLACK, WHITE, BLACK]));
  expect(sprite.layers[0].cels[0]).toBe(child); sprite.current.locked = true; sprite.layer = 0;
  expect(sprite.putLayerMaskPixels(new Uint32Array(3))).toBe(false);
});

test('nested masks compose after FX and group FX bake excludes own mask, includes descendant masks, with partial-frame undo', () => {
  const { sprite } = fixture();
  sprite.layers[0].mask = alphaMask([255, 128, 255]);
  sprite.addGroup();
  sprite.layers[0].depth = 1;
  sprite.layers[1].mask = alphaMask([128, 255, 0]);
  sprite.setLayerEffects([{ id: 'half', type: 'opacity', enabled: true, amount: .5 }]);
  sprite.frame = 0;
  const before = sprite.toJSON(), first = pixels(sprite, 0), second = pixels(sprite, 1);
  expect(first).toEqual([0x400000ff, 0x400000ff, 0]);
  const ownImage = sprite.current.mask!.image;
  sprite.bakeLayerEffects('frame');
  expect(sprite.current.mask!.image).toBe(ownImage); expect(sprite.layers).toHaveLength(3);
  expect(pixels(sprite, 0)).toEqual(first); expect(pixels(sprite, 1)).toEqual(second);
  expect(sprite.layers[1].cels[1]).toBeNull(); expect(sprite.layers[1].cels[0]!.data[0] >>> 24).toBe(128);
  sprite.undo(); expect(sprite.toJSON()).toEqual(before); sprite.redo(); expect(pixels(sprite, 0)).toEqual(first);
  const ase = sprite.toDocument(), imported = new Sprite(); imported.fromDocument(ase);
  expect(pixels(imported, 0)).toEqual(first); expect(pixels(imported, 1)).toEqual(second);
});

test('standalone FX bake and destructive merge do not double-mask; indexed tilemap exports rasterize, grayscale alpha stays gray', () => {
  const { sprite } = fixture(); sprite.layers[0].mask = alphaMask([128, 255, 0]);
  sprite.setLayerEffects([{ id: 'half', type: 'opacity', enabled: true, amount: .5 }]);
  const before = pixels(sprite); sprite.bakeLayerEffects(); expect(pixels(sprite)).toEqual(before);
  sprite.addLayer(); sprite.setCel({ x: 2, y: 0, w: 1, h: 1, data: new Uint32Array([BLUE]) });
  const merged = pixels(sprite); sprite.mergeDown(); expect(pixels(sprite)).toEqual(merged); expect(sprite.current.mask).toBeUndefined();
  const tile = new Sprite(2, 1); tile.addTilemapLayer(1, 1); tile.setCel({ x: 0, y: 0, w: 2, h: 1, data: new Uint32Array([RED, RED]) });
  tile.current.mask = alphaMask([128, 0]); tile.colorMode = 'indexed';
  const doc = tile.toDocument(); expect(doc.colorMode).toBe('rgb'); expect(doc.layers[1].tileset).toBe(-1); expect(doc.layers[1].cels[0]!.tiles).toBeUndefined();
  expect([...doc.layers[1].cels[0]!.data]).toEqual([0x800000ff, 0]); expect(tile.current.tileset).toBeGreaterThanOrEqual(0);
  tile.colorMode = 'gray'; expect(tile.toDocument().colorMode).toBe('gray');
});

test('mask-only resources survive v7 file, worker capture and async load; invalid v7/v8 documents refuse atomically', async () => {
  const { sprite } = fixture(); sprite.createLayerMask(); sprite.putLayerMaskPixels(new Uint32Array([WHITE, BLACK, 0xff808080]));
  sprite.updateLayerMask({ inverted: true, enabled: false });
  const json = sprite.toJSON(); expect(json.version).toBe(7); expect(json.images).toHaveLength(2);
  const capture = sprite.captureDocument(); expect(capture.images).toHaveLength(2); expect(encodeCapture(capture)).toEqual(json);
  const decoded = decodeCapture(json); expect(documentContext(decoded).layers[0].mask?.image.kind).toBe('image');
  const loaded = new Sprite(); await loaded.loadAsync(json); expect(loaded.toJSON()).toEqual(json);
  for (const patch of [{ image: { kind: 'image', id: 'missing' } }, { outside: 256 }, { enabled: 1 }, { inverted: 'yes' }, { x: .5 }]) {
    const bad = structuredClone(json); Object.assign(bad.layers[0].mask!, patch);
    expect(() => loaded.load(bad)).toThrow(); expect(loaded.toJSON()).toEqual(json);
  }
  expect(() => loaded.load({ ...json, version: 6 })).toThrow('require pixprite version 7');
  expect(() => loaded.load({ ...json, version: 8 })).toThrow('Newer pixprite version: 8; supported up to 7');
  const v6 = structuredClone(json); v6.version = 6; delete v6.layers[0].mask;
  expect(migratePixpriteV6(v6)).toEqual({ ...v6, version: 7 }); expect(v6.version).toBe(6);
  loaded.load(v6); expect(loaded.current.mask).toBeUndefined(); expect(pixels(loaded)).toEqual([RED, RED, RED]);
});

test('incremental capture reuses immutable mask resources across invert/enable and dirties only mask painting', () => {
  const { sprite } = fixture(); sprite.createLayerMask(); const cache = new IncrementalDocument();
  let capture = cache.capture(sprite, false); expect(capture.dirtyResources).toBe(2); capture.accept(encodeCapture(capture.raw), '');
  const sourceImage = imageOf(sprite.getCel()!);
  sprite.updateLayerMask({ inverted: true }); capture = cache.capture(sprite, false); expect(capture.dirtyResources).toBe(0); capture.accept(encodeCapture(capture.raw), '');
  sprite.updateLayerMask({ enabled: false }); expect(cache.capture(sprite, false).dirtyResources).toBe(0);
  sprite.putLayerMaskPixels(new Uint32Array([BLACK, WHITE, BLACK])); capture = cache.capture(sprite, false); expect(capture.dirtyResources).toBe(1);
  expect(imageOf(sprite.getCel()!)).toBe(sourceImage); capture.accept(encodeCapture(capture.raw), ''); expect(cache.capture(sprite, false).dirtyResources).toBe(0);
});

test('history counts private mask buffers once, never materializes image copies, and restores immutable layer clipboard masks', () => {
  const { sprite } = fixture(); sprite.createLayerMask(); const mask = sprite.current.mask!;
  sprite.updateLayerMask({ inverted: true }); expect(retainedHistoryMemory.call(sprite as unknown as SpriteContext).uniqueBufferBytes).toBe(0);
  sprite.checkpoint('Mask paint'); sprite.putLayerMaskPixels(new Uint32Array([BLACK, WHITE, WHITE]));
  expect(retainedHistoryMemory.call(sprite as unknown as SpriteContext).uniqueBufferBytes).toBe(12); expect(sprite.current.mask!.image).not.toBe(mask.image);
  sprite.undo(); expect(sprite.current.mask!.image).toBe(mask.image); sprite.redo();
  sprite.range = { type: 'layers', layers: [0, 0], frames: [0, 1] };
  const clip = sprite.copyRange()!; sprite.pasteRange(clip); const copy = sprite.current.mask!;
  expect(copy.image).toBe(sprite.layers[0].mask!.image); sprite.putLayerMaskPixels(new Uint32Array([WHITE, WHITE, WHITE]));
  expect(sprite.current.mask!.image).not.toBe(copy.image); expect(sprite.layers[0].mask!.image).toBe(copy.image);
  sprite.releaseEditorMemory(); expect(retainedHistoryMemory.call(sprite as unknown as SpriteContext).uniqueBufferBytes).toBe(0);
});

test('canvas moves, resize/crop, flip, rotate and scale carry mask coordinates while canvas enlargement keeps outside coverage', () => {
  const { sprite } = fixture(); sprite.layers[0].mask = alphaMask([255, 128, 0], { outside: 0 });
  sprite.canvasSize(5, 1, 1, 0); expect(sprite.current.mask!.x).toBe(1); expect(pixels(sprite)).toEqual([0, RED, 0x800000ff, 0, 0]);
  sprite.flipSprite('h'); expect(sprite.current.mask!.x).toBe(1); expect(pixels(sprite)).toEqual([0, 0, 0x800000ff, RED, 0]);
  sprite.rotateSprite(1); expect(sprite.current.mask!.image.h).toBe(3); expect(pixels(sprite)).toEqual([0, 0, 0x800000ff, RED, 0]);
  sprite.scaleSprite(2, 10); expect(sprite.current.mask!.image.w).toBe(2); expect(sprite.current.mask!.image.h).toBe(6);
  sprite.selectAll(); sprite.cropToSelection(); expect(sprite.current.mask!.outside).toBe(0);
  const source = sprite.toJSON(); const loaded = new Sprite(); loaded.load(source); expect(pixels(loaded)).toEqual(pixels(sprite));
});

test('grayscale editor view and channel selection never contaminate worker/video/GIF exports or saved color cels', async () => {
  const { sprite, cel } = fixture(); sprite.layers[0].mask = alphaMask([255, 0, 255]);
  sprite.setEditingChannel('mask'); sprite.maskView = true;
  expect([...canvasPixels(sprite.renderEditor())]).toEqual([WHITE, BLACK, WHITE]);
  expect(pixels(sprite)).toEqual([RED, 0, RED]); expect(sprite.getCel()).toBe(cel);
  const raw = sprite.captureDocument(), request = { raw, base: 'masked', frames: [0, 1], areas: { 0: sprite.canvasRect, 1: sprite.canvasRect }, grid: { gridW: 1, gridH: 1, gridX: 0, gridY: 0 } };
  const worker = documentContext(raw); expect([...canvasPixels(worker.render(0))]).toEqual(pixels(sprite));
  const video = await prepareExport({ ...request, opts: { kind: 'webm', scale: 1 } }) as any;
  expect([...new Uint32Array(video.frames[0].data.buffer)]).toEqual(pixels(sprite));
  const gif = await prepareExport({ ...request, opts: { kind: 'gif', scale: 1 } }) as any;
  const decoded = decodeGif(new Uint8Array(await gif[0].blob.arrayBuffer()));
  expect([...decoded.frames[0].data]).toEqual(pixels(sprite));
  const before = sprite.toJSON(); sprite.maskView = false; sprite.setEditingChannel('color'); expect(sprite.toJSON()).toEqual(before);
});


test('background conversion consumes a semitransparent mask once and undo restores editable source/mask', () => {
  const { sprite, cel } = fixture(); sprite.layers[0].mask = alphaMask([128, 255, 0]);
  const before = sprite.toJSON(), mask = sprite.current.mask;
  sprite.layerToBackground(); expect(sprite.current.mask).toBeUndefined(); expect(sprite.current.background).toBe(true);
  expect(pixels(sprite)).toEqual([0xff7f7fff, RED, WHITE]);
  sprite.undo(); expect(sprite.toJSON()).toEqual(before); expect(sprite.current.mask).toBe(mask); expect(sprite.getCel()).toBe(cel);
});

test('valid distant masks refuse unrepresentable painting before history/source mutation and keep editor previews bounded', () => {
  const sprite = new Sprite(4096, 1); sprite.setCel(createCelInstance(createImage(1, 1, new Uint32Array([RED]))));
  sprite.layers[0].mask = createLayerMask(createImage(4096, 1, new Uint32Array(4096).fill(BLACK)), { x: 4096, outside: 255 });
  sprite.setEditingChannel('mask'); expect(sprite.maskBoundsNotice).toBe(true); expect(sprite.editable).toBe(false);
  const before = sprite.toJSON(), depth = sprite.undoDepth;
  expect(() => sprite.renderEditor({ layer: 0, data: new Uint32Array(4096).fill(WHITE) })).not.toThrow();
  expect(sprite.putLayerMaskPixels(new Uint32Array(4096))).toBe(false); sprite.clearSelection();
  expect(sprite.toJSON()).toEqual(before); expect(sprite.undoDepth).toBe(depth);
  sprite.createLayerMask(); expect(sprite.maskBoundsNotice).toBe(false); expect(sprite.editable).toBe(true);
});


test('creating from a floating selection captures its current shape while cancellation restores source pixels', () => {
  const { sprite, cel } = fixture();
  sprite.liftSelection(); sprite.moveFloating(1, 0);
  expect(sprite.mask!.has(0, 0)).toBe(false); expect(sprite.mask!.has(1, 0)).toBe(true);
  expect(sprite.createLayerMask('selection')).toBe(true);
  expect(sprite.floating).toBeNull(); expect(sprite.getCel()).toBe(cel);
  expect([...sprite.layerMaskPixels()]).toEqual([BLACK, WHITE, WHITE]);
});

test('mask scale metadata preflight refuses oversized output before allocation, floating commit, color changes or undo', () => {
  const sprite = new Sprite(1, 1); sprite.setCel(createCelInstance(createImage(1, 1, new Uint32Array([RED]))));
  const mask = createLayerMask(createImage(4096, 1, new Uint32Array(4096).fill(BLACK))); sprite.layers[0].mask = mask;
  sprite.liftSelection();
  const before = sprite.layers, history = sprite.history.slice(), version = sprite.version, floating = sprite.floating;
  expect(sprite.scaleSprite(4096, 1)).toBe(false);
  expect(sprite.layers).toBe(before); expect(sprite.history).toEqual(history); expect(sprite.version).toBe(version);
  expect(sprite.current.mask).toBe(mask); expect(sprite.floating).toBe(floating);
  expect(sprite.canvasSize(2, 1, Infinity, 0)).toBe(false); expect(sprite.layers).toBe(before);
  sprite.cancelFloating(); sprite.canvasSize(2, 1, 1, 0, true); sprite.scaleSprite(4, 1);
  expect(sprite.width).toBe(4); expect(sprite.current.mask!.image.w).toBe(4);
});
