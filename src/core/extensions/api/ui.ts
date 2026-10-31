/**
 * ui.*, view.*, state.* and playback.*: dialogs, the camera and the editor state an extension may touch.
 * Dialogs the core has no generic version of yet (forms, color picker, progress) go through `uiBridge`,
 * which the interface fills in; until then they resolve as cancelled.
 */
import type { FormSchema, FormValues, Rect, StateKey } from "@pixprite/api";
import { signal } from "@preact/signals-react";
import { Color } from "~/core/Color";
import { pickFile as pickLocalFile } from "~/core/Files";
import { state, type ToolName } from "~/core/State";
import { TOOLS } from "~/core/Tools";
import { askConfirm, askText } from "~/ui/Dialog";
import { isFormSchema, resolveStrings } from "../manifest";
import { fail, isObject, type Handlers } from "./common";
import { setPanelVisible } from "../panels";

function showPanel(host: { id: string; manifest: { contributes?: { panels?: { id: string; }[]; }; }; }, id: unknown, visible: boolean) {
  if (!host.manifest.contributes?.panels?.some(p => p.id === id)) fail('not-found', `No panel "${String(id)}"`);
  setPanelVisible(host.id, String(id), visible);
}

export type NotifyKind = 'info' | 'success' | 'warning' | 'error';

/** Rects outlined on the canvas by `view.reveal`, in sprite pixels; fade out at `until` (performance.now) */
export const highlights = signal<{ rect: Rect; until: number; }[]>([]);
const HIGHLIGHT_MS = 1200;

/** Running progress bars of extensions, shown by the interface */
export const progressBars = signal<{ id: number; ext: string; label: string; value: number; }[]>([]);

/** Pieces of interface the host can't draw itself; the UI sets them at start */
export const uiBridge = {
  notify(message: string, _kind: NotifyKind, _ext: string) { state.showNotice(message, 3000); },
  async showForm(_title: string, _schema: FormSchema, _ext: string): Promise<FormValues | null> { return null; },
  async pickColor(_initial: string | undefined): Promise<string | null> { return null; },
};

let nextProgress = 1;

const STATE_KEYS: StateKey[] = ['fg', 'bg', 'tool', 'brushSize'];

