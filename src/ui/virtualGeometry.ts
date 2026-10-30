/** Half-open indices; overscan is bounded in items, never proportional to the dataset. */
export function visibleRange(count: number, step: number, offset: number, extent: number, overscan = 2) {
  if (count <= 0 || step <= 0 || extent <= 0) return { start: 0, end: 0 };
  const start = Math.min(count, Math.max(0, Math.floor(offset / step) - overscan));
  const end = Math.min(count, Math.max(start, Math.ceil((offset + extent) / step) + overscan));
  return { start, end };
}

export function indices(range: { start: number; end: number }) {
  return Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
}
