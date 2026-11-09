import { expect, test } from 'bun:test';
import { decodeBrushFile, encodeBrushFile } from './BrushFile';
import type { LibraryItem } from './State';

const brush: LibraryItem = { id: 'original', name: 'Two colors', kind: 'brush', w: 2, h: 1,
  data: btoa(String.fromCharCode(255, 0, 0, 128, 0, 0, 255, 255)), align: 'dab', tint: true,
  settings: { brushScale: 200, brushFlipX: true, brushMode: 'stamp', brushSpacing: 150, pressure: { size: true, opacity: false, density: false, min: 25 } } };

test('portable brush set preserves images, alpha and independent settings', () => {
  const decoded = decodeBrushFile(encodeBrushFile([brush, { ...brush, name: 'Second' }]));
  expect(decoded).toHaveLength(2);
  expect(decoded[0].data).toBe(brush.data); expect(decoded[0].settings).toEqual(brush.settings);
  expect(decoded[0].id).toBe('');
  (decoded[0].settings!.pressure as { min: number }).min = 50;
  expect((brush.settings!.pressure as { min: number }).min).toBe(25);
});

test('unknown versions and invalid dimensions or encoded buffers reject the whole set', () => {
  const file = (items: unknown[], version = 1) => JSON.stringify({ format: 'pixprite-brushes', version, items });
  for (const bad of [{ ...brush, w: -1 }, { ...brush, w: 5000 }, { ...brush, h: 0.5 }, { ...brush, data: 'AAAA' },
    { ...brush, data: '#'.repeat(brush.data.length) }, { ...brush, align: 'unknown' }])
    expect(() => decodeBrushFile(file([brush, bad]))).toThrow();
  expect(() => decodeBrushFile(file([brush], 2))).toThrow();
  expect(() => decodeBrushFile(file([]))).toThrow();
  expect(() => decodeBrushFile(file(Array.from({ length: 257 }, () => brush)))).toThrow();
});

test('imported settings cannot write arbitrary editor state or invalid pressure', () => {
  for (const settings of [{ sprite: {} }, { brushScale: Infinity }, { brushSpacing: -1 }, { brushMode: 'script' },
    { brushFlipY: 'yes' }, { pressure: { size: true, opacity: true, density: false, min: 101 } }, JSON.parse('{"__proto__":{}}')])
    expect(() => encodeBrushFile([{ ...brush, settings }])).toThrow();
});
