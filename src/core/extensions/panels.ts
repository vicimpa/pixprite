/**
 * Where extension panels are and whether they are shown. Kept apart from the host so the
 * interface can read it without loading the extension runtime. Panels are keyed `<ext>/<panel id>`;
 * what the user changes (shown / closed, docked side or floating, position and sizes) is
 * remembered in this browser.
 */

import { deferSetting } from '../DeferredSettings';
import { computed, signal } from "@preact/signals-react";

export type Dock = 'left' | 'right' | 'bottom' | 'float';
export type Side = Exclude<Dock, 'float'>;

/** What the user changed about one panel; unset fields follow the manifest */
export type PanelPlace = {
  hidden?: boolean; dock?: Dock;
  /** Floating window */
  x?: number; y?: number; w?: number; h?: number;
};

export type ExtensionPanelLayout = {
  panels: Record<string, PanelPlace>;
  sides: Partial<Record<Side, number>>;
  /** Docked panels of a side share it as tabs: the open tab of each side */
  tabs: Partial<Record<Side, string>>;
  /** The panel shown last; its tab is brought to front */
  focus?: string;
};

type Layout = ExtensionPanelLayout;
export const EMPTY_PANEL_LAYOUT: ExtensionPanelLayout = { panels: {}, sides: {}, tabs: {} };
const STORE = 'pixprite:extPanels';

export function normalizePanelLayout(value: unknown): ExtensionPanelLayout {
  const obj = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
  const v = obj(value), panels: Record<string, PanelPlace> = {}, sides: Layout['sides'] = {}, tabs: Layout['tabs'] = {};
  for (const [key, raw] of Object.entries(obj(v.panels))) {
    if (!key.includes('/') || key.length > 200) continue;
    const p = obj(raw), item: PanelPlace = {};
    if (typeof p.hidden === 'boolean') item.hidden = p.hidden;
    if (['left', 'right', 'bottom', 'float'].includes(String(p.dock))) item.dock = p.dock as Dock;
    for (const key of ['x', 'y', 'w', 'h'] as const) if (typeof p[key] === 'number' && Number.isFinite(p[key])) {
      item[key] = Math.max(key === 'w' || key === 'h' ? 60 : -100000, Math.min(key === 'w' || key === 'h' ? 4000 : 100000, p[key]));
    }
    panels[key] = item;
  }
  for (const side of ['left', 'right', 'bottom'] as const) {
    const size = obj(v.sides)[side], tab = obj(v.tabs)[side];
    if (typeof size === 'number' && Number.isFinite(size)) sides[side] = Math.max(60, Math.min(4000, size));
    if (typeof tab === 'string') tabs[side] = tab;
  }
  return { panels, sides, tabs, ...(typeof v.focus === 'string' ? { focus: v.focus } : {}) };
}
function read(): Layout {
  try { return normalizePanelLayout(JSON.parse(localStorage.getItem(STORE) ?? '{}')); }
  catch { return normalizePanelLayout(null); }
}
export const panelLayout = signal<Layout>(read());
export function restorePanelLayout(value: unknown) {
  panelLayout.value = normalizePanelLayout(value);
  deferSetting(STORE, panelLayout.peek());
}
function update(fn: (l: Layout) => Layout) { restorePanelLayout(fn(panelLayout.peek())); }

/** Panels the manifest declares `hidden` (until shown) */
const hiddenByDefault = signal<ReadonlySet<string>>(new Set());

export const panelKey = (ext: string, id: string) => `${ext}/${id}`;

/** Panels that are not shown */
export const hiddenPanels = computed<ReadonlySet<string>>(() => {
  const { panels } = panelLayout.value;
  const out = new Set<string>();
  for (const k of hiddenByDefault.value) if (panels[k]?.hidden !== false) out.add(k);
  for (const [k, p] of Object.entries(panels)) if (p.hidden) out.add(k);
  return out;
});

/** Called when an extension's panel loads: `hidden` panels start closed unless the user opened them */
export function declarePanel(ext: string, id: string, hidden: boolean) {
  const k = panelKey(ext, id);
  if (hidden === hiddenByDefault.peek().has(k)) return;
  const next = new Set(hiddenByDefault.peek());
  if (hidden) next.add(k); else next.delete(k);
  hiddenByDefault.value = next;
}

export function setPanelVisible(ext: string, id: string, visible: boolean) {
  const key = panelKey(ext, id);
  placePanel(key, { hidden: !visible });
  if (visible) update(l => ({ ...l, focus: key }));
}

export function selectTab(side: Side, key: string) {
  update(l => ({ ...l, tabs: { ...l.tabs, [side]: key }, focus: key }));
}

/** The open tab of a side among `keys`: the panel shown last if it is there, else the chosen one, else the first */
export function activeTab(side: Side, keys: string[]) {
  const l = panelLayout.value;
  if (l.focus && keys.includes(l.focus)) return l.focus;
  return keys.includes(l.tabs[side] ?? '') ? l.tabs[side]! : keys[0];
}

export function togglePanel(ext: string, id: string) {
  setPanelVisible(ext, id, hiddenPanels.peek().has(panelKey(ext, id)));
}

export function placePanel(key: string, patch: PanelPlace) {
  update(l => ({ ...l, panels: { ...l.panels, [key]: { ...l.panels[key], ...patch } } }));
}

/** Where a panel is: the user's choice, or what the manifest says */
export const dockOf = (key: string, declared: Dock): Dock => panelLayout.value.panels[key]?.dock ?? declared;

/** Width of the left / right column of docked panels, or height of the bottom row */
export const sideSize = (side: Side) => panelLayout.value.sides[side] ?? (side === 'bottom' ? 160 : 240);

export function setSideSize(side: Side, size: number) {
  update(l => ({ ...l, sides: { ...l.sides, [side]: size } }));
}
