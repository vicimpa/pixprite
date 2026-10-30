import type { FrameSpan } from './TimelineFolding';
import type { SpriteContext } from "./SpriteContext";
import type { ColorMode } from "~/core/ColorMode";
import { Mask } from "~/core/Mask";
import type { Tileset } from "~/core/Tilemap";
import { copyLayers, type ExtData, type Floating, type Frame, type FramePalette, type Guide, type Layer, type Slice, type Tag } from "./SpriteModel";
import { isCelInstance, isImage, retainedBufferIdentity, visitCelBuffers, visitImageBuffers } from './DocumentModel';
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
  hiddenFrameRanges: FrameSpan[];
  slices: Slice[];
  tilesets: Tileset[];
  loop: [number, number] | null;
  mask: Mask | null;
  floating: Floating | null;
  floatingStart: number;
  layer: number;
  frame: number;
};

/** Preferences: combined undo/redo step count, total payload bytes and per-operation bytes (0 = uncapped). */
export const historyLimits = { steps: 256, bytes: 0, operationBytes: 0 };

export type HistoryGuard = { commit(): void; cancel(): void; abandon(): void; onRelease?: () => void };

export function snapshot(this: SpriteContext, label: string): Snapshot {
  const { width, height, layers, frames, tags, loop, mask, floating, layer, frame } = this;
  return { label, hiddenFrameRanges: this.hiddenFrameRanges.map(r => [...r]), ext: this.ext, guides: this.guides, palette: this.paletteHost?.get() ?? null, framePalettes: this.framePalettes, colorMode: this.colorMode, transparentIndex: this.transparentIndex, width, height, layers: copyLayers(layers), frames: frames.map(f => ({ ...f })), tags: tags.map(t => ({ ...t })), slices: this.slices, tilesets: this.tilesets, loop, mask, floating, floatingStart: this.floatingStart, layer, frame };
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
  this.hiddenFrameRanges = s.hiddenFrameRanges.map(r => [...r]);
  this.slices = s.slices;
  this.guides = s.guides;
  this.tilesets = s.tilesets;
  this.selectedSlices = this.selectedSlices.filter(i => i < s.slices.length);
  this.loop = s.loop;
  this.mask = s.mask;
  this.floating = s.floating;
  this.floatingStart = s.floatingStart;
  this.syncFloatingHistory();
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

/** Payload accounting, not a JS/GPU heap estimate. No accessors or bitmap rendering.
 * Backing stores are charged once at their full allocation size, even for subarray views.
 * Metadata charges UTF-8 strings/property names, 8-byte numbers and 1-byte booleans;
 * engine object/array headers, allocator and GPU overhead are deliberately excluded.
 */
type MemoryIndex = { buffers: Map<object, number>; metadata: Map<object, number> };
const encoder = new TextEncoder();
function memoryIndex(root: unknown, dynamic?: object[]): MemoryIndex {
  const buffers = new Map<object, number>(), metadata = new Map<object, number>();
  const buffer = (identity: object, bytes: number) => { buffers.set(identity, bytes); };
  const scalar = (value: unknown): number => typeof value === 'string' ? encoder.encode(value).length
    : typeof value === 'number' ? 8 : typeof value === 'boolean' ? 1 : 0;
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object' || metadata.has(value)) return;
    if (dynamic && (isCelInstance(value as any) || value instanceof Mask)) { dynamic.push(value); return; }
    if (ArrayBuffer.isView(value)) { buffer(retainedBufferIdentity(value.buffer), value.buffer.byteLength); return; }
    if (value instanceof ArrayBuffer) { buffer(retainedBufferIdentity(value), value.byteLength); return; }
    metadata.set(value, 0);
    if (isCelInstance(value as any)) visitCelBuffers(value as any, buffer, (identity, bytes) => metadata.set(identity, bytes));
    if (isImage(value)) visitImageBuffers(value, buffer);
    let bytes = 0;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor) || typeof descriptor.value === 'function') continue;
      bytes += encoder.encode(key).length + scalar(descriptor.value);
      walk(descriptor.value);
    }
    metadata.set(value, bytes);
  }
  walk(root);
  return { buffers, metadata };
}
// Snapshots own immutable metadata. Only compatibility cel bitmaps and mask edges may be
// allocated later; refresh those small ownership records without rescanning old metadata.
// Weak keys release all accounting state as soon as a snapshot is evicted.
const snapshotIndices = new WeakMap<Snapshot, { index: MemoryIndex; dynamic: object[] }>();
function snapshotIndex(snapshot: Snapshot): MemoryIndex {
  let cached = snapshotIndices.get(snapshot);
  if (!cached) {
    const dynamic: object[] = [];
    snapshotIndices.set(snapshot, cached = { index: memoryIndex(snapshot, dynamic), dynamic: [...new Set(dynamic)] });
  }
  if (!cached.dynamic.length) return cached.index;
  const index = { buffers: new Map(cached.index.buffers), metadata: new Map(cached.index.metadata) };
  for (const root of cached.dynamic) {
    const current = memoryIndex(root);
    for (const kind of ['buffers', 'metadata'] as const) for (const [identity, bytes] of current[kind]) index[kind].set(identity, bytes);
  }
  return index;
}
function liveIndex(doc: SpriteContext) {
  // These are the same ownership roots as a snapshot. Do not copy layers or touch cel.data.
  const { ext, guides, framePalettes, layers, frames, tags, slices, tilesets, loop, mask, floating } = doc;
  return memoryIndex({ ext, guides, palette: doc.paletteHost?.get() ?? null, framePalettes, layers, frames, tags, hiddenFrameRanges: doc.hiddenFrameRanges, slices, tilesets, loop, mask, floating });
}
function exclusive(index: Map<object, number>, live: Map<object, number>) {
  let bytes = 0;
  for (const [identity, size] of index) if (!live.has(identity)) bytes += size;
  return bytes;
}
function difference(a: MemoryIndex, b: MemoryIndex) {
  return exclusive(a.buffers, b.buffers) + exclusive(b.buffers, a.buffers)
    + exclusive(a.metadata, b.metadata) + exclusive(b.metadata, a.metadata);
}

