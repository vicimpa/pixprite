/**
 * Where extension panels are and whether they are shown. Kept apart from the host so the
 * interface can read it without loading the extension runtime. Panels are keyed `<ext>/<panel id>`;
 * what the user changes (shown / closed, docked side or floating, position and sizes) is
 * remembered in this browser.
 */

import { computed, signal } from "@preact/signals-react";

export type Dock = 'left' | 'right' | 'bottom' | 'float';
export type Side = Exclude<Dock, 'float'>;

/** What the user changed about one panel; unset fields follow the manifest */
export type PanelPlace = {
  hidden?: boolean; dock?: Dock;
  /** Floating window */
  x?: number; y?: number; w?: number; h?: number;
};

type Layout = {
  panels: Record<string, PanelPlace>;
  sides: Partial<Record<Side, number>>;
  /** Docked panels of a side share it as tabs: the open tab of each side */
  tabs: Partial<Record<Side, string>>;
  /** The panel shown last; its tab is brought to front */
  focus?: string;
};

const STORE = 'pixprite:extPanels';

function read(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    const obj = (x: unknown) => x && typeof x === 'object' ? x : {};
    return { panels: obj(v?.panels) as Layout['panels'], sides: obj(v?.sides) as Layout['sides'], tabs: obj(v?.tabs) as Layout['tabs'] };
  } catch { return { panels: {}, sides: {}, tabs: {} }; }
}

export const panelLayout = signal<Layout>(read());

let timer: ReturnType<typeof setTimeout> | undefined;
function update(fn: (l: Layout) => Layout) {
  panelLayout.value = fn(panelLayout.peek());
  // Dragging changes it every frame; storage is written once things settle
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(panelLayout.peek())); } catch { /* storage off: this session only */ } }, 250);
}

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
