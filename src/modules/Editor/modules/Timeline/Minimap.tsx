import { useLayoutEffect, useRef, useState, type FC, type RefObject } from 'react';
import { columnOf, columnPosition, type FrameColumn } from '~/core/TimelineFolding';
import { minimapScroll, minimapViewport } from '~/core/TimelineNavigation';
import type { Tag } from '~/core/SpriteModel';
import { t } from '~/core/i18n';
import { useViewport } from '~/ui/useViewport';

export const Minimap: FC<{ scroll: RefObject<HTMLDivElement | null>; columns: FrameColumn[]; width: number;
  available: number; left: number; frame: number; tags: readonly Tag[] }> = ({ scroll, columns, width, available, left, frame, tags }) => {
  const holder = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const size = useViewport(holder);
  const [dpr, setDpr] = useState(devicePixelRatio);
  useLayoutEffect(() => {
    const media = matchMedia(`(resolution: ${dpr}dppx)`);
    const changed = () => setDpr(devicePixelRatio);
    media.addEventListener('change', changed);
    window.addEventListener('resize', changed);
    window.visualViewport?.addEventListener('resize', changed);
    return () => { media.removeEventListener('change', changed); window.removeEventListener('resize', changed); window.visualViewport?.removeEventListener('resize', changed); };
  }, [dpr]);
  const extent = columns.length * width;
  const view = minimapViewport(extent, available, left);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !size.width) return;
    // Memory is bounded independently of frame count, viewport width and DPR.
    el.width = Math.max(1, Math.min(4096, Math.ceil(size.width * dpr)));
    el.height = Math.min(96, Math.ceil(24 * dpr));
    const ctx = el.getContext('2d')!;
    const w = el.width, h = el.height, count = Math.max(1, columns.length);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#777'; ctx.fillRect(0, h * .65, w, h * .15);
    for (const tag of tags) {
      const start = columnOf(columns, tag.from), end = columnOf(columns, tag.to);
      if (start < 0 && end < 0 && !(columns[0]?.from >= tag.from && columns.at(-1)!.to <= tag.to)) continue;
      ctx.fillStyle = tag.color;
      ctx.fillRect(Math.max(0, start) / count * w, h * .15, (Math.min(count - 1, end < 0 ? count - 1 : end) - Math.max(0, start) + 1) / count * w, h * .35);
    }
    ctx.fillStyle = '#a4a4a4';
    columns.forEach((c, i) => { if (c.folded) ctx.fillRect(i / count * w, h * .65, Math.max(1, w / count), h * .35); });
  }, [columns, tags, size.width, dpr]);
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const seek = (clientX: number, offset: number) => {
    const box = holder.current!.getBoundingClientRect();
    if (scroll.current) scroll.current.scrollLeft = minimapScroll(extent, available, (clientX - box.left) / box.width, offset);
  };
  return <div ref={holder} data-testid="timeline-minimap" role="slider" aria-orientation="horizontal" tabIndex={0}
    aria-label={t('timeline.minimap')} aria-valuemin={0} aria-valuemax={Math.max(0, Math.round(extent - available))}
    aria-valuenow={Math.round(left)} aria-valuetext={`${Math.round(view.left * 100)}%`}
    style={{ position: 'relative', height: 24, flexShrink: 0, overflow: 'hidden', background: 'var(--bg2)', touchAction: 'none', cursor: 'ew-resize' }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
      const box = e.currentTarget.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * extent;
      const inside = x >= left && x <= left + available;
      const offset = inside ? x - left : available / 2;
      drag.current = { pointer: e.pointerId, offset }; seek(e.clientX, offset);
    }}
    onPointerMove={e => { if (drag.current?.pointer === e.pointerId) seek(e.clientX, drag.current.offset); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => {
      const el = scroll.current;
      if (!el) return;
      const values: Record<string, number> = { Home: 0, End: extent, ArrowLeft: left - available / 10, ArrowRight: left + available / 10,
        PageUp: left - available, PageDown: left + available };
      if (e.key in values) { e.preventDefault(); e.stopPropagation(); el.scrollLeft = values[e.key]; }
    }}>
    <canvas ref={canvas} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />
    {columnPosition(columns, frame) >= 0 && <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ffdf68', left: `${columnPosition(columns, frame) / columns.length * 100}%`, pointerEvents: 'none' }} />}
    <div data-testid="timeline-minimap-viewport" aria-hidden="true" data-left={view.left} data-width={view.width}
      style={{ position: 'absolute', top: 0, bottom: 0, left: `${view.left * 100}%`, width: `${view.width * 100}%`,
        boxSizing: 'border-box', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 18%, transparent)', pointerEvents: 'none' }} />
  </div>;
};
