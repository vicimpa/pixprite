import type { SpriteContext } from "./SpriteContext";
import type { ColorMode } from "~/core/ColorMode";
import type { Mask } from "~/core/Mask";
import type { Tileset } from "~/core/Tilemap";
import { copyLayers, type ExtData, type Floating, type Frame, type FramePalette, type Guide, type Layer, type Slice, type Tag } from "./SpriteModel";
export type Snapshot = {
  label: string;
  ext: ExtData;
  guides: Guide[];
  palette: string[] | null;
  framePalettes: FramePalette[];
  colorMode: ColorMode;
  transparentIndex: number;
  width: number;
  height: number;
  layers: Layer[];
  frames: Frame[];
  tags: Tag[];
  slices: Slice[];
  tilesets: Tileset[];
  loop: [number, number] | null;
  mask: Mask | null;
  floating: Floating | null;
  layer: number;
  frame: number;
};

/** Undo history limits (set from the preferences): step count, and memory in bytes (0 = no limit) */
export const historyLimits = { steps: 256, bytes: 0 };

export function snapshot(this: SpriteContext, label: string): Snapshot {
  const { width, height, layers, frames, tags, loop, mask, floating, layer, frame } = this;
  return { label, ext: this.ext, guides: this.guides, palette: this.paletteHost?.get() ?? null, framePalettes: this.framePalettes, colorMode: this.colorMode, transparentIndex: this.transparentIndex, width, height, layers: copyLayers(layers), frames: frames.map(f => ({ ...f })), tags: tags.map(t => ({ ...t })), slices: this.slices, tilesets: this.tilesets, loop, mask, floating, layer, frame };
}

export function restore(this: SpriteContext, s: Snapshot): void {
  this.ext = s.ext;
  this.framePalettes = s.framePalettes;
  if (s.palette) this.paletteHost?.set(s.palette);
  this.colorMode = s.colorMode;
  this.transparentIndex = s.transparentIndex;
  this.width = s.width;
  this.height = s.height;
  this.layers = copyLayers(s.layers);
  this.frames = s.frames.map(f => ({ ...f }));
  this.tags = s.tags.map(t => ({ ...t }));
  this.slices = s.slices;
  this.guides = s.guides;
  this.tilesets = s.tilesets;
  this.selectedSlices = this.selectedSlices.filter(i => i < s.slices.length);
  this.loop = s.loop;
  this.mask = s.mask;
  this.floating = s.floating;
  this.layer = Math.min(s.layer, s.layers.length - 1);
  this.frame = Math.min(s.frame, s.frames.length - 1);
  this.range = null;
  this.touch();
}

export function syncHistory(this: SpriteContext): void {
  this.history = this.undoStack.map(s => s.label);
  this.future = this.redoStack.map(s => s.label).reverse();
}

/** Call before any mutation that should be undoable; `label` is shown in the history panel */
export function checkpoint(this: SpriteContext, label = 'Edit'): void {
  this.undoStack.push(this.snapshot(label));
  this.redoStack = [];
  this.trimHistory();
  this.syncHistory();
}

export function undo(this: SpriteContext): void {
  const s = this.undoStack.pop();
  if (!s) return;
  this.redoStack.push(this.snapshot(s.label));
  this.restore(s);
  this.syncHistory();
}

export function redo(this: SpriteContext): void {
  const s = this.redoStack.pop();
  if (!s) return;
  this.undoStack.push(this.snapshot(s.label));
  this.restore(s);
  this.syncHistory();
}

/** Pixel memory kept only by history (cels the current document doesn't share) */
export function historyBytes(this: SpriteContext): number {
  const live = new Set<Uint32Array>();
  for (const l of this.layers) for (const c of l.cels) if (c) live.add(c.data);
  const seen = new Set<Uint32Array>();
  let n = 0;
  for (const s of [...this.undoStack, ...this.redoStack]) for (const l of s.layers) for (const c of l.cels)
    if (c && !live.has(c.data) && !seen.has(c.data)) { seen.add(c.data); n += c.data.byteLength; }
  return n;
}

/** Drops the oldest steps beyond the limits */
export function trimHistory(this: SpriteContext): void {
  const before = this.undoStack.length;
  while (this.undoStack.length > Math.max(1, historyLimits.steps)) this.undoStack.shift();
  if (historyLimits.bytes > 0)
    while (this.undoStack.length > 1 && this.historyBytes() > historyLimits.bytes) this.undoStack.shift();
  if (before !== this.undoStack.length) this.syncHistory();
}

/** Undo back to `depth` steps and forget the undone ones (cancelled strokes) */
export function rollback(this: SpriteContext, depth: number): void {
  if (this.undoStack.length <= depth) return;
  while (this.undoStack.length > depth) this.undo();
  this.redoStack = [];
  this.syncHistory();
}

/** Jump so that exactly `count` steps are applied */
export function goToStep(this: SpriteContext, count: number): void {
  while (this.undoStack.length > count && this.undoStack.length) this.undo();
  while (this.undoStack.length < count && this.redoStack.length) this.redo();
}
