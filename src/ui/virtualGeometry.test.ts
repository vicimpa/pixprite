import { expect, test } from 'bun:test';
import { indices, visibleRange } from './virtualGeometry';

test('window keeps original indices and bounded neighbours at either end', () => {
  expect(indices(visibleRange(10000, 24, 2400, 72))).toEqual([98, 99, 100, 101, 102, 103, 104]);
  expect(visibleRange(8, 24, 0, 72)).toEqual({ start: 0, end: 5 });
  expect(visibleRange(8, 24, 168, 100)).toEqual({ start: 5, end: 8 });
});
test('zero viewport, outside content and resizing produce valid half-open windows', () => {
  expect(visibleRange(1000, 24, 0, 0)).toEqual({ start: 0, end: 0 });
  expect(visibleRange(0, 24, 0, 100)).toEqual({ start: 0, end: 0 });
  expect(visibleRange(100, 24, -500, 100)).toEqual({ start: 0, end: 0 });
  expect(visibleRange(100, 24, 10000, 100)).toEqual({ start: 100, end: 100 });
  expect(indices(visibleRange(100, 30, 300, 90, 0))).toEqual([10, 11, 12]);
  expect(indices(visibleRange(100, 20, 300, 90, 0))).toEqual([15, 16, 17, 18, 19]);
});
