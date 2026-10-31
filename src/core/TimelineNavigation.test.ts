import { expect, test } from 'bun:test';
import { activeTag, anchorScroll, orderedTags, reconcileTag, sourcePosition, timelineWindow, viewPosition } from './TimelineNavigation';
import { frameColumns } from './TimelineFolding';
import type { Tag } from './SpriteModel';
const tag = (name: string, from: number, to: number): Tag => ({ name, from, to, color: '#ff0000', direction: 'forward' });

test('tag ordering retains source indices and active selection resolves overlaps', () => {
  const tags = [tag('Late', 90, 99), tag('Wide', 10, 50), tag('Short', 10, 20), tag('Nested', 15, 18)];
  expect(orderedTags(tags)).toEqual([1, 2, 3, 0]);
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

test('fixed-width timeline windows bound DOM and reach the final column independently of source count', () => {
  for (const count of [1, 10, 1000, 100_000]) for (const available of [201, 1000, 4096]) {
    const first = timelineWindow(count, 24, 0, available);
    expect(first[0].from).toBe(0);
    expect(first.every(item => item.from === item.to)).toBe(true);
    expect(first.length).toBeLessThanOrEqual(Math.ceil(available / 24) + 4);
    const last = timelineWindow(count, 24, Math.max(0, count * 24 - available), available);
    expect(last.at(-1)!.to).toBe(count - 1);
  }
  expect(timelineWindow(100, 24, 0, 0)).toEqual([]);
});

test('folding preserves the exact fractional source anchor before browser scroll clamping', () => {
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
});
