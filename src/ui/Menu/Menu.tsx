import { t } from "~/core/i18n";
import { Icon } from "~/ui/Icon";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import * as styled from "./styled";

export type MenuEntry = {
  /** Shown as is: callers pass translated text */
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  run?: () => void;
  items?: MenuItems;
};

export type MenuItems = (MenuEntry | '-' | null | false)[];

type Popup = { items: MenuItems; x: number; y: number; };

/** The single context menu that can be open at a time */
const context = signal<Popup | null>(null);

export function openContextMenu(items: MenuItems, x: number, y: number) {
  context.value = { items, x, y };
}

export function closeContextMenu() {
  context.value = null;
}

type ListProps = {
  items: MenuItems;
  x: number;
  y: number;
  onClose: () => void;
  /** Flip to the left of this x when there is no room on the right */
  flipX?: number;
};

export const MenuList: FC<ListProps> = ({ items, x, y, onClose, flipX }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);
  const [sub, setSub] = useState({ x: 0, y: 0, flip: 0 });

  // Keep the popup inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x, ny = y;
    if (nx + r.width > innerWidth) nx = flipX !== undefined ? flipX - r.width : innerWidth - r.width;
    if (ny + r.height > innerHeight) ny = Math.max(0, innerHeight - r.height);
    setPos({ x: Math.max(0, nx), y: ny });
  }, [x, y, flipX]);

  const entries = items.filter(Boolean) as (MenuEntry | '-')[];

  return (
    <styled.List ref={ref} style={{ left: pos.x, top: pos.y }} onPointerDown={e => e.stopPropagation()}>
      {entries.map((item, i) => {
        if (item === '-') return <styled.Divider key={i} />;
        return (
          <styled.Item
            key={i}
            data-disabled={item.disabled}
            data-open={open === i}
            onPointerEnter={e => {
              const r = e.currentTarget.getBoundingClientRect();
              setOpen(item.items ? i : null);
              setSub({ x: r.right - 2, y: r.top - 3, flip: r.left + 2 });
            }}
            onClick={() => {
              if (item.disabled || item.items) return;
              onClose();
              item.run?.();
            }}
          >
            <styled.Mark>{item.checked && <Icon name="check" scale="glyph" />}</styled.Mark>
            <styled.Text>{item.label}</styled.Text>
            <styled.Shortcut>{item.shortcut}</styled.Shortcut>
            <styled.Mark>{item.items && <Icon name="submenu" scale="glyph" />}</styled.Mark>
          </styled.Item>
        );
      })}
      {open !== null && (entries[open] as MenuEntry)?.items && (
        <MenuList
          items={(entries[open] as MenuEntry).items!}
          x={sub.x}
          y={sub.y}
          flipX={sub.flip}
          onClose={onClose} />
      )}
    </styled.List>
  );
};

/** Closes `onClose` on any outside pointer down or Escape */
function useDismiss(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    addEventListener('pointerdown', onClose, ctrl);
    addEventListener('blur', onClose, ctrl);
    addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }, { ...ctrl, capture: true });
    return () => ctrl.abort();
  }, [active]);
}

export const ContextMenuHost: FC = () => {
  useSignals();
  const popup = context.value;
  useDismiss(!!popup, closeContextMenu);
  if (!popup) return null;
  return createPortal(
    <MenuList items={popup.items} x={popup.x} y={popup.y} onClose={closeContextMenu} />,
    document.body
  );
};

export type MenuBarProps = {
  /** `label` is a text key (`menu.file`) */
  menus: { label: string; items: () => MenuItems; }[];
  children?: React.ReactNode;
};

export const MenuBar: FC<MenuBarProps> = ({ menus, children }) => {
  useSignals();
  const [open, setOpen] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useDismiss(open !== null, () => setOpen(null));

  const show = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom });
    setOpen(i);
  };

  return (
    <styled.Bar>
      {menus.map((menu, i) => (
        <styled.Title
          key={menu.label}
          data-open={open === i}
          onPointerDown={e => {
            e.stopPropagation();
            open === i ? setOpen(null) : show(i, e.currentTarget);
          }}
          onPointerEnter={e => { if (open !== null && open !== i) show(i, e.currentTarget); }}
        >
          {t(menu.label)}
        </styled.Title>
      ))}
      {children}
      {open !== null && createPortal(
        <MenuList items={menus[open].items()} x={pos.x} y={pos.y} onClose={() => setOpen(null)} />,
        document.body
      )}
    </styled.Bar>
  );
};
