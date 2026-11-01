import "@pixprite/ui/elements";
import { t } from "~/core/i18n";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { createElement, useLayoutEffect, useRef, type FC } from "react";
import { createPortal } from "react-dom";
import { type PxMenuElement, type PxMenuBarElement, type PxIcon, type MenuItems } from "@pixprite/ui/elements";
import * as styled from "./styled";
import { iconArtwork, resolveIconPack, selectedIconPack } from '~/core/IconPacks';
import { ICONS } from '~/ui/Icon/icons';

function iconProvider(pack: string) {
  return (name: 'check' | 'submenu', doc: Document) => {
    const element = doc.createElement('px-icon') as PxIcon;
    element.setAttribute('name', name); element.setAttribute('pack', resolveIconPack(pack));
    element.pixels = ICONS[name]; element.artwork = iconArtwork(pack, name) ?? undefined; element.scale = 'glyph';
    return element;
  };
}

export type { MenuEntry, MenuItems } from "@pixprite/ui/elements";
type Popup = { items: MenuItems; x: number; y: number; };
const context = signal<Popup | null>(null);
export function openContextMenu(items: MenuItems, x: number, y: number) { context.value = { items, x, y }; }
export function closeContextMenu() { context.value = null; }

type ListProps = { items: MenuItems; x: number; y: number; onClose: () => void; flipX?: number; };
/** Only editor state crosses this adapter; menu DOM and behavior live in the kit. */
export const MenuList: FC<ListProps> = ({ items, x, y, onClose, flipX }) => {
  useSignals();
  const pack = selectedIconPack.value;
  const ref = useRef<PxMenuElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.iconProvider = iconProvider(pack); element.flipX = flipX; element.x = x; element.y = y; element.items = items;
    element.addEventListener('px-dismiss', onClose);
    return () => element.removeEventListener('px-dismiss', onClose);
  }, [items, x, y, flipX, onClose, pack]);
  return createElement('px-menu', { ref });
};

export const ContextMenuHost: FC = () => {
  useSignals();
  const popup = context.value;
  return popup && createPortal(<MenuList {...popup} onClose={closeContextMenu} />, document.body);
};

export type MenuBarProps = { menus: { label: string; items: () => MenuItems; }[]; children?: React.ReactNode; };
export const MenuBar: FC<MenuBarProps> = ({ menus, children }) => {
  useSignals();
  const ref = useRef<PxMenuBarElement>(null);
  const pack = selectedIconPack.value;
  useLayoutEffect(() => { ref.current!.iconProvider = iconProvider(pack); ref.current!.menus = menus.map(menu => ({ ...menu, label: t(menu.label) })); });
  return createElement('px-menu-bar', { ref },
    <styled.Bar>
      {menus.map((menu, index) => <styled.Title key={menu.label} data-menu-index={index}>{t(menu.label)}</styled.Title>)}
      {children}
    </styled.Bar>);
};
