import { beforeAll, expect, mock, test } from 'bun:test';
import { canvasPixels, installSoftwareCanvas } from './Canvas.test-helper';
import { packRgba } from './Image';
import { decodeAseprite, encodeAseprite } from './formats/Aseprite';
import { renderTiles } from './Tilemap';
import { isCelInstance, retainedBufferIdentity, visitCelBuffers } from './DocumentModel';
import { retainedHistoryMemory } from './SpriteHistory';
import type { SpriteContext } from './SpriteContext';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite, createImage, createCelInstance, imageOf, transformCel, bakeCel } = await import('./Sprite');
beforeAll(installSoftwareCanvas);

test('history diagnostics deduplicate private source/bitmap storage and never materialize cels', () => {
  const sprite = new Sprite(2, 1);
  const shared = createImage(2, 1, new Uint32Array([0xff000001, 0xff000002]));
  const a = createCelInstance(shared), b = createCelInstance(shared, { x: 1 });
  sprite.layers[0].cels = [a, b];
  sprite.frames = [{ duration: 100 }, { duration: 100 }];
  sprite.checkpoint('shared');
  sprite.layers[0].cels = [createCelInstance(createImage(2, 1, new Uint32Array([0xff000003, 0xff000004]))), null];
  const retained = () => retainedHistoryMemory.call(sprite as unknown as SpriteContext);
  const before = retained();
  expect(before.uniqueBufferBytes).toBe(8);
  expect(before.metadataPayloadBytes).toBeGreaterThan(0);
  expect(retained()).toEqual(before);
  let allocated = 0;
  visitCelBuffers(a, (_, bytes) => { allocated += bytes; });
  expect(allocated).toBe(8); // No bitmap was created by the measurement.
  void a.data;
  expect(retained().uniqueBufferBytes).toBe(16); // Existing private bitmap now counted.
  const tokens: object[] = [];
  visitCelBuffers(a, identity => { tokens.push(identity); });
  expect(tokens.every(identity => !(identity instanceof ArrayBuffer))).toBe(true);
  expect(tokens).toContain(retainedBufferIdentity(a.data.buffer));
  sprite.undo();
  expect(retained().uniqueBufferBytes).toBe(8); // Shared live sources are excluded.
});

const RED = packRgba(255, 0, 0, 255), GREEN = packRgba(0, 255, 0, 255), BLUE = packRgba(0, 0, 255, 255);
const copyJSON = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function sharedDocument() {
  const image = createImage(2, 1, new Uint32Array([RED, GREEN]));
  const first = createCelInstance(image);
  const second = createCelInstance(image, { x: 2 });
  const sprite = new Sprite(4, 2);
  sprite.frames = [{ duration: 100 }, { duration: 100 }];
  sprite.layers[0].cels = [first, second];
  sprite.layers[0].celOpacity = [1, 1];
  return { sprite, image, first, second };
}

test('independent instances share immutable sources while flips, quarter-turns and opacity bake exactly', () => {
  const input = new Uint32Array([RED, GREEN]);
  const source = createImage(2, 1, input);
  input[0] = BLUE;
  source.data[1] = BLUE;
  const original = createCelInstance(source);
  const placed = createCelInstance(source, { x: -1, y: 2, flipX: true, rotation: 90, opacity: 0.5 });
  expect(placed.asset).toEqual({ kind: 'image', id: source.id });
  expect(placed.image).toBe(original.image);
  expect([placed.x, placed.y, placed.w, placed.h]).toEqual([-1, 2, 1, 2]);
  expect([...placed.data]).toEqual([packRgba(0, 255, 0, 128), packRgba(255, 0, 0, 128)]);
  expect([...source.data]).toEqual([RED, GREEN]);
  expect([...original.data]).toEqual([RED, GREEN]);
  expect(bakeCel(placed)).toMatchObject({ x: -1, y: 2, w: 1, h: 2, data: placed.data });
});

test('index, set and ArrayBuffer writes detach only the private instance bitmap when saved', () => {
  for (const edit of [
    (data: Uint32Array) => { data[0] = BLUE; },
    (data: Uint32Array) => { data.set([BLUE]); },
    (data: Uint32Array) => { new DataView(data.buffer).setUint32(data.byteOffset, BLUE, true); },
  ]) {
    const { sprite, image, first, second } = sharedDocument();
    edit(first.data);
    sprite.touch();
    const saved = sprite.toJSON();
    expect([...image.data]).toEqual([RED, GREEN]);
    expect([...second.data]).toEqual([RED, GREEN]);
    expect(first.image).not.toBe(image);
    expect(first.transform).toEqual({ flipX: false, flipY: false, rotation: 0, opacity: 1 });
    const loaded = new Sprite(); loaded.load(copyJSON(saved));
    expect([...loaded.layers[0].cels[0]!.data]).toEqual([BLUE, GREEN]);
    expect([...loaded.layers[0].cels[1]!.data]).toEqual([RED, GREEN]);
    expect(sprite.toJSON()).toEqual(saved);
  }
});

