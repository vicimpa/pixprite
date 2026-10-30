import { describe, expect, test } from 'bun:test';
import type { Bitmap } from '~/core/Image';
import { cornerRound3x, placementCorners, renderPlacement, scale2x } from '~/core/Transform';

const A = 0xff000001;
const B = 0xff000002;
const C = 0xff000003;
const D = 0xff000004;
const source: Bitmap = { w: 2, h: 2, data: new Uint32Array([A, B, C, D]) };

const placement = (overrides: Partial<Parameters<typeof renderPlacement>[2]> = {}) => ({
  x: 0, y: 0, w: 2, h: 2, angle: 0, px: 0, py: 0, ...overrides,
});

describe('Transform', () => {
  test('computes corners for rotation and horizontal skew', () => {
    expect(placementCorners(placement({ x: 1, y: 2, w: 2, h: 1, angle: 90, px: 1, py: 2 }))).toEqual([
      [1, 2], [1, 4], [0, 4], [0, 2],
    ]);
    const skewed = placementCorners(placement({ x: 1, y: 2, w: 4, h: 3, px: 1, py: 2, skew: 45 }));
    expect(skewed[0]).toEqual([1, 2]);
    expect(skewed[1]).toEqual([5, 2]);
    expect(skewed[2][0]).toBeCloseTo(8);
    expect(skewed[2][1]).toBeCloseTo(5);
    expect(skewed[3][0]).toBeCloseTo(4);
    expect(skewed[3][1]).toBeCloseTo(5);
  });

  test('scale2x doubles dimensions and preserves a solid pixel', () => {
    const one = { w: 1, h: 1, data: new Uint32Array([A]) };
    const result = scale2x(one);
    expect(result.w).toBe(2);
    expect(result.h).toBe(2);
    expect([...result.data]).toEqual([A, A, A, A]);
    expect([...one.data]).toEqual([A]);

    const line = scale2x({ w: 2, h: 1, data: new Uint32Array([A, B]) });
    expect([...line.data]).toEqual([A, A, B, B, A, A, B, B]);
  });

  test('cornerRound3x triples dimensions and preserves a solid pixel', () => {
    const one = { w: 1, h: 1, data: new Uint32Array([A]) };
    const result = cornerRound3x(one);
    expect(result.w).toBe(3);
    expect(result.h).toBe(3);
    expect([...result.data]).toEqual(new Array(9).fill(A));
    expect([...one.data]).toEqual([A]);
  });

  test('renders bit-exact translation', () => {
    const original = source.data.slice();
    const result = renderPlacement(source, null, placement({ x: 3, y: 4 }), 'fast');
    expect(result.x).toBe(3);
    expect(result.y).toBe(4);
    expect(result.bmp).toEqual(source);
    expect(result.bmp.data).not.toBe(source.data);
    expect([...result.mask]).toEqual([1, 1, 1, 1]);
    expect(source.data).toEqual(original);
  });

  test('renders bit-exact horizontal and vertical mirrors', () => {
    const horizontal = renderPlacement(source, null, placement({ x: 5, y: 2, w: -2 }), 'fast');
    expect(horizontal.x).toBe(3);
    expect(horizontal.y).toBe(2);
    expect([...horizontal.bmp.data]).toEqual([B, A, D, C]);

    const vertical = renderPlacement(source, null, placement({ y: 5, h: -2 }), 'fast');
    expect(vertical.y).toBe(3);
    expect([...vertical.bmp.data]).toEqual([C, D, A, B]);
  });

  test('renders exact right-angle rotations', () => {
    const clockwise = renderPlacement(source, null, placement({ x: 10, y: 20, angle: 90, px: 10, py: 20 }), 'fast');
    expect(clockwise.x).toBe(8);
    expect(clockwise.y).toBe(20);
    expect([...clockwise.bmp.data]).toEqual([C, A, D, B]);

    const halfTurn = renderPlacement(source, null, placement({ x: 3, y: 4, angle: 180 }), 'fast');
    expect(halfTurn.x).toBe(-5);
    expect(halfTurn.y).toBe(-6);
    expect([...halfTurn.bmp.data]).toEqual([D, C, B, A]);
  });

  test('applies source masks and skips transparent pixels', () => {
    const src = { w: 2, h: 2, data: new Uint32Array([A, 0, C, D]) };
    const result = renderPlacement(src, new Uint8Array([1, 1, 0, 1]), placement(), 'fast');
    expect([...result.bmp.data]).toEqual([A, 0, 0, D]);
    expect([...result.mask]).toEqual([1, 0, 0, 1]);
  });

  test('scales with nearest-neighbor sampling', () => {
    const result = renderPlacement(source, null, placement({ w: 4, h: 4 }), 'fast');
    expect(result.bmp.w).toBe(4);
    expect(result.bmp.h).toBe(4);
    expect([...result.bmp.data]).toEqual([
      A, A, B, B,
      A, A, B, B,
      C, C, D, D,
      C, C, D, D,
    ]);
  });

  test('returns empty output for empty sources and zero-sized placements', () => {
    const emptySource = renderPlacement({ w: 0, h: 0, data: new Uint32Array() }, null, placement(), 'fast');
    expect(emptySource.bmp.w).toBe(0);
    expect(emptySource.bmp.h).toBe(0);

    const zeroWidth = renderPlacement(source, null, placement({ x: 1.4, y: 2.6, w: 0 }), 'fast');
    expect(zeroWidth.x).toBe(1);
    expect(zeroWidth.y).toBe(3);
    expect(zeroWidth.bmp.data.length).toBe(0);
    expect(zeroWidth.mask.length).toBe(0);
  });

  test('free rotation returns consistent masks for every algorithm', () => {
    for (const algo of ['fast', 'rotsprite', 'edge'] as const) {
      const original = source.data.slice();
      const result = renderPlacement(source, null, placement({ angle: 45, px: 1, py: 1 }), algo);
      expect(result.bmp.w).toBe(4);
      expect(result.bmp.h).toBe(4);
      expect(result.mask.length).toBe(result.bmp.data.length);
      for (let i = 0; i < result.mask.length; i++) {
        expect(result.mask[i]).toBe(result.bmp.data[i] >>> 24 ? 1 : 0);
      }
      expect(source.data).toEqual(original);
    }
  });
});
