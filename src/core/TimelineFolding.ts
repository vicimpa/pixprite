import type { Tag } from './SpriteModel';

export type FrameSpan = [number, number];
export type FrameColumn = { from: number; to: number; folded: boolean };

/** Columns partition the original frame indices. Every contiguous hidden union costs one cell. */
export function frameColumns(count: number, tags: readonly Tag[], ranges: readonly FrameSpan[]): FrameColumn[] {
  const spans = [...tags.filter(t => t.collapsed).map(t => [t.from, t.to] as FrameSpan), ...ranges].sort((a, b) => a[0] - b[0]);
  const union: FrameSpan[] = [];
  for (const [from, to] of spans) {
    const last = union.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else union.push([from, to]);
  }
  const columns: FrameColumn[] = [];
  let f = 0;
  for (const [from, to] of union) {
    while (f < from) { columns.push({ from: f, to: f, folded: false }); f++; }
    columns.push({ from, to, folded: true }); f = to + 1;
  }
  while (f < count) { columns.push({ from: f, to: f, folded: false }); f++; }
  return columns;
}

export function columnOf(columns: readonly FrameColumn[], frame: number) {
  let lo = 0, hi = columns.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, c = columns[mid];
    if (frame < c.from) hi = mid - 1;
    else if (frame > c.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Source-frame centers retain the exact endpoint even inside a compressed span. */
export function columnPosition(columns: readonly FrameColumn[], frame: number) {
  const i = columnOf(columns, frame), c = columns[i];
  return c ? i + (frame - c.from + .5) / (c.to - c.from + 1) : -1;
}

/** Frozen layout picking; outside columns continue in original frame units for edge drags. */
export function frameAtColumn(columns: readonly FrameColumn[], x: number) {
  if (!columns.length) return 0;
  if (x < 0) return columns[0].from + Math.floor(x);
  if (x >= columns.length) return columns.at(-1)!.to + 1 + Math.floor(x - columns.length);
  const i = Math.floor(x), c = columns[i];
  return c.from + Math.floor((x - i) * (c.to - c.from + 1));
}

/** New indices -> original indices; null entries are new/copy frames and start visible. */
export function remapHiddenRanges(ranges: readonly FrameSpan[], sources: readonly (number | null)[]): FrameSpan[] {
  return ranges.flatMap(([from, to]) => {
    const result: FrameSpan[] = [];
    sources.forEach((source, i) => {
      if (source === null || source < from || source > to) return;
      const last = result.at(-1);
      if (last && last[1] === i - 1) last[1] = i;
      else result.push([i, i]);
    });
    return result;
  });
}
