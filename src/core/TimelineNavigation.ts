import equal from 'fast-deep-equal';
import { columnOf, type FrameColumn, type FrameSpan } from './TimelineFolding';
import type { Tag } from './SpriteModel';
import { visibleRange } from '~/ui/virtualGeometry';

/** Restrict a view, never the source document; folds crossing an edge are clipped. */
export function clipColumns(columns: readonly FrameColumn[], span: FrameSpan | null): FrameColumn[] {
  if (!span) return columns as FrameColumn[];
  const first = columnOf(columns, span[0]), last = columnOf(columns, span[1]);
  return columns.slice(first, last + 1).map(c => ({ ...c, from: Math.max(c.from, span[0]), to: Math.min(c.to, span[1]) }));
}

export function orderedTags(tags: readonly Tag[]) {
  return tags.map((_, i) => i).sort((a, b) => tags[a].from - tags[b].from || a - b);
}

/** Explicit selection wins overlaps while it contains the playhead; otherwise the shortest tag wins. */
export function activeTag(tags: readonly Tag[], selected: number, frame: number) {
  const contains = (i: number) => !!tags[i] && frame >= tags[i].from && frame <= tags[i].to;
  if (contains(selected)) return selected;
  let best = -1;
  tags.forEach((t, i) => { if (contains(i) && (best < 0 || t.to - t.from < tags[best].to - tags[best].from)) best = i; });
  return best;
}

/** Preserve an immutable tag reference through sorting, updates and deletions, without stale indices. */
export function reconcileTag(previous: readonly Tag[], next: readonly Tag[], selected: number) {
  if (selected < 0 || !previous[selected]) return -1;
  const same = next.indexOf(previous[selected]);
  if (same >= 0) return same;
  const restored = next.findIndex(tag => equal(tag, previous[selected]));
  if (restored >= 0) return restored;
  // Single/multiple metadata edits replace objects in place; deletion changes the length.
  return previous.length === next.length ? Math.min(selected, next.length - 1) : -1;
}

export function adjacentTag(tags: readonly Tag[], selected: number, frame: number, direction: -1 | 1) {
  const order = orderedTags(tags);
  if (!order.length) return -1;
  const current = order.indexOf(selected);
  if (current >= 0) return order[(current + direction + order.length) % order.length];
  return direction > 0 ? order.find(i => tags[i].from > frame) ?? order[0]
    : order.findLast(i => tags[i].from < frame) ?? order.at(-1)!;
}

/** Virtualize fixed-width columns, including folded placeholders and overscan. */
export function timelineWindow(count: number, width: number, left: number, available: number) {
  const range = visibleRange(count, width, left, available);
  return Array.from({ length: range.end - range.start }, (_, k) => {
    const from = range.start + k;
    return { from, to: from };
  });
}

export function minimapViewport(extent: number, available: number, scroll: number) {
  return { left: Math.max(0, Math.min(1, scroll / Math.max(1, extent))),
    width: Math.min(1, available / Math.max(1, extent)) };
}

/** Pointer coordinate is a fraction of the whole map; offset is the grabbed fraction within the viewport. */
export function minimapScroll(extent: number, available: number, fraction: number, offset: number) {
  return Math.max(0, Math.min(Math.max(0, extent - available), fraction * extent - offset));
}

/** Continuous source position for viewport anchoring, including the fraction inside a frame/fold. */
export function sourcePosition(columns: readonly FrameColumn[], x: number) {
  const i = Math.max(0, Math.min(columns.length - 1, Math.floor(x))), c = columns[i];
  return c ? c.from + (x - i) * (c.to - c.from + 1) : 0;
}

export function viewPosition(columns: readonly FrameColumn[], source: number) {
  const i = columnOf(columns, Math.floor(source)), c = columns[i];
  return c ? i + (source - c.from) / (c.to - c.from + 1) : -1;
}

export type TimelineGeometry = { columns: readonly FrameColumn[]; width: number; available: number; left: number };

/** Center anchor survives geometry changes; a visible playhead remains reachable when the viewport shrinks. */
export function anchorScroll(before: TimelineGeometry, after: Omit<TimelineGeometry, 'left'>, frame: number) {
  const source = sourcePosition(before.columns, (before.left + before.available / 2) / before.width);
  const position = viewPosition(after.columns, source);
  let left = position < 0 ? 0 : position * after.width - after.available / 2;
  const oldX = columnOf(before.columns, frame) * before.width;
  const newX = columnOf(after.columns, frame) * after.width;
  if (before.width === after.width && before.available !== after.available && oldX >= 0 && newX >= 0 && oldX + before.width > before.left - 1 && oldX < before.left + before.available + 1) {
    if (newX < left) left = newX;
    else if (newX + after.width > left + after.available) left = newX + after.width - after.available;
  }
  return Math.max(0, Math.min(Math.max(0, after.columns.length * after.width - after.available), left));
}
