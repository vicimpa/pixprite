import { expect, test } from 'bun:test';
import { BrushSpacing } from './BrushSpacing';

test('spacing is identical for sparse and dense samples in logical pixels', () => {
  const sparse = new BrushSpacing([0, 0]);
  const dense = new BrushSpacing([0, 0]);
  const result = Array.from({ length: 24 }, (_, n) => dense.advance([n + 1, 0], 4)).flat();
  expect(result).toEqual(sparse.advance([24, 0], 4));
  expect(result).toEqual([[4, 0], [8, 0], [12, 0], [16, 0], [20, 0], [24, 0]]);
});

test('spacing carries distance around corners and does not repeat stationary samples', () => {
  const spacing = new BrushSpacing([0, 0]);
  expect(spacing.advance([3, 0], 5)).toEqual([]);
  expect(spacing.advance([3, 0], 5)).toEqual([]);
  expect(spacing.advance([3, 7], 5)).toEqual([[3, 2], [3, 7]]);
});

test('diagonal sampling keeps the same positions across subdivisions', () => {
  const a = new BrushSpacing([0, 0]), b = new BrushSpacing([0, 0]);
  expect([...a.advance([5, 5], 3), ...a.advance([10, 10], 3)]).toEqual(b.advance([10, 10], 3));
});