/** History-exclusive buffers plus deterministic metadata payload. */
export function historyBytes(this: SpriteContext): number {
  const memory = retainedHistoryMemory.call(this);
  return memory.uniqueBufferBytes + memory.metadataPayloadBytes;
}

/** Read-only diagnostic using the same ownership and payload model as the budget. */
export function retainedHistoryMemory(this: SpriteContext) {
  const live = liveIndex(this), history: MemoryIndex = { buffers: new Map(), metadata: new Map() };
  for (const step of [...this.undoStack, ...this.redoStack]) {
    const index = snapshotIndex(step);
    for (const kind of ['buffers', 'metadata'] as const) for (const [identity, bytes] of index[kind]) history[kind].set(identity, bytes);
  }
  return { uniqueBufferBytes: exclusive(history.buffers, live.buffers), metadataPayloadBytes: exclusive(history.metadata, live.metadata),
    undoSteps: this.undoStack.length, redoSteps: this.redoStack.length };
}

/** Keep contiguous reachable history. Oldest undo is removed first, then farthest redo.
 * A step over the operation budget is a barrier: discard that step and everything beyond it.
 * The completed edit stays in the document, and undo can never jump over the barrier.
 * A single snapshot over the total budget is also removed; no minimum-one exception.
 */
export function trimHistory(this: SpriteContext): void {
  if (this.historyGuardCount) return;
  if (!this.undoStack.length && !this.redoStack.length) return;
  const before = this.undoStack.length + this.redoStack.length;
  const dropUndo = (count: number) => { this.undoStack.splice(0, count); this.historyOffset += count; };
  const steps = Math.max(1, historyLimits.steps);
  while (this.undoStack.length + this.redoStack.length > steps) {
    if (this.undoStack.length) dropUndo(1); else this.redoStack.shift();
  }
  if (historyLimits.bytes > 0 || historyLimits.operationBytes > 0) {
    const live = liveIndex(this);
    const undo = this.undoStack.map(snapshotIndex), redo = this.redoStack.map(snapshotIndex);
    if (historyLimits.operationBytes > 0) {
      // Compare adjacent states in both directions, including newly created large buffers.
      for (let i = undo.length - 1; i >= 0; i--) if (difference(undo[i], undo[i + 1] ?? live) > historyLimits.operationBytes) {
        dropUndo(i + 1); undo.splice(0, i + 1); this.historyLimitNotice = 'operation'; break;
      }
      for (let i = redo.length - 1; i >= 0; i--) if (difference(redo[i], redo[i + 1] ?? live) > historyLimits.operationBytes) {
        this.redoStack.splice(0, i + 1); redo.splice(0, i + 1); this.historyLimitNotice = 'operation'; break;
      }
    }
    if (historyLimits.bytes > 0) {
      // Reference counts let each removal update the union in linear time. No repeated scans
      // of the remaining history, and never a scan of pixel contents.
      const refs = new Map<object, { count: number; bytes: number }>();
      let bytes = 0;
      for (const index of [...undo, ...redo]) for (const kind of ['buffers', 'metadata'] as const)
        for (const [identity, size] of index[kind]) if (!live[kind].has(identity)) {
          const ref = refs.get(identity);
          if (ref) ref.count++; else { refs.set(identity, { count: 1, bytes: size }); bytes += size; }
        }
      const remove = (index: MemoryIndex) => {
        for (const kind of ['buffers', 'metadata'] as const) for (const identity of index[kind].keys()) {
          const ref = refs.get(identity);
          if (ref && --ref.count === 0) { bytes -= ref.bytes; refs.delete(identity); }
        }
      };
      while (bytes > historyLimits.bytes && (undo.length || redo.length)) {
        if (undo.length) { remove(undo.shift()!); dropUndo(1); }
        else { remove(redo.shift()!); this.redoStack.shift(); }
        this.historyLimitNotice = 'memory';
      }
    }
  }
  if (before !== this.undoStack.length + this.redoStack.length) {
    this.historyBoundary = true;
    this.syncHistory();
  }
}

/** Undo back to `depth` steps and forget the undone ones (cancelled strokes) */
export function rollback(this: SpriteContext, depth: number): void {
  if (this.historyPosition <= depth) return;
  while (this.historyPosition > depth && this.undoStack.length) this.undo();
  this.redoStack = [];
  this.syncHistory();
}

/** Jump so that exactly `count` steps are applied */
export function goToStep(this: SpriteContext, count: number): void {
  while (this.undoStack.length > count && this.undoStack.length) this.undo();
  while (this.undoStack.length < count && this.redoStack.length) this.redo();
}
