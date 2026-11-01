import { Children, Fragment, createElement, isValidElement, useLayoutEffect, useRef, useState, type FC, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerAdaptive, type PxAdaptiveBar } from '@pixprite/ui';
import { t } from '~/core/i18n';
import { Button, Separator } from '~/ui/Button';
import { FloatingPanel } from './FloatingPanel';

registerAdaptive();

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

/** React owns item rendering; the shared element owns measuring and moving their DOM. */
export const AdaptiveBar: FC<{ children: ReactNode; label: string; leading?: ReactNode }> = ({ children, label, leading }) => {
  const controller = useRef<PxAdaptiveBar>(null);
  const lane = useRef<HTMLDivElement>(null), palette = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const hosts = useRef(new Map<string, HTMLDivElement>());
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
  useLayoutEffect(() => {
    if (!controller.current || !lane.current || !palette.current || !button.current) return;
    controller.current.configure({ lane: lane.current, palette: palette.current, button: button.current, items,
      onOverflow: overflow => { if (!overflow) setOpen(false); } });
    const active = new Set(items.map(item => item.key));
    for (const key of hosts.current.keys()) if (!active.has(key)) hosts.current.delete(key);
  });
  return createElement('px-adaptive-bar', { ref: controller }, <div data-adaptive-bar={label}>
    {leading}
    <div ref={lane} className="px-adaptive-lane" />
    <Button ref={button} title={label} aria-label={label} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => setOpen(!open)}>⋯ <span>{t('options.more')}</span></Button>
    <FloatingPanel anchor={button.current} open={open} label={label} onClose={() => setOpen(false)}>
      <div ref={palette} className="px-adaptive-palette" />
    </FloatingPanel>
    {items.map(item => createPortal(item.node, item.host, item.key))}
  </div>);
};