export function readState(key: StateKey) {
  switch (key) {
    case 'fg': return state.colorA.toHexString();
    case 'bg': return state.colorB.toHexString();
    case 'tool': return state.tool;
    case 'brushSize': return state.brushSize;
  }
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const uiHandlers: Handlers = {
  'ui.notify': (c, message, kind = 'info') => uiBridge.notify(String(message), (['info', 'success', 'warning', 'error'].includes(kind) ? kind : 'info') as NotifyKind, c.host.id),
  'ui.confirm': (c, message, opts) => {
    const o = isObject(opts) ? opts : {};
    const str = (v: unknown) => typeof v === 'string' ? v : undefined;
    return askConfirm(String(message), { title: str(o.title) ?? c.host.name, ok: str(o.ok), cancel: str(o.cancel) });
  },
  'ui.prompt': (c, message, value) => askText(String(message), typeof value === 'string' ? value : '', { title: c.host.name }),
  'ui.pickColor': (_c, initial) => uiBridge.pickColor(typeof initial === 'string' && HEX.test(initial) ? initial : undefined),
  'ui.pickFile': async (_c, opts) => {
    const accept = isObject(opts) && typeof opts.accept === 'string' ? opts.accept : '';
    const file = await pickLocalFile(accept) as File | null | undefined;
    return file ? { name: file.name, data: await file.arrayBuffer() } : null;
  },
  'ui.progress': (c, label) => {
    const id = nextProgress++;
    progressBars.value = [...progressBars.peek(), { id, ext: c.host.id, label: String(label), value: 0 }];
    c.host.onDispose(() => { progressBars.value = progressBars.peek().filter(p => p.id !== id); });
    return id;
  },
  'ui.progress.update': (_c, id, value) => {
    progressBars.value = progressBars.peek().map(p => p.id === id ? { ...p, value: Math.max(0, Math.min(1, Number(value) || 0)) } : p);
  },
  'ui.progress.done': (_c, id) => { progressBars.value = progressBars.peek().filter(p => p.id !== id); },
  'ui.panels.show': (c, id) => showPanel(c.host, id, true),
  'ui.panels.hide': (c, id) => showPanel(c.host, id, false),
  'ui.showForm': (c, title, schema) => {
    if (!isFormSchema(schema)) fail('invalid', 'schema is not a FormSchema');
    return uiBridge.showForm(String(title), resolveStrings(schema, c.host.strings()), c.host.id);
  },

  'view.zoom': () => state.zoom,
  'view.setZoom': (_c, z) => { state.zoomTo(Math.max(0.25, Math.min(128, Number(z) || 1))); },
  'view.pan': () => ({ x: state.camX, y: state.camY }),
  'view.setPan': (_c, p) => { if (isObject(p)) state.panTo(Number(p.x) || 0, Number(p.y) || 0); },
  'view.toScreen': (_c, p) => isObject(p) ? { x: state.offsetX + Number(p.x) * state.zoom, y: state.offsetY + Number(p.y) * state.zoom } : fail('invalid', 'point'),
  'view.toSprite': (_c, p) => isObject(p) ? { x: (Number(p.x) - state.offsetX) / state.zoom, y: (Number(p.y) - state.offsetY) / state.zoom } : fail('invalid', 'point'),
  'view.reveal': (_c, target) => {
    const o = isObject(target) ? target : {};
    const s = state.sprite;
    const index = (v: unknown, list: unknown[], what: string) =>
      typeof v === 'number' && Number.isInteger(v) && list[v] ? v : fail('not-found', `No ${what} ${String(v)}`);
    if (o.layer !== undefined) s.layer = index(o.layer, s.layers, 'layer');
    if (o.frame !== undefined) s.frame = index(o.frame, s.frames, 'frame');
    if (!isObject(o.rect)) return;
    const r = o.rect;
    const rect = { x: Number(r.x) || 0, y: Number(r.y) || 0, w: Math.max(1, Number(r.w) || 1), h: Math.max(1, Number(r.h) || 1) };
    // Out of view (even partly): fly to its center, zooming out only when it doesn't fit
    if (state.viewW && state.viewH) {
      const zoom = state.zoomTarget;
      const vw = state.viewW / zoom, vh = state.viewH / zoom;
      const visible = rect.x >= state.camX - vw / 2 && rect.x + rect.w <= state.camX + vw / 2
        && rect.y >= state.camY - vh / 2 && rect.y + rect.h <= state.camY + vh / 2;
      if (!visible) {
        const fit = Math.min(state.viewW / rect.w, state.viewH / rect.h) * 0.85;
        state.flyTo(Math.min(zoom, Math.max(1, fit)), rect.x + rect.w / 2, rect.y + rect.h / 2);
      }
    }
    if (o.highlight) {
      const now = performance.now();
      highlights.value = [...highlights.peek().filter(h => h.until > now), { rect, until: now + HIGHLIGHT_MS }];
    }
  },

  'state.get': (_c, key) => STATE_KEYS.includes(key) ? readState(key) : fail('invalid', `Unknown state ${key}`),
  'state.set': (_c, key, value) => {
    switch (key as StateKey) {
      case 'fg':
      case 'bg': {
        if (typeof value !== 'string' || !HEX.test(value)) fail('invalid', 'Color must be a css hex string');
        if (key === 'fg') state.colorA = Color.fromHex(value); else state.colorB = Color.fromHex(value);
        return;
      }
      case 'tool':
        if (!TOOLS.some(t => t.name === value)) fail('not-found', `Unknown tool ${value}`);
        state.tool = value as ToolName;
        return;
      case 'brushSize':
        state.brushSize = Math.max(1, Math.min(64, Math.round(Number(value) || 1)));
        return;
    }
    fail('invalid', `Unknown state ${key}`);
  },

  'playback.play': () => { if (!state.home) state.playing = true; },
  'playback.stop': () => { state.playing = false; },
  'playback.seek': (_c, frame) => {
    const s = state.sprite;
    const f = Number(frame);
    if (!Number.isInteger(f) || !s.frames[f]) fail('not-found', `No frame ${frame}`);
    s.frame = f;
  },
};
