import { createElement, useLayoutEffect, useRef, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerAdaptive, type PxFloatingPanel } from '@pixprite/ui';

registerAdaptive();

/** React supplies content; the shared element owns anchoring, focus and dismissal. */
export const FloatingPanel: FC<{
  anchor: HTMLElement | null; open: boolean; label: string; onClose: () => void;
  children: ReactNode; side?: boolean;
}> = ({ anchor, open, label, onClose, children, side }) => {
  const panel = useRef<PxFloatingPanel>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const dismiss = () => onClose();
    element.addEventListener('dismiss', dismiss);
    element.anchor = anchor;
    element.label = label;
    element.side = !!side;
    element.open = open;
    element.refresh();
    return () => element.removeEventListener('dismiss', dismiss);
  }, [anchor, open, label, onClose, side]);
  // Keep content mounted so a control retains its draft when moved into the palette.
  return createPortal(createElement('px-floating-panel', { ref: panel }, <div data-floating-panel>{children}</div>), document.body);
};
