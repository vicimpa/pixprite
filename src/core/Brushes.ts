import { t } from "~/core/i18n";
import { state, type CustomBrush, type LibraryItem, type ToolPreset } from "~/core/State";
import type { StampPreset } from "~/core/Stamps";

// Brush library: custom brushes and two-color patterns kept across sessions or in the project

function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function fromBase64(text: string) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function itemFromBrush(b: CustomBrush, name: string): LibraryItem {
  const bytes = new Uint8Array(b.bmp.data.buffer.slice(b.bmp.data.byteOffset, b.bmp.data.byteOffset + b.bmp.data.byteLength));
  return { id: newId(), name, kind: 'brush', w: b.bmp.w, h: b.bmp.h, data: toBase64(bytes), ox: b.ox, oy: b.oy, align: b.align, tint: b.tint };
}

export function itemFromPattern(p: NonNullable<typeof state.patternBits>, name: string): LibraryItem {
  return { id: newId(), name, kind: 'pattern', w: p.w, h: p.h, data: toBase64(p.bits) };
}

export function useItem(item: LibraryItem) {
  const bytes = fromBase64(item.data);
  if (item.kind === 'brush') {
    const data = new Uint32Array(bytes.buffer.slice(0, item.w * item.h * 4));
    state.customBrush = { bmp: { w: item.w, h: item.h, data }, ox: item.ox ?? 0, oy: item.oy ?? 0, align: item.align ?? 'stroke', tint: item.tint };
    state.activeStamp = null;
  } else {
    state.patternBits = { w: item.w, h: item.h, bits: bytes.slice(0, item.w * item.h) };
    state.paintPattern = 'custom';
  }
}

/** Saves the current custom brush (or else the paint pattern) to the library or the project */
export function saveCurrentToLibrary(where: 'library' | 'document', name?: string) {
  const b = state.customBrush, p = state.patternBits;
  const kind = b ? 'brush' : 'pattern';
  const list = where === 'library' ? state.brushLibrary : state.docBrushes;
  const label = name || `${t(kind === 'brush' ? 'brush.brush' : 'common.pattern')} ${list.length + 1}`;
  const item = b ? itemFromBrush(b, label) : p ? itemFromPattern(p, label) : null;
  if (!item) return null;
  if (where === 'library') state.brushLibrary = [...state.brushLibrary, item];
  else state.docBrushes = [...state.docBrushes, item];
  return item;
}

export function removeItem(id: string) {
  state.brushLibrary = state.brushLibrary.filter(i => i.id !== id);
  state.docBrushes = state.docBrushes.filter(i => i.id !== id);
}

/** Converts a stamp preset mask into a tinted custom brush. Built-in stamps paint with the primary color. */
export function stampToBrush(stamp: StampPreset): CustomBrush {
  const data = new Uint32Array(stamp.w * stamp.h);
  for (let i = 0; i < data.length; i++) data[i] = stamp.mask[i] ? 0xff000000 : 0;
  return { bmp: { w: stamp.w, h: stamp.h, data }, ox: 0, oy: 0, align: 'dab', tint: true };
}

/** Applies a built-in stamp preset as the current brush */
export function applyStamp(stamp: StampPreset) {
  state.customBrush = stampToBrush(stamp);
  state.activeStamp = stamp.id;
}

// Tool presets: named sets of tool settings

export const PRESET_KEYS = [
  'brushSize', 'brushShape', 'brushAngle', 'ink', 'opacity', 'pixelPerfect', 'stabilizer', 'filled', 'cornerRadius',
  'paintPattern', 'patternDensity', 'sprayWidth', 'spraySpeed', 'gradientType', 'gradientDither', 'tolerance', 'contiguous',
] as const;

export function savePreset(name: string) {
  const self = state as unknown as Record<string, unknown>;
  const values = Object.fromEntries(PRESET_KEYS.map(k => [k, self[k]]));
  const preset: ToolPreset = { name, tool: state.tool, values };
  state.toolPresets = [...state.toolPresets.filter(p => p.name !== name), preset];
}

export function applyPreset(name: string) {
  const preset = state.toolPresets.find(p => p.name === name);
  if (!preset) return;
  const self = state as unknown as Record<string, unknown>;
  state.tool = preset.tool;
  for (const k of PRESET_KEYS) if (k in preset.values && preset.values[k] !== undefined) self[k] = preset.values[k];
  // A pattern preset needs a captured pattern to work
  if (state.paintPattern === 'custom' && !state.patternBits) state.paintPattern = 'none';
}

export function deletePreset(name: string) {
  state.toolPresets = state.toolPresets.filter(p => p.name !== name);
}
