import { useLayoutEffect, useState, type RefObject } from 'react';

/** The visible rectangle in content coordinates, also for content inside an outer scroller. */
export function useViewport(view: RefObject<HTMLElement | null>, content?: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  // Reconcile after every commit: refs may acquire their DOM node after async loading or a mode switch.
  useLayoutEffect(() => {
    const el = view.current, inner = content?.current;
    if (!el) return;
    const update = () => {
      const a = el.getBoundingClientRect(), b = inner?.getBoundingClientRect();
      const next = { left: b ? a.left - b.left : el.scrollLeft, top: b ? a.top - b.top : el.scrollTop,
        width: el.clientWidth, height: el.clientHeight };
      setRect(old => Object.keys(next).every(k => old[k as keyof typeof old] === next[k as keyof typeof next]) ? old : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (inner) observer.observe(inner);
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Content can move when siblings load (snapshots, translated text, responsive layout).
    if (inner?.parentElement) observer.observe(inner.parentElement);
    update();
    return () => { observer.disconnect(); el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  });
  return rect;
}
