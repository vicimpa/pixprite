import { expect, test } from 'bun:test';
import { activeTag, adjacentTag, anchorScroll, clipColumns, fitFrameWidth, minimapScroll, minimapViewport, orderedTags, reconcileTag, sourcePosition, timelineWindow, viewPosition } from './TimelineNavigation';
import { columnPosition, frameAtColumn, frameColumns } from './TimelineFolding';
import type { Tag } from './SpriteModel';
const tag = (name: string, from: number, to: number): Tag => ({ name, from, to, color: '#ff0000', direction: 'forward' });

test('tag list retains source indices, ties stay individually reachable in both directions, and active selection resolves overlaps', () => {
  const tags = [tag('Late', 90, 99), tag('Wide', 10, 50), tag('Short', 10, 20), tag('Nested', 15, 18)];
  expect(orderedTags(tags)).toEqual([1, 2, 3, 0]);
  expect(adjacentTag(tags, 1, 10, 1)).toBe(2);
  expect(adjacentTag(tags, 2, 10, -1)).toBe(1);
  expect(adjacentTag(tags, 0, 90, 1)).toBe(1);
  expect(adjacentTag(tags, -1, 51, 1)).toBe(0);
  expect(adjacentTag(tags, -1, 9, -1)).toBe(0);
  expect(adjacentTag([], -1, 0, 1)).toBe(-1);
  expect(activeTag(tags, 1, 16)).toBe(1);
  expect(activeTag(tags, -1, 16)).toBe(3);
  expect(activeTag(tags, 0, 16)).toBe(3);
  expect(activeTag(tags, 1, 70)).toBe(-1);
  const updated = tags.map((t, i) => i === 2 ? { ...t, name: 'Renamed' } : t);
  expect(reconcileTag(tags, updated, 2)).toBe(2);
  expect(reconcileTag(tags, [tags[3], tags[2], tags[1], tags[0]], 2)).toBe(1);
  expect(reconcileTag(tags, tags.slice(1), 2)).toBe(1);
  expect(reconcileTag(tags, tags.filter((_, i) => i !== 2), 2)).toBe(-1);
  expect(reconcileTag(tags, [], 2)).toBe(-1);
  const original = [tag('A', 0, 20), tag('B', 0, 10)];
  expect(reconcileTag([original[1], original[0]], structuredClone(original), 1)).toBe(0); // Undo restores clones in the prior order.
});

test('current-tag clipping partitions only the original requested indices, including overlapping fold unions and compressed endpoints', () => {
  const columns = frameColumns(100, [{ ...tag('Fold', 2, 80), collapsed: true }], [[70, 90]]);
  const clipped = clipColumns(columns, [10, 50]);
  expect(clipped).toEqual([{ from: 10, to: 50, folded: true }]);
  expect(frameAtColumn(clipped, columnPosition(clipped, 50))).toBe(50);
  expect(clipColumns(columns, null)).toBe(columns);
  expect(columns[2]).toEqual({ from: 2, to: 90, folded: true });
});

test('fit reaches both endpoints without a minimum-zoom clamp; LOD and overscan bound DOM independently of source count', () => {
  for (const count of [1, 10, 1000, 100_000]) for (const available of [201, 1000, 4096]) {
    const width = fitFrameWidth(available, count, 192);
    expect(count * width).toBeLessThanOrEqual(available + 1e-8);
    const items = timelineWindow(count, width, 0, available);
    expect(items[0].from).toBe(0); expect(items.at(-1)!.to).toBe(count - 1);
    expect(items.length).toBeLessThanOrEqual(Math.ceil(available / 6) + 4);
    const last = timelineWindow(count, 24, Math.max(0, count * 24 - available), available);
    expect(last.at(-1)!.to).toBe(count - 1);
  }
  const columns = frameColumns(10000, [], []), width = fitFrameWidth(1000, columns.length, 192);
  expect(frameAtColumn(columns, (9999.5 * width) / width)).toBe(9999);
  expect(timelineWindow(100, 24, 0, 0)).toEqual([]);
});

test('minimap inverse covers viewport dragging, center clicks, clamping and non-scrollable fitted extents', () => {
  const extent = 100000, available = 1000, left = 23456;
  const view = minimapViewport(extent, available, left);
  expect(view).toEqual({ left: .23456, width: .01 });
  expect(minimapScroll(extent, available, view.left + view.width * .3, available * .3)).toBeCloseTo(left);
  expect(minimapScroll(extent, available, 1, 0)).toBe(99000);
  expect(minimapScroll(extent, available, -.5, 0)).toBe(0);
  expect(minimapScroll(100, 1000, .5, 500)).toBe(0);
  expect(minimapViewport(100, 1000, 0)).toEqual({ left: 0, width: 1 });
});

test('zoom and folding preserve the exact fractional source anchor before browser scroll clamping', () => {
  const unfolded = frameColumns(1000, [], []), folded = frameColumns(1000, [], [[10, 300]]);
  for (const source of [0.01, 9.9, 10.25, 50.75, 300.99, 999.75]) {
    const x = viewPosition(folded, source);
    expect(sourcePosition(folded, x)).toBeCloseTo(source, 10);
    const center = sourcePosition(unfolded, source);
    expect(sourcePosition(folded, viewPosition(folded, center))).toBeCloseTo(source, 10);
  }
});

test('resize after goto uses the actual pre-layout scroll and keeps a previously visible edge playhead in view', () => {
  const columns = frameColumns(120, [], []);
  const before = { columns, width: 30, available: 1000, left: 79 * 30 + .25 };
  const after = { columns, width: 30, available: 820 };
  const left = anchorScroll(before, after, 79);
  expect(left).toBeLessThanOrEqual(79 * 30);
  expect(left + after.available).toBeGreaterThanOrEqual(80 * 30);
  const zoomed = anchorScroll({ ...before, left: 300 }, { ...after, width: 60, available: 1000 }, 0);
  expect(anchorScroll({ ...before, left: 0, available: 3600 }, { ...after, width: 60, available: 1000 }, 0)).toBe(3100); // Zoom preserves center even when the playhead leaves the viewport.
  expect(zoomed).toBe(1100); // Non-visible playhead does not steal the preserved center.
});
