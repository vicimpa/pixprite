import { expect, mock, test } from 'bun:test';
import { documentPixelRatio, pixelRatio } from './PixelRatio';
import { decodeCapture, encodeCapture } from './BackgroundDocument';
import { decodeAseprite, encodeAseprite } from './formats/Aseprite';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite } = await import('./Sprite');

test('pixel shapes normalize equivalent ratios and reject invalid components', () => {
  expect(pixelRatio(4, 2)).toEqual([2, 1]);
  expect(pixelRatio(4, 5)).toEqual([4, 5]);
  expect(pixelRatio(8, 7)).toEqual([8, 7]);
  expect(pixelRatio(255, 255)).toEqual([1, 1]);
  for (const pair of [[0, 1], [-1, 1], [256, 1], [1, NaN], [1.5, 2]]) expect(() => pixelRatio(...pair as [number, number])).toThrow();
  expect(documentPixelRatio({})).toEqual([1, 1]);
  expect(documentPixelRatio({ asepriteWarnings: [{ kind: 'pixelRatio', detail: '2:1' }] })).toEqual([2, 1]);
});

test('changing pixel shape is undoable and leaves logical pixels, dimensions and positions intact', () => {
  const doc = new Sprite(4, 3);
  doc.setCel({ x: 1, y: 1, w: 1, h: 1, data: new Uint32Array([0xff0080ff]) });
  const before = doc.toJSON();
  doc.setPixelRatio(2, 1);
  expect([doc.width, doc.height, doc.pixelRatioX, doc.pixelRatioY]).toEqual([4, 3, 2, 1]);
  expect(doc.toJSON().images).toEqual(before.images);
  expect(doc.toJSON().layers).toEqual(before.layers);
  doc.undo(); expect([doc.pixelRatioX, doc.pixelRatioY]).toEqual([1, 1]);
  doc.redo(); expect([doc.pixelRatioX, doc.pixelRatioY]).toEqual([2, 1]);
  expect(doc.toJSON().images).toEqual(before.images);
  const depth = doc.undoDepth; doc.setPixelRatio(4, 2); expect(doc.undoDepth).toBe(depth);
});

test('whole-canvas quarter turns also turn the pixel shape, with undo restoring it', () => {
  const doc = new Sprite(4, 3); doc.setPixelRatio(2, 1);
  doc.rotateSprite(1);
  expect([doc.width, doc.height, doc.pixelRatioX, doc.pixelRatioY]).toEqual([3, 4, 1, 2]);
  doc.undo(); expect([doc.width, doc.height, doc.pixelRatioX, doc.pixelRatioY]).toEqual([4, 3, 2, 1]);
});

test('native storage and worker captures preserve ratio metadata and migrate earlier import diagnostics', () => {
  const doc = new Sprite(4, 3); doc.setPixelRatio(4, 5);
  const loaded = new Sprite(); loaded.load(encodeCapture(decodeCapture(doc.toJSON())));
  expect([loaded.pixelRatioX, loaded.pixelRatioY]).toEqual([4, 5]);
  const legacy = { ...new Sprite(2, 2).toJSON(), asepriteWarnings: [{ kind: 'pixelRatio', detail: '2:1' }, { kind: 'unknownChunk', detail: '0xbeef' }] };
  loaded.load(legacy);
  expect([loaded.pixelRatioX, loaded.pixelRatioY]).toEqual([2, 1]);
  expect(loaded.asepriteWarnings).toEqual([{ kind: 'unknownChunk', detail: '0xbeef' }]);
  for (const ratio of [{ pixelRatioX: 0, pixelRatioY: 1 }, { pixelRatioX: 1 }, { pixelRatioX: 256, pixelRatioY: 1 }])
    expect(() => loaded.load({ ...doc.toJSON(), ...ratio, pixelRatioY: 'pixelRatioY' in ratio ? ratio.pixelRatioY : undefined })).toThrow('Pixel ratio');
});

test('aseprite headers preserve non-square pixel shape and older zero values mean square pixels', async () => {
  const doc = new Sprite(4, 3); doc.setPixelRatio(8, 7);
  const bytes = await encodeAseprite(doc.toDocument());
  expect([bytes[34], bytes[35]]).toEqual([8, 7]);
  const loaded = await decodeAseprite(bytes);
  expect([loaded.width, loaded.height, loaded.pixelRatioX, loaded.pixelRatioY]).toEqual([4, 3, 8, 7]);
  expect(loaded.warnings).toBeUndefined();
  expect(await encodeAseprite(loaded)).toEqual(bytes);
  bytes[34] = 0; bytes[35] = 7;
  const old = await decodeAseprite(bytes);
  expect([old.pixelRatioX ?? 1, old.pixelRatioY ?? 1]).toEqual([1, 1]);
});
