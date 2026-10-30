import { describe, expect, test } from 'bun:test';
import { encodeGif } from '~/core/Gif';
import { decodeGif, type DecodedGif } from '~/core/formats/GifDecode';
import { packRgba } from '~/core/Image';

const RED = packRgba(255, 0, 0, 255);
const GREEN = packRgba(0, 255, 0, 255);
const BLUE = packRgba(0, 0, 255, 255);
const OPAQUE_WHITE = packRgba(255, 255, 255, 128);

const encodeDecoded = (decoded: DecodedGif) => encodeGif(
  decoded.width,
  decoded.height,
  decoded.frames.map(frame => ({
    data: new Uint8ClampedArray(frame.data.buffer),
    delay: frame.delay,
  })),
);

describe('GIF round-trip', () => {
  test('exact-color animation is stable through save → load → save', () => {
    const source = [
      { data: new Uint32Array([RED, GREEN, BLUE, OPAQUE_WHITE]), delay: 80 },
      { data: new Uint32Array([0, RED, GREEN, BLUE]), delay: 120 },
    ];
    const bytes = encodeGif(2, 2, source.map(frame => ({
      data: new Uint8ClampedArray(frame.data.buffer),
      delay: frame.delay,
    })));

    const decoded = decodeGif(bytes);
    const secondBytes = encodeDecoded(decoded);
    const second = decodeGif(secondBytes);

    expect([decoded.width, decoded.height]).toEqual([2, 2]);
    expect(decoded.frames.map(frame => frame.delay)).toEqual([80, 120]);
    expect(decoded.frames.map(frame => [...frame.data])).toEqual([
      [RED, GREEN, BLUE, packRgba(255, 255, 255, 255)],
      [0, RED, GREEN, BLUE],
    ]);
    expect(secondBytes).toEqual(bytes);
    expect(second).toEqual(decoded);
  });

  test('frame delays use GIF rounding and the encoder minimum', () => {
    const frames = [0, 15, 25, 110].map(delay => ({
      data: new Uint8ClampedArray(new Uint32Array([RED]).buffer),
      delay,
    }));

    const decoded = decodeGif(encodeGif(1, 1, frames));
    const second = decodeGif(encodeDecoded(decoded));

    expect(decoded.frames.map(frame => frame.delay)).toEqual([20, 20, 30, 110]);
    expect(second).toEqual(decoded);
  });

  test('animations over 255 colors use the deterministic color cube', () => {
    const data = new Uint32Array(16 * 16);
    for (let i = 0; i < data.length; i++)
      data[i] = packRgba(i, (i * 37) % 256, (i * 73) % 256, 255);

    const bytes = encodeGif(16, 16, [{ data: new Uint8ClampedArray(data.buffer), delay: 100 }]);
    const decoded = decodeGif(bytes);
    const second = decodeGif(encodeDecoded(decoded));

    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0].data.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      const r = i, g = (i * 37) % 256, b = (i * 73) % 256;
      const qr = Math.round(Math.round(r / 255 * 5) * 255 / 5);
      const qg = Math.round(Math.round(g / 255 * 6) * 255 / 6);
      const qb = Math.round(Math.round(b / 255 * 5) * 255 / 5);
      expect(decoded.frames[0].data[i]).toBe(packRgba(qr, qg, qb, 255));
    }
    expect(second).toEqual(decoded);
  });
});
