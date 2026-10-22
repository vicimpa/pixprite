import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FC, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styled, { css } from "styled-components";

type Option = { value: string; label: ReactNode; disabled: boolean; };

/** The <option> elements among children (through fragments, arrays and conditionals) */
function collect(children: ReactNode, out: Option[] = []) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: unknown; children?: ReactNode; disabled?: boolean; }>;
    if (el.type === Fragment) return collect(el.props.children, out);
    if (el.type === 'option') out.push({ value: String(el.props.value ?? ''), label: el.props.children, disabled: !!el.props.disabled });
  });
  return out;
}

const face = css`
  height: var(--row);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite);
  background-color: var(--face);
  color: var(--fg);
`;

const Trigger = styled.button`
  ${face}
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 0 4px 0 6px;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) { background-color: var(--face-hot); }
  &:focus-visible { outline: 1px solid var(--accent); }
  &:disabled { color: var(--fg-dim); cursor: default; }
  & > span { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const Arrow = () => (
  <svg width="7" height="4" viewBox="0 0 7 4" style={{ flexShrink: 0 }} shapeRendering="crispEdges">
    <path d="M0 0h7v1H0zM1 1h5v1H1zM2 2h3v1H2zM3 3h1v1H3z" fill="currentColor" />
  </svg>
);

const List = styled.div`
  position: fixed;
  z-index: 1100;
  overflow-y: auto;
  padding: 2px;
  background-color: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  min-height: var(--row);
  padding: 0 8px;
  white-space: nowrap;
  cursor: pointer;

  &[data-active=true] { background-color: var(--sel); color: var(--sel-fg); }
  &[data-selected=true] { font-weight: 600; }
  &[data-disabled=true] { color: var(--fg-dim); cursor: default; }
`;

export type SelectProps = {
  value?: string | number;
  /** Same shape as a native select's change event, so existing handlers keep working */
  onChange?: (e: { target: { value: string; }; currentTarget: { value: string; }; }) => void;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
};

/** Drop-down list drawn by the app (the browser's own list doesn't match the interface) */
export const Select: FC<SelectProps> = ({ value, onChange, children, disabled, title, style }) => {
  const options = collect(children);
  const current = options.findIndex(o => o.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(current);
  const [box, setBox] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const choose = (i: number) => {
    const o = options[i];
    setOpen(false);
    trigger.current?.focus();
    if (!o || o.disabled || o.value === String(value)) return;
    onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };
  const step = (from: number, dir: number) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };

  // Placed under the button, above it when there is no room, never off screen
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = innerHeight - r.bottom - 8, above = r.top - 8;
    const down = below >= Math.min(240, above);
    setBox({
      left: Math.max(4, Math.min(r.left, innerWidth - 200)),
      minWidth: r.width,
      maxHeight: Math.max(80, down ? below : above),
      ...(down ? { top: r.bottom + 1 } : { bottom: innerHeight - r.top + 1 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest' });
    const outside = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', outside, true);
    return () => removeEventListener('pointerdown', outside, true);
  }, [open, active]);

  return <>
    <Trigger
      ref={trigger}
      type="button"
      title={title}
      style={style}
      disabled={disabled}
      onClick={() => { setActive(current); setOpen(!open); }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = step(open ? active : current, e.key === 'ArrowDown' ? 1 : -1);
          if (open) setActive(next); else choose(next);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (open) choose(active); else { setActive(current); setOpen(true); }
        } else if (e.key === 'Escape' && open) {
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <span>{options[current]?.label ?? ''}</span>
      <Arrow />
    </Trigger>
    {open && createPortal(
      <List ref={list} style={box} onPointerDown={e => e.stopPropagation()}>
        {options.map((o, i) => (
          <Item key={o.value + i} data-active={i === active} data-selected={i === current} data-disabled={o.disabled}
            onPointerEnter={() => !o.disabled && setActive(i)} onClick={() => choose(i)}>
            {o.label}
          </Item>
        ))}
      </List>,
      document.body
    )}
  </>;
};
