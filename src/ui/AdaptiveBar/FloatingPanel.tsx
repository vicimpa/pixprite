import { useEffect, useLayoutEffect, useRef, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

const Panel = styled.div`
  position: fixed;
  z-index: 1000;
  width: max-content;
  max-width: min(680px, calc(100vw - 16px));
  padding: 8px;
  background: var(--menu);
  color: var(--fg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

/** Shared positioning and dismissal for control palettes, including nested select lists. */
export const FloatingPanel: FC<{
  anchor: HTMLElement | null; open: boolean; label: string; onClose: () => void;
  children: ReactNode; side?: boolean;
}> = ({ anchor, open, label, onClose, children, side }) => {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !anchor || !panel.current) return;
    const position = () => {
      const r = anchor.getBoundingClientRect(), p = panel.current!;
      const x = side ? (r.left > innerWidth / 2 ? r.left - p.offsetWidth - 4 : r.right + 4) : r.left;
      const y = side ? r.top : (innerHeight - r.bottom >= p.offsetHeight + 8 ? r.bottom + 4 : r.top - p.offsetHeight - 4);
      p.style.left = `${Math.max(8, Math.min(x, innerWidth - p.offsetWidth - 8))}px`;
      p.style.top = `${Math.max(8, Math.min(y, innerHeight - p.offsetHeight - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel.current);
    if (anchor.parentElement) observer.observe(anchor.parentElement);
    addEventListener('resize', position);
    return () => { observer.disconnect(); removeEventListener('resize', position); };
  }, [open, anchor, side]);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!anchor?.contains(el) && !panel.current?.contains(el) && !el.closest('[data-floating-panel], [data-select-popup]')) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A nested select or palette handles its own Escape first.
      if (document.querySelector('[data-select-popup]')) return;
      const panels = document.querySelectorAll('[data-floating-panel][data-open=true]');
      if (panels[panels.length - 1] !== panel.current) return;
      if ((e.target as HTMLElement).matches('input:not([type=checkbox]):not([type=range]), textarea')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      onClose(); anchor?.focus();
    };
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', escape, true);
    return () => { removeEventListener('pointerdown', outside, true); removeEventListener('keydown', escape, true); };
  }, [open, anchor, onClose]);
  // Keep the portal mounted: moving a control into the palette must retain its draft/focus.
  return createPortal(<Panel ref={panel} data-floating-panel data-open={open} role="dialog" aria-label={label}
    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).closest('button')) e.stopPropagation(); }}
    style={{ display: open ? undefined : 'none' }}>{children}</Panel>, document.body);
};