test('v6 round-trip preserves resource sharing, per-instance transforms, continuous aliases and extension data', () => {
  const { sprite, image, first, second } = sharedDocument();
  first.ext = { unavailable: { version: 7, values: [null, true] } };
  sprite.layers[0].cels = [first, first, transformCel(second, { flipY: true, rotation: 270 })];
  sprite.frames.push({ duration: 250 }); sprite.layers[0].celOpacity.push(1);
  const saved = sprite.toJSON();
  expect(saved.images).toHaveLength(1);
  expect(saved.images[0].id).toBe(image.id);
  expect(saved.layers[0].cels[1]).toEqual({ link: 0 });
  const loaded = new Sprite(); loaded.load(copyJSON(saved));
  const [a, linked, b] = loaded.layers[0].cels;
  expect(a).toBe(linked);
  expect(a).not.toBe(b);
  expect(imageOf(a!)).toBe(imageOf(b!));
  expect(isCelInstance(b!) && b.transform.rotation).toBe(270);
  expect(a?.ext).toEqual(first.ext);
  expect(loaded.toJSON()).toEqual(saved);
});

test('normal pixel editing detaches one transformed instance, keeps continuous links, and undo restores both', () => {
  const { sprite, image, first, second } = sharedDocument();
  sprite.layers[0].cels = [first, first, second];
  sprite.frames.push({ duration: 100 }); sprite.layers[0].celOpacity.push(1);
  expect(sprite.setCelTransform({ rotation: 90 }, 0, 0)).toBe(true);
  const transformed = sprite.layers[0].cels[0];
  expect(transformed).toBe(sprite.layers[0].cels[1]);
  sprite.checkpoint('Paint');
  const pixels = sprite.canvasPixels(0, 0); pixels[0] = BLUE;
  sprite.putCanvas(pixels, 0, 0);
  expect(sprite.layers[0].cels[0]).toBe(sprite.layers[0].cels[1]);
  expect(sprite.layers[0].cels[2]).toBe(second);
  expect([...second.data]).toEqual([RED, GREEN]);
  expect([...image.data]).toEqual([RED, GREEN]);
  sprite.undo();
  expect(sprite.layers[0].cels[0]).toBe(transformed);
  sprite.undo(); expect(sprite.layers[0].cels[0]).toBe(first);
  sprite.redo(); expect(sprite.layers[0].cels[0]).toBe(transformed);
});

test('position-only moves and zero opacity keep resources and survive serialization without trimming', () => {
  const { sprite, image } = sharedDocument();
  sprite.setCelTransform({ rotation: 90, opacity: 0 });
  sprite.offsetCel(1, 1);
  const moved = sprite.getCel()!;
  expect(imageOf(moved)).toBe(image);
  expect([moved.x, moved.y, moved.w, moved.h]).toEqual([1, 1, 1, 2]);
  const saved = sprite.toJSON(), loaded = new Sprite(); loaded.load(saved);
  expect(loaded.getCel()).not.toBeNull();
  expect(loaded.toJSON()).toEqual(saved);
  expect(canvasPixels(loaded.render())).toEqual(new Uint32Array(8));
});

test('FX, instance transforms and Aseprite export use the same baked pixels without modifying sources', async () => {
  const { sprite, image } = sharedDocument();
  sprite.setCelTransform({ flipX: true, rotation: 90, opacity: 0.5 });
  const effects = [{ id: 'alpha', type: 'opacity' as const, enabled: true, amount: 0.5 }];
  sprite.setLayerEffects(effects);
  effects[0].amount = 0;
  const before = canvasPixels(sprite.render());
  expect(before[0]).toBe(packRgba(0, 255, 0, 64));
  const exported = await decodeAseprite(await encodeAseprite(sprite.toDocument()));
  const imported = new Sprite(); imported.fromDocument(exported);
  expect(canvasPixels(imported.render())).toEqual(before);
  expect(exported.layers[0]).not.toHaveProperty('effects');
  expect([...image.data]).toEqual([RED, GREEN]);
  const saved = sprite.toJSON(), loaded = new Sprite(); loaded.load(copyJSON(saved));
  expect(canvasPixels(loaded.render())).toEqual(before);
  expect(loaded.toJSON()).toEqual(saved);
  sprite.undo(); expect(sprite.layers[0].effects).toBeUndefined();
  sprite.redo(); expect(canvasPixels(sprite.render())).toEqual(before);
});

