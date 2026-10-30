import { describe, expect, test } from 'bun:test';
import { decodeApng, encodeApng, type DecodedApng } from '~/core/formats/Apng';
import { packRgba } from '~/core/Image';

const RED = packRgba(255, 0, 0, 255);
const GREEN = packRgba(0, 255, 0, 255);
const BLUE = packRgba(0, 0, 255, 255);
const ALPHA = packRgba(255, 255, 255, 128);
const HIDDEN = packRgba(17, 34, 51, 0);

const encodeDecoded = (decoded: DecodedApng) => encodeApng(
  decoded.width,
  decoded.height,
  decoded.frames.map(frame => ({ data: new Uint8ClampedArray(frame.data.buffer), delay: frame.delay })),
  decoded.loops,
);

describe('APNG round-trip', () => {
  test('RGBA animation and full alpha survive save → load → save', async () => {
    const source = [
      { data: new Uint32Array([RED, GREEN, BLUE, ALPHA]), delay: 80 },
      { data: new Uint32Array([HIDDEN, RED, GREEN, BLUE]), delay: 120 },
    ];
    const bytes = await encodeApng(2, 2, source.map(frame => ({
      data: new Uint8ClampedArray(frame.data.buffer), delay: frame.delay,
    })));

    const decoded = await decodeApng(bytes);
    const secondBytes = await encodeDecoded(decoded);
    const second = await decodeApng(secondBytes);

    expect([decoded.width, decoded.height]).toEqual([2, 2]);
    expect(decoded.loops).toBe(0);
    expect(decoded.frames.map(frame => frame.delay)).toEqual([80, 120]);
    expect(decoded.frames.map(frame => [...frame.data])).toEqual([
      [RED, GREEN, BLUE, ALPHA],
      [HIDDEN, RED, GREEN, BLUE],
    ]);
    expect(secondBytes).toEqual(bytes);
    expect(second).toEqual(decoded);
  });

  test('loop count and millisecond delay quantization are stable', async () => {
    const frames = [12.4, 12.5, 0, 70000].map(delay => ({
      data: new Uint8ClampedArray(new Uint32Array([RED]).buffer), delay,
    }));

    const decoded = await decodeApng(await encodeApng(1, 1, frames, 1));
    const secondBytes = await encodeDecoded(decoded);
    const second = await decodeApng(secondBytes);

    expect(decoded.loops).toBe(1);
    expect(decoded.frames.map(frame => frame.delay)).toEqual([12, 13, 0, 65535]);
    expect(second).toEqual(decoded);
  });

  test('a static RGBA PNG decodes as one frame', async () => {
    const png = await encodeApng(1, 1, [{ data: new Uint8ClampedArray(new Uint32Array([ALPHA]).buffer), delay: 100 }]);
    const withoutAnimation = png.filter((_, i) => {
      const chunkStart = 33;
      return i < chunkStart || i >= chunkStart + 20;
    });

    const decoded = await decodeApng(withoutAnimation);

    expect(decoded.loops).toBe(1);
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0].data[0]).toBe(ALPHA);
  });
});
