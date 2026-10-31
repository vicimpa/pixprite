import { Children, Fragment, isValidElement, useLayoutEffect, useRef, useState, type FC, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { t } from '~/core/i18n';
import { Button, Separator } from '~/ui/Button';
import { FloatingPanel } from './FloatingPanel';

const Root = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  & > button[hidden] { display: none; }
`;
const Lane = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;
const Palette = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 100%;
  & > div { flex-wrap: wrap; max-width: 100%; row-gap: 8px !important; }
  & label { max-width: 100%; }
  & span[title] { white-space: normal; overflow-wrap: anywhere; }
`;

export const AdaptiveItem: FC<{ priority?: number; children: ReactNode }> = ({ children }) => children;

type Item = { key: string; node: ReactNode; priority: number; host: HTMLDivElement };

function collect(children: ReactNode, prefix = ''): { key: string; node: ReactNode; priority: number }[] {
  return Children.toArray(children).flatMap((node, i) => {
    const el = isValidElement(node) ? node as ReactElement<{ children?: ReactNode; priority?: number }> : null;
    const key = prefix + (el?.key ?? i);
    if (el?.type === Fragment) return collect(el.props.children, key + '/');
    if (el?.type === Separator) return [];
    return [{ key, node, priority: el?.type === AdaptiveItem ? el.props.priority ?? 0 : 0 }];
  });
}

/** Fit actual control widths, keeping their DOM and React state when they move to More. */
export const AdaptiveBar: FC<{ children: ReactNode; label: string; leading?: ReactNode }> = ({ children, label, leading }) => {
  const lane = useRef<HTMLDivElement>(null), palette = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const [open, setOpen] = useState(false);
  const items: Item[] = collect(children).map(item => {
    let host = hosts.current.get(item.key);
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
      hosts.current.set(item.key, host);
    }
    return { ...item, host };
  });
  const layout = useRef(() => {});
  layout.current = () => {
    if (!lane.current || !palette.current || !button.current) return;
    const active = new Set(items.map(i => i.key));
    for (const [key, host] of hosts.current) if (!active.has(key)) {
      observer.current?.unobserve(host); host.remove(); hosts.current.delete(key);
    }
    const widths = new Map<Item, number>();
    const panel = palette.current.parentElement!;
    const display = panel.style.display;
    panel.style.visibility = 'hidden';
    panel.style.display = 'block';
    const focused = document.activeElement as HTMLElement | null;
    for (const item of items) {
      // Unwrap only for measurement; do not move focused controls on each keystroke.
      item.host.style.display = 'flex';
      item.host.style.width = 'max-content';
      item.host.style.maxWidth = 'none';
      item.host.style.flexWrap = 'nowrap';
      if (!item.host.isConnected) { lane.current.append(item.host); observer.current?.observe(item.host); }
    }
    for (const item of items) widths.set(item, item.host.getBoundingClientRect().width);
    const available = lane.current.clientWidth + (button.current.hidden ? 0 : button.current.offsetWidth + 6);
    const total = items.reduce((n, i) => n + (widths.get(i)! ? widths.get(i)! + 6 : 0), -6);
    const overflow = total > available;
    button.current.hidden = !overflow;
    let remaining = available - (overflow ? button.current.offsetWidth + 6 : 0);
    const fits = new Set<Item>();
    for (const item of [...items].sort((a, b) => b.priority - a.priority)) {
      const width = widths.get(item)!;
      if (width <= remaining) { fits.add(item); remaining -= width ? width + 6 : 0; }
    }
    for (const item of items) {
      const target: HTMLDivElement = fits.has(item) ? lane.current : palette.current;
      item.host.style.maxWidth = '';
      if (target === palette.current) { item.host.style.width = ''; item.host.style.flexWrap = 'wrap'; }
      // Empty extension slots stay measurable when a widget is installed later.
      item.host.style.position = widths.get(item) ? '' : 'absolute';
    }
    for (const target of [lane.current, palette.current]) {
      const ordered = items.filter(i => (fits.has(i) ? lane.current : palette.current) === target);
      ordered.forEach((item, index) => {
        if (target.children[index] === item.host) return;
        const before = target.children[index] ?? null;
        // Atomic DOM moves preserve focus, selection and uncommitted input values.
        const container = target as HTMLDivElement & { moveBefore?: (node: Node, before: Node | null) => void };
        if (container.moveBefore && item.host.isConnected) container.moveBefore(item.host, before);
        else {
          const keepDraft = (e: FocusEvent) => { if (e.target === focused) e.stopImmediatePropagation(); };
          document.addEventListener('focusout', keepDraft, true);
          target.insertBefore(item.host, before);
          document.removeEventListener('focusout', keepDraft, true);
        }
      });
    }
    panel.style.display = display;
    panel.style.visibility = '';
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if (!overflow) setOpen(false);
  };
  useLayoutEffect(() => { layout.current(); });
  useLayoutEffect(() => {
    const resize = observer.current = new ResizeObserver(() => layout.current());
    resize.observe(lane.current!);
    for (const host of hosts.current.values()) resize.observe(host);
    // Font loading can change intrinsic widths without changing the workspace.
    const fonts = () => layout.current();
    document.fonts.addEventListener('loadingdone', fonts);
    return () => { resize.disconnect(); observer.current = null; document.fonts.removeEventListener('loadingdone', fonts); };
  }, []);
  return <Root data-adaptive-bar={label}>
    {leading}
    <Lane ref={lane} />
    <Button ref={button} title={label} aria-label={label} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => setOpen(!open)}>⋯ <span>{t('options.more')}</span></Button>
    <FloatingPanel anchor={button.current} open={open} label={label} onClose={() => setOpen(false)}>
      <Palette ref={palette} />
    </FloatingPanel>
    {items.map(item => createPortal(item.node, item.host, item.key))}
  </Root>;
};
