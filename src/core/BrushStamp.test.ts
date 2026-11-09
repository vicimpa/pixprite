import { describe, expect, test } from 'bun:test';
import { transformBrush } from './BrushStamp';
import { packRgba } from './Image';
import { BUILTIN_STAMPS } from './Stamps';

const red = packRgba(255, 0, 0, 128), blue = packRgba(0, 0, 255, 255);
const source = { w: 2, h: 1, data: Uint32Array.of(red, blue) };
describe('bitmap brush transforms', () => {
  test('identity preserves the original image and its even-size cursor anchor', () => {
    const result = transformBrush(source);
    expect(result).toEqual({ x: -1, y: 0, bmp: source });
    expect(result.bmp).toBe(source);
  });
  test('quarter turns preserve every source color and alpha', () => {
    for (const angle of [90, 180, 270, -90]) {
      const result = transformBrush(source, angle);
      expect([...result.bmp.data].sort()).toEqual([red, blue].sort());
      expect(result.bmp.w * result.bmp.h).toBe(2);
    }
  });
  test('nearest-neighbour upscaling fills the entire footprint without holes', () => {
    const result = transformBrush(source, 0, 2).bmp;
    expect([result.w, result.h]).toEqual([4, 2]);
    expect([...result.data]).toEqual([red, red, blue, blue, red, red, blue, blue]);
    expect([...source.data]).toEqual([red, blue]);
  });
  test('pressure downscaling retains at least a one-pixel brush', () => {
    const result = transformBrush(source, 0, 0).bmp;
    expect([result.w, result.h]).toEqual([1, 1]);
    expect(result.data[0]).toBe(blue);
  });
  test('mirroring reuses the transform and preserves the original color image', () => {
    expect([...transformBrush(source, 0, 1, true).bmp.data]).toEqual([blue, red]);
    const vertical = { w: 1, h: 2, data: source.data };
    expect([...transformBrush(vertical, 0, 1, false, true).bmp.data]).toEqual([blue, red]);
    const mirrored = transformBrush(source, 90, 2, true).bmp;
    expect([mirrored.w, mirrored.h]).toEqual([2, 4]);
    expect([...mirrored.data].filter(v => v === red)).toHaveLength(4);
    expect([...source.data]).toEqual([red, blue]);
  });
  test('built-in masks fit their bounds and retain transparent padding', () => {
    expect(new Set(BUILTIN_STAMPS.map(s => s.id)).size).toBe(6);
    for (const stamp of BUILTIN_STAMPS) {
      expect(stamp.mask.length).toBe(stamp.w * stamp.h);
      expect(stamp.mask.some(v => v === 1)).toBe(true);
      expect(stamp.mask.some(v => v === 0)).toBe(true);
    }
  });
});
