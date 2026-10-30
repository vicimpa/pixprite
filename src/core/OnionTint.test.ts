import { beforeAll, expect, mock, test } from 'bun:test';
import { installSoftwareCanvas, canvasPixels } from './Canvas.test-helper';
import { tinted, clearTintCache } from './OnionTint';
mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite } = await import('./Sprite');
beforeAll(installSoftwareCanvas);

test('onion tint cache owns a document and a version, and cleanup releases its canvases', () => {
  const a = new Sprite(1, 1), b = new Sprite(1, 1);
  a.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([0xff000000]) });
  b.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([0xffffffff]) });
  expect(a.version).toBe(b.version);
  const first = tinted(a, 0, true);
  expect(tinted(a, 0, true)).toBe(first);
  const other = tinted(b, 0, true);
  expect(other).not.toBe(first);
  expect(canvasPixels(other)).not.toEqual(canvasPixels(first));
  a.touch();
  expect(tinted(a, 0, true)).not.toBe(first);
  clearTintCache(b);
  expect(tinted(b, 0, true)).not.toBe(other);
});
