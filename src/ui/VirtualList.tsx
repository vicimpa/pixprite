import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Key } from 'react';
import { useViewport } from './useViewport';

/** Measured rows retain natural wrapping. Only viewport rows plus two neighbours are mounted. */
export function VirtualList<T>({ items, itemKey, render, estimate = 28, maxHeight, className, style, current, measurementKey }: {
  items: readonly T[]; itemKey: (item: T, index: number) => Key; render: (item: T, index: number) => ReactNode;
  estimate?: number; maxHeight: number | string; className?: string; style?: CSSProperties; current?: number; measurementKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewport = useViewport(ref);
  const sizes = useRef(new Map<Key, number>());
  const [, changed] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const pendingFocus = useRef<{ index: number; backward: boolean } | null>(null);
  const anchor = useRef<{ index: number; offset: number; bottom: boolean } | null>(null);
  const positions = [0];
  items.forEach((item, i) => positions.push(positions[i] + (sizes.current.get(itemKey(item, i)) ?? estimate)));
  let start = 0, end = items.length;
  while (start < items.length && positions[start + 1] < viewport.top) start++;
  start = Math.max(0, start - 2);
  end = start;
  while (end < items.length && positions[end] < viewport.top + viewport.height) end++;
  end = Math.min(items.length, end + 2);
  const remember = () => {
    const el = ref.current;
    if (!el) return;
    let index = 0;
    while (index + 1 < positions.length && positions[index + 1] <= el.scrollTop) index++;
    anchor.current = { index, offset: el.scrollTop - positions[index], bottom: el.scrollTop + el.clientHeight >= positions[positions.length - 1] - 1 };
  };
  useLayoutEffect(() => {
    const saved = anchor.current, el = ref.current;
    if (saved && el) {
      el.scrollTop = saved.bottom ? el.scrollHeight : (positions[Math.min(saved.index, items.length)] + saved.offset);
      anchor.current = null;
    }
  });
  useLayoutEffect(() => {
    remember();
    sizes.current.clear(); changed(n => n + 1);
  }, [viewport.width, estimate, measurementKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      let dirty = false;
      remember();
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.virtualIndex);
        const key = itemKey(items[i], i), height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && sizes.current.get(key) !== height) { sizes.current.set(key, height); dirty = true; }
      }
      if (dirty) changed(n => n + 1);
      else anchor.current = null;
    });
    el.querySelectorAll<HTMLElement>('[data-virtual-index]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  });
  const reveal = (index: number) => {
    const el = ref.current;
    if (!el || index < 0 || index >= items.length) return;
    if (positions[index] < el.scrollTop) el.scrollTop = positions[index];
    else if (positions[index + 1] > el.scrollTop + el.clientHeight) el.scrollTop = positions[index + 1] - el.clientHeight;
  };
  useLayoutEffect(() => { if (current !== undefined) reveal(current); }, [current]);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const stops = ref.current?.querySelectorAll<HTMLElement>(`[data-virtual-index="${pending.index}"] button:not(:disabled), [data-virtual-index="${pending.index}"] [tabindex]:not([tabindex="-1"])`);
    const target = pending.backward ? stops?.[stops.length - 1] : stops?.[0];
    if (target) { pendingFocus.current = null; target.focus({ preventScroll: true }); }
  });
  const mounted = Array.from({ length: end - start }, (_, i) => start + i);
  if (focused !== null && focused < items.length && !mounted.includes(focused)) mounted.push(focused);
  mounted.sort((a, b) => a - b);
  return <div ref={ref} onFocusCapture={e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]');
    if (row) setFocused(+row.dataset.virtualIndex!);
  }} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null); }} className={className} style={{ ...style, overflow: 'auto', overflowAnchor: 'none', maxHeight }} onKeyDown={e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]');
    if (!row) return;
    const index = +row.dataset.virtualIndex!;
    const stops = [...row.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    const tabEdge = e.key === 'Tab' && e.target === (e.shiftKey ? stops[0] : stops.at(-1));
    const next = tabEdge ? index + (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0 || next >= items.length) return;
    e.preventDefault();
    pendingFocus.current = { index: next, backward: tabEdge && e.shiftKey };
    setFocused(next); reveal(next);
  }}>
    <div style={{ height: positions.at(-1), position: 'relative', flexShrink: 0 }}>
      {mounted.map(i => { const item = items[i]; return <div key={itemKey(item, i)} data-virtual-index={i}
        style={{ position: 'absolute', left: 0, right: 0, top: positions[i], display: 'flow-root' }}>{render(item, i)}</div>; })}
    </div>
  </div>;
}
