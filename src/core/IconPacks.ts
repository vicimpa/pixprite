import { signal } from '@preact/signals-react';
import { parseIconPack } from './extensions/iconPack';
import outline from '../ui/Icon/outline.json';

export const DEFAULT_ICON_PACK = 'outline';
// Keep the original pixel ID so an explicit choice in an existing profile stays pixel.
export const PIXEL_ICON_PACK = 'builtin';
const builtinOutline = parseIconPack(outline);
const builtins = new Map([
  [DEFAULT_ICON_PACK, 'iconPacks.outline'], [PIXEL_ICON_PACK, 'iconPacks.builtin'],
]);
const legacy: Record<string, string> = { 'icons-outline:outline': DEFAULT_ICON_PACK, 'icons-pixel:pixel': PIXEL_ICON_PACK };
export const selectedIconPack = signal(DEFAULT_ICON_PACK);
export const iconPacks = signal(new Map<string, { label: () => string; icons: ReturnType<typeof parseIconPack> }>());

export function resolveIconPack(id: string) {
  const normalized = legacy[id] ?? id;
  return builtins.has(normalized) || iconPacks.value.has(normalized) ? normalized : DEFAULT_ICON_PACK;
}

export function iconPackChoices(translate: (key: string) => string): [string, string][] {
  return [...[...builtins].map(([id, key]): [string, string] => [id, translate(key)]),
    ...[...iconPacks.value].filter(([id]) => !legacy[id]).map(([id, pack]): [string, string] => [id, pack.label()])];
}

/** Partial extensions and unavailable packs inherit the complete built-in outline set. */
export function iconArtwork(id: string, name: string) {
  const resolved = resolveIconPack(id);
  return resolved === PIXEL_ICON_PACK ? undefined : iconPacks.value.get(resolved)?.icons[name] ?? builtinOutline[name];
}

/** Keep the preference on removal: fall back per icon and restore the pack when enabled again. */
export function registerIconPack(id: string, label: () => string, data: unknown) {
  if (builtins.has(id)) throw new Error(`Reserved built-in icon pack: ${id}`);
  const entry = { label, icons: parseIconPack(data) };
  iconPacks.value = new Map(iconPacks.peek()).set(id, entry);
  return () => {
    if (iconPacks.peek().get(id) !== entry) return;
    const next = new Map(iconPacks.peek()); next.delete(id); iconPacks.value = next;
  };
}
