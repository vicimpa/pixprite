import { describe, expect, test } from 'bun:test';
import { Color } from '~/core/Color';

describe('Color', () => {
  test('parses supported hex formats', () => {
    expect(Color.fromHex('abc').rgba).toEqual([170, 187, 204, 1]);
    expect(Color.fromHex('#abcd').rgba).toEqual([170, 187, 204, 221 / 255]);
    expect(Color.fromHex('  #112233  ').rgba).toEqual([17, 34, 51, 1]);
    expect(Color.fromHex('#11223344').rgba).toEqual([17, 34, 51, 68 / 255]);
    expect(Color.fromHex('#A1b2C3').toHexString()).toBe('#a1b2c3');
  });

  test('rejects invalid hex input', () => {
    for (const value of ['', '#12', '#12345', '#gggggg', '#1122334455'])
      expect(() => Color.fromHex(value)).toThrow('Invalid hex');
  });

  test('clamps and rounds RGB channels and alpha', () => {
    expect(Color.fromRgb(-10, 127.5, 300, 2).rgba).toEqual([0, 128, 255, 1]);
    expect(Color.fromRgb(10, 20, 30, -1).rgba).toEqual([10, 20, 30, 0]);
  });

  test('converts primary colors between RGB, HSV and HSL', () => {
    const red = Color.fromRgb(255, 0, 0);
    expect(red.hsv).toEqual([0, 1, 1]);
    expect(red.hsl).toEqual([0, 1, 0.5]);

    const green = Color.fromHsv(120, 1, 1);
    expect(green.rgba).toEqual([0, 255, 0, 1]);
    expect(green.hsl).toEqual([120, 1, 0.5]);

    const blue = Color.fromHsl(240, 1, 0.5);
    expect(blue.rgba).toEqual([0, 0, 255, 1]);
    expect(blue.hsv).toEqual([240, 1, 1]);
  });

  test('normalizes hue and clamps HSV and HSL components', () => {
    expect(Color.fromHsv(-120, 2, -1).hsv).toEqual([240, 1, 0]);
    expect(Color.fromHsl(480, -1, 2).hsl).toEqual([120, 0, 1]);
  });

  test('property setters preserve alpha', () => {
    const color = Color.fromRgb(1, 2, 3, 0.25);
    color.rgb = [10, 20, 30];
    expect(color.rgba).toEqual([10, 20, 30, 0.25]);
    color.hsv = [120, 1, 1];
    expect(color.rgba).toEqual([0, 255, 0, 0.25]);
    color.hsl = [240, 1, 0.5];
    expect(color.rgba).toEqual([0, 0, 255, 0.25]);
  });

  test('formats colors with optional alpha', () => {
    const color = Color.fromRgb(18, 52, 86, 0.5);
    expect(color.toHexString()).toBe('#12345680');
    expect(color.toHexString(false)).toBe('#123456');
    expect(color.toRgbString()).toBe('rgba(18, 52, 86, 0.5)');
    expect(color.toRgbString(false)).toBe('rgb(18, 52, 86)');

    const opaque = Color.fromRgb(255, 0, 0);
    expect(opaque.toHexString()).toBe('#ff0000');
    expect(opaque.toHexString(true)).toBe('#ff0000ff');
    expect(opaque.toHslString()).toBe('hsl(0, 100%, 50%)');
    expect(opaque.toHsvString()).toBe('hsv(0, 100%, 100%)');
    expect(opaque.toHslString(true)).toBe('hsla(0, 100%, 50%, 1)');
    expect(opaque.toHsvString(true)).toBe('hsva(0, 100%, 100%, 1)');
  });

  test('clones into an independent color', () => {
    const original = Color.fromHex('#12345678');
    const clone = original.clone();
    expect(clone).not.toBe(original);
    expect(clone.rgba).toEqual(original.rgba);
    clone.setFromHex('#abcdef');
    expect(original.toHexString()).toBe('#12345678');
    expect(clone.toHexString()).toBe('#abcdef');
  });
});