test('tilemap instance placement is rasterized for Aseprite and editing only bakes the chosen instance', async () => {
  const sprite = new Sprite(3, 3);
  const tileset = { name: 'Tiles', tw: 1, th: 1, baseIndex: 1, tiles: [new Uint32Array(1), new Uint32Array([RED]), new Uint32Array([GREEN]), new Uint32Array([BLUE])] };
  const refs = { cols: 2, rows: 1, refs: new Uint32Array([1, 2]) };
  const source = createImage(2, 1, renderTiles(tileset, refs));
  const cel = Object.assign(createCelInstance(source), { tiles: refs });
  const sibling = Object.assign(createCelInstance(source), { tiles: refs });
  sprite.tilesets = [tileset]; sprite.frames.push({ duration: 100 });
  sprite.layers[0].tileset = 0; sprite.layers[0].cels = [cel, sibling]; sprite.layers[0].celOpacity = [1, 1];
  sprite.setCelTransform({ rotation: 90, flipX: true, opacity: 0.5 });
  expect(sprite.tileAt(0, 0)).toBe(2);
  const before = canvasPixels(sprite.render());
  const exported = sprite.toDocument();
  expect(exported.layers[0].tileset).toBe(-1);
  expect(exported.layers[0].cels.every(c => !c?.tiles)).toBe(true);
  const imported = new Sprite(); imported.fromDocument(await decodeAseprite(await encodeAseprite(exported)));
  expect(canvasPixels(imported.render())).toEqual(before);
  const saved = sprite.toJSON(), loaded = new Sprite(); loaded.load(copyJSON(saved));
  expect(canvasPixels(loaded.render())).toEqual(before);
  sprite.setTileAt(0, 0, 3);
  expect(sprite.getCel()?.data[0]).toBe(BLUE);
  expect([...source.data]).toEqual([RED, GREEN]);
  expect([...sibling.data]).toEqual([RED, GREEN]);
});

test('resource references, payload lengths and transform/effect ranges are validated before replacing a document', () => {
  const { sprite } = sharedDocument();
  const saved = sprite.toJSON();
  const broken = (edit: (data: any) => void, message: string) => {
    const data = copyJSON(saved); edit(data);
    expect(() => sprite.load(data)).toThrow(message);
    expect(sprite.toJSON()).toEqual(saved);
  };
  broken(data => { data.layers[0].cels[0].image.id = 'absent'; }, 'Invalid image resource reference');
  broken(data => { data.images.push(data.images[0]); }, 'duplicate image resource ID');
  broken(data => { data.images[0].w = 0; }, 'Invalid image dimensions');
  broken(data => { data.images[0].d = ''; }, 'Invalid image pixel buffer length');
  broken(data => { data.layers[0].cels[0].opacity = 2; }, 'Invalid instance opacity');
  broken(data => { data.layers[0].cels[0].rotation = 45; }, 'Invalid cel rotation');
  broken(data => { data.layers[0].cels[0].flipX = 'yes'; }, 'Invalid cel reflection');
  broken(data => { data.layers[0].effects = [{ id: 'bad', type: 'opacity', enabled: true, amount: -1 }]; }, 'Invalid layer effect');
});

test('v4 placed images explicitly migrate through v5 resources into v6 and retain links and extension fields', () => {
  const data = { format: 'pixprite', version: 4, width: 2, height: 1, frames: [{ duration: 80 }, { duration: 120 }], layers: [{
    name: 'Legacy', cels: [{ x: -1, y: 0, w: 2, h: 1, d: btoa(String.fromCharCode(...new Uint8Array(new Uint32Array([RED, GREEN]).buffer))), ext: { absent: { note: 'preserved' } } }, { link: 0 }],
  }], ext: { document: [1, null] } };
  const sprite = new Sprite(); sprite.load(data);
  expect(sprite.getCel()).toBe(sprite.getCel(0, 1));
  expect([...sprite.getCel()!.data]).toEqual([RED, GREEN]);
  const saved = sprite.toJSON();
  expect(saved.version).toBe(6); expect(saved.images).toHaveLength(1);
  expect(saved.layers[0].cels[0]).toMatchObject({ x: -1, y: 0, image: { kind: 'image' }, ext: data.layers[0].cels[0]!.ext });
  expect(saved.ext).toEqual(data.ext);
});

