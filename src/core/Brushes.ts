import { t } from "~/core/i18n";
import { state, type CustomBrush, type LibraryItem, type ToolPreset } from "~/core/State";
import type { StampPreset } from '~/core/Stamps';
import { BRUSH_KEYS, readBrushParameters, type BrushParameters } from './BrushParameters';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export function captureBrushSettings(): BrushParameters {
  const self = state as unknown as Record<string, unknown>;
  return copy(Object.fromEntries(BRUSH_KEYS.map(key => [key, self[key]])));
}
export function applyBrushSettings(settings: BrushParameters) {
  const self = state as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(readBrushParameters(settings))) self[key] = copy(value);
}

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
  return { id: newId(), name, kind: 'brush', w: b.bmp.w, h: b.bmp.h, data: toBase64(bytes), ox: b.ox, oy: b.oy, align: b.align, tint: b.tint, stampId: b.stampId, settings: captureBrushSettings() };
}

export function itemFromPattern(p: NonNullable<typeof state.patternBits>, name: string): LibraryItem {
  return { id: newId(), name, kind: 'pattern', w: p.w, h: p.h, data: toBase64(p.bits) };
}

export function useItem(item: LibraryItem) {
  const bytes = fromBase64(item.data);
  if (item.kind === 'brush') {
    const data = new Uint32Array(bytes.buffer.slice(0, item.w * item.h * 4));
    state.customBrush = { bmp: { w: item.w, h: item.h, data }, ox: item.ox ?? 0, oy: item.oy ?? 0, align: item.align ?? 'stroke', tint: item.tint, stampId: item.stampId };
    if (item.settings) applyBrushSettings(item.settings);
    else { state.brushScale = 100; state.brushFlipX = state.brushFlipY = false; state.brushSpacing = 0; state.brushMode = 'continuous'; }
  } else {
    state.patternBits = { w: item.w, h: item.h, bits: bytes.slice(0, item.w * item.h) };
    state.paintPattern = 'custom';
  }
}

/** Persist first so a full browser settings store cannot silently lose an imported library. */
export function replaceBrushLibrary(items: LibraryItem[]) {
  localStorage.setItem('pixprite:brushes', JSON.stringify({ items }));
  state.brushLibrary = items;
}

export function addImportedBrushes(items: LibraryItem[]) {
  const names = new Set(state.brushLibrary.map(item => item.name));
  const added = items.map(item => {
    let name = item.name, n = 2;
    while (names.has(name)) name = `${item.name} (${n++})`;
    names.add(name);
    return { ...item, id: newId(), name };
  });
  replaceBrushLibrary([...state.brushLibrary, ...added]);
  useItem(added[0]);
}

/** Saves the current custom brush (or else the paint pattern) to the library or the project */
export function saveCurrentToLibrary(where: 'library' | 'document', name?: string) {
  const b = state.customBrush, p = state.patternBits;
  const kind = b ? 'brush' : 'pattern';
  const list = where === 'library' ? state.brushLibrary : state.docBrushes;
  const label = name || `${t(kind === 'brush' ? 'brush.brush' : 'common.pattern')} ${list.length + 1}`;
  const item = b ? itemFromBrush(b, label) : p ? itemFromPattern(p, label) : null;
  if (!item) return null;
  if (where === 'library') {
    try { replaceBrushLibrary([...state.brushLibrary, item]); }
    catch { state.showTip(t('brush.saveFailed'), 5000); return null; }
  }
  else state.docBrushes = [...state.docBrushes, item];
  return item;
}

export function removeItem(id: string) {
  state.brushLibrary = state.brushLibrary.filter(i => i.id !== id);
  state.docBrushes = state.docBrushes.filter(i => i.id !== id);
}

// Tool presets: named sets of tool settings

/** Built-in masks use the same bitmap brush path as captured artwork. */
export function applyStamp(stamp: StampPreset) {
  const data = Uint32Array.from(stamp.mask, value => value ? 0xff000000 : 0);
  state.customBrush = { bmp: { w: stamp.w, h: stamp.h, data }, ox: 0, oy: 0, align: 'dab', tint: true, stampId: stamp.id };
}

export const PRESET_KEYS = [
  'brushSize', 'brushShape', 'brushAngle', 'brushAngleDynamics', 'brushScale', 'brushFlipX', 'brushFlipY', 'brushMode', 'brushSpacing', 'pressure', 'ink', 'opacity', 'pixelPerfect', 'stabilizer', 'filled', 'cornerRadius',
  'paintPattern', 'patternDensity', 'sprayWidth', 'spraySpeed', 'gradientType', 'gradientDither', 'tolerance', 'contiguous',
] as const;

export function savePreset(name: string) {
  const self = state as unknown as Record<string, unknown>;
  const values = copy(Object.fromEntries(PRESET_KEYS.map(k => [k, self[k]])));
  const preset: ToolPreset = { name, tool: state.tool, values,
    brush: state.customBrush ? itemFromBrush(state.customBrush, name) : null,
    pattern: state.patternBits ? itemFromPattern(state.patternBits, name) : null };
  const items = [...state.toolPresets.filter(p => p.name !== name), preset];
  try { localStorage.setItem('pixprite:toolPresets', JSON.stringify({ items })); }
  catch { state.showTip(t('brush.saveFailed'), 5000); return false; }
  state.toolPresets = items;
  return true;
}

export function applyPreset(name: string) {
  const preset = state.toolPresets.find(p => p.name === name);
  if (!preset) return;
  const self = state as unknown as Record<string, unknown>;
  state.tool = preset.tool;
  if ('brush' in preset) { if (preset.brush) useItem(preset.brush); else state.customBrush = null; }
  if ('pattern' in preset) { if (preset.pattern) useItem(preset.pattern); else state.patternBits = null; }
  for (const k of PRESET_KEYS) if (k in preset.values && preset.values[k] !== undefined) self[k] = copy(preset.values[k]);
  for (const [key, value] of Object.entries({ brushScale: 100, brushMode: 'continuous', brushSpacing: 0, brushFlipX: false, brushFlipY: false }))
    if (!(key in preset.values)) self[key] = value;
  if (!['fixed', 'stroke', 'tilt', 'twist'].includes(preset.values.brushAngleDynamics as string)) state.brushAngleDynamics = 'fixed';
  // A pattern preset needs a captured pattern to work
  if (state.paintPattern === 'custom' && !state.patternBits) state.paintPattern = 'none';
}

export function deletePreset(name: string) {
  state.toolPresets = state.toolPresets.filter(p => p.name !== name);
}