test('legacy dimensions and fully transparent RGB do not destabilize resource IDs on repeated saves', () => {
  const sprite = new Sprite(2, 2), pixels = new Uint32Array([RED, 0x00abcdef]);
  sprite.frames.push({ duration: 100 }); sprite.layers[0].celOpacity.push(1);
  sprite.layers[0].cels = [{ x: 0, y: 0, w: 2, h: 1, data: pixels }, { x: 0, y: 0, w: 1, h: 2, data: pixels }];
  const saved = sprite.toJSON();
  expect(saved.images).toHaveLength(2);
  expect(sprite.toJSON()).toEqual(saved);
  const loaded = new Sprite(); loaded.load(copyJSON(saved));
  void loaded.getCel()!.data;
  expect(loaded.toJSON()).toEqual(saved);
});

test('all quarter turns and reflections use the same source without accumulating raster changes', () => {
  const image = createImage(2, 2, new Uint32Array([RED, GREEN, BLUE, 0]));
  const expected = [
    [RED, GREEN, BLUE, 0], [BLUE, RED, 0, GREEN], [0, BLUE, GREEN, RED], [GREEN, 0, RED, BLUE],
  ];
  ([0, 90, 180, 270] as const).forEach((rotation, index) => {
    const cel = createCelInstance(image, { rotation });
    expect([...cel.data]).toEqual(expected[index]);
    const reset = transformCel(cel, { rotation: 0 });
    expect(reset.image).toBe(image);
    expect([...reset.data]).toEqual(expected[0]);
  });
  expect([...createCelInstance(image, { flipX: true }).data]).toEqual([GREEN, RED, 0, BLUE]);
  expect([...createCelInstance(image, { flipY: true }).data]).toEqual([BLUE, 0, RED, GREEN]);
});

test('floating preview applies effects after compositing and stays identical after drop', () => {
  const sprite = new Sprite(2, 1);
  sprite.setCel({ x: 0, y: 0, w: 2, h: 1, data: new Uint32Array([RED, GREEN]) });
  sprite.setLayerEffects([{ id: 'opacity', type: 'opacity', enabled: true, amount: 0.5 }]);
  sprite.paste({ w: 1, h: 1, data: new Uint32Array([BLUE]) }, { x: 0, y: 0 });
  expect(sprite.floating).not.toBeNull();
  const preview = canvasPixels(sprite.render());
  sprite.dropFloating();
  expect(canvasPixels(sprite.render())).toEqual(preview);
});

test('group opacity effects render/export consistently and merge-down does not apply baked effects twice', async () => {
  const sprite = new Sprite(1, 1);
  sprite.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) });
  sprite.setLayerEffects([{ id: 'opacity', type: 'opacity', enabled: true, amount: 0.5 }]);
  sprite.addLayer();
  const before = canvasPixels(sprite.render());
  sprite.mergeDown();
  expect(canvasPixels(sprite.render())).toEqual(before);
  expect(sprite.layers[0].effects).toEqual([]);
  sprite.undo();
  sprite.range = { type: 'layers', layers: [0, 1], frames: [0, 0] };
  sprite.addGroup();
  sprite.setLayerEffects([{ id: 'group-opacity', type: 'opacity', enabled: true, amount: 0.5 }]);
  const grouped = canvasPixels(sprite.render());
  const imported = new Sprite(); imported.fromDocument(await decodeAseprite(await encodeAseprite(sprite.toDocument())));
  expect(canvasPixels(imported.render())).toEqual(grouped);
});

test('indexed export promotes baked instance/FX alpha to RGB rather than losing opacity in palette lookup', async () => {
  const sprite = new Sprite(1, 1);
  const image = createImage(1, 1, new Uint32Array([RED]));
  sprite.layers[0].cels = [createCelInstance(image, { opacity: 0.5 })];
  sprite.colorMode = 'indexed';
  sprite.framePalettes = [{ frame: 0, colors: ['#ff0000'] }];
  sprite.setLayerEffects([{ id: 'alpha', type: 'opacity', enabled: true, amount: 0.5 }]);
  const before = canvasPixels(sprite.render());
  const exported = sprite.toDocument();
  const imported = new Sprite(); imported.fromDocument(await decodeAseprite(await encodeAseprite(exported)));
  expect(canvasPixels(imported.render())).toEqual(before);
  expect(exported.colorMode).toBe('rgb');
  expect(sprite.colorMode).toBe('indexed');
  expect(sprite.toJSON().colorMode).toBe('indexed');
});
