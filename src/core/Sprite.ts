import {
  type Bitmap, type Rect,
  blendOver, bitmapToCanvas, crop, flipH, flipV, opaqueBounds, place, rotate, scaleNearest, toImageData, unionRect,
} from "~/core/Image";
import { convertPixels, type ColorMode, type Dither, type PaletteMap } from "~/core/ColorMode";
import { Mask } from "~/core/Mask";
import {
  alignToTiles, composeFlags, cutTile, findTileFlipped, flagsOf, tileUsage, isEmptyTile, newTileset, renderTiles, sameTile, tileImage, tileIndex, tileOf, transformTile,
  type TileRefs, type Tileset, type TilesetMode,
} from "~/core/Tilemap";
import type { AseDocument } from "~/core/formats/Aseprite";
import type { UserData } from "~/core/Tilemap";
import { renderPlacement, type Algorithm, type Placement } from "~/core/Transform";
import { prop, reactive } from "@vicimpa/decorators";
import { signal } from "@preact/signals-react";
import type { LockFlags, Locks, LocksRecord, MetaTarget } from "@pixprite/api";

export { packRgba, unpackRgba } from "~/core/Image";

/** Data that extensions attach to a document part, one JSON value per extension id */
export type ExtData = Record<string, unknown>;

/**
 * A cel's own image, placed at (x, y) in sprite coordinates. It can be larger than the canvas
 * or lie partly outside it: the canvas only clips what is shown, pixels outside are kept.
 * Treated as immutable; the same object in several frames = linked cels.
 */
export type CelImage = Rect & {
  data: Uint32Array;
  /** Tilemap cels: the tile references behind `data` (position is aligned to the tile grid) */
  tiles?: TileRefs;
  /** Extension data of this cel (shared by linked frames) */
  ext?: ExtData;
};

export type Cel = CelImage | null;

export const celRect = ({ x, y, w, h }: CelImage): Rect => ({ x, y, w, h });

/** Copy of `cel` resized to `rect` (pixels outside it are dropped, new area is transparent) */
export function reframeCel(cel: CelImage | null, rect: Rect, fill = 0): CelImage {
  const data = new Uint32Array(rect.w * rect.h);
  if (fill) data.fill(fill);
  if (cel) {
    const x0 = Math.max(rect.x, cel.x), x1 = Math.min(rect.x + rect.w, cel.x + cel.w);
    const y0 = Math.max(rect.y, cel.y), y1 = Math.min(rect.y + rect.h, cel.y + cel.h);
    if (x1 > x0)
      for (let y = y0; y < y1; y++) {
        const s = (y - cel.y) * cel.w + (x0 - cel.x);
        data.set(cel.data.subarray(s, s + x1 - x0), (y - rect.y) * rect.w + (x0 - rect.x));
      }
  }
  return { ...rect, data };
}

/**
 * Tags from frame names: neighbours that differ only by their number share a tag
 * ("run_0.png", "run_1.png" → "run"). Nothing when every frame ends up in one group.
 */
export function tagsByName(names: string[]) {
  const base = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[\s._#-]*\d+$/, '').trim();
  const runs: { name: string; from: number; to: number; }[] = [];
  names.forEach((n, i) => {
    const b = base(n), last = runs[runs.length - 1];
    if (last && last.name === b) last.to = i;
    else runs.push({ name: b, from: i, to: i });
  });
  return runs.length > 1 ? runs.filter(r => r.name).map(r => ({ ...r, direction: 'forward', color: undefined as string | undefined })) : [];
}

export function trimCel(cel: CelImage | null): Cel {
  if (!cel) return null;
  const b = opaqueBounds(cel);
  if (!b) return null;
  if (b.w === cel.w && b.h === cel.h) return cel;
  return reframeCel(cel, { x: cel.x + b.x, y: cel.y + b.y, w: b.w, h: b.h });
}

export function cloneCel(cel: Cel): Cel {
  return cel && { ...cel, data: cel.data.slice() };
}

export function celPixel(cel: Cel, x: number, y: number) {
  if (!cel) return 0;
  const lx = x - cel.x, ly = y - cel.y;
  return lx >= 0 && ly >= 0 && lx < cel.w && ly < cel.h ? cel.data[ly * cel.w + lx] : 0;
}

export const BLEND_MODES = [
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const satisfies GlobalCompositeOperation[];

export type BlendMode = typeof BLEND_MODES[number];

export type Layer = {
  name: string;
  visible: boolean;
  locked: boolean;
  /** Bottom-most opaque layer: always full, can't be moved, erasing paints the secondary color */
  background: boolean;
  /** New frames link this layer's cels instead of copying them */
  continuous: boolean;
  opacity: number;
  blend: BlendMode;
  /** Cel images per frame; the same object in several frames = linked cels */
  cels: Cel[];
  /** Per-frame cel opacity, 0..1 */
  celOpacity: number[];
  /**
   * Groups hold no cels; their children are the contiguous run right below them
   * in the (bottom-to-top) layer list with a greater `depth`.
   */
  group: boolean;
  /** Nesting level, 0 = top level */
  depth: number;
  /** Group rows folded in the timeline */
  collapsed: boolean;
  /** Index into the sprite's tilesets for tilemap layers, -1 for pixel layers */
  tileset: number;
  /** Shown only where the nearest non-clipped layer below has pixels */
  clip?: boolean;
  /** Note and color attached by the user */
  userData?: UserData;
  /** Reference layer: an outside image shown in the editor only, never exported or sampled */
  reference?: RefImage | null;
  ext?: ExtData;
};

/** Image of a reference layer placed in sprite coordinates; `src` is a data URL */
export type RefImage = { src: string; x: number; y: number; scale: number; angle?: number; };

/** Guide line in sprite pixels: vertical ones at x, horizontal ones at y */
export type Guide = { axis: 'x' | 'y'; pos: number; };

/** What the author tells about the project; shown on the home page and saved with the file */
export type ProjectInfo = { description?: string; tags?: string[]; genre?: string; author?: string; };

/** Info with blanks dropped: trimmed texts, no empty or repeated tags */
export function cleanInfo(info: unknown): ProjectInfo {
  const src = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
  const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const tags = Array.isArray(src.tags) ? [...new Set(src.tags.map(text).filter((v): v is string => !!v))] : [];
  const out: ProjectInfo = { description: text(src.description), tags: tags.length ? tags : undefined, genre: text(src.genre), author: text(src.author) };
  for (const k of Object.keys(out) as (keyof ProjectInfo)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Timeline selection: whole frames, whole layers, or a rectangle of cels */
export type Range = {
  type: 'frames' | 'layers' | 'cels';
  layers: [number, number];
  frames: [number, number];
};

export type Frame = {
  duration: number;
  ext?: ExtData;
};

export type TagDirection = 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse';

export type Tag = {
  name: string;
  from: number;
  to: number;
  color: string;
  direction: TagDirection;
  /** Times the tag plays before moving on / stopping; 0 or missing = forever */
  repeat?: number;
  /** Note attached by the user (the tag color is `color`) */
  userData?: UserData;
  ext?: ExtData;
};

export type SliceKey = {
  /** The key applies from this frame until the next key */
  frame: number;
  x: number; y: number; w: number; h: number;
  /** 9-slice middle, relative to the slice */
  center?: Rect;
  /** Pivot point, relative to the slice */
  pivot?: { x: number; y: number; };
};

/** Named rectangle for game engines (hit boxes, 9-slice UI, pivots); keys make it change over frames */
export type Slice = {
  name: string;
  color: string;
  keys: SliceKey[];
  /** Note attached by the user (the slice color is `color`) */
  userData?: UserData;
  ext?: ExtData;
};

/** The slice's key for a frame, or null when it doesn't exist / is hidden there */
export function sliceKey(slice: Slice, frame: number): SliceKey | null {
  let best: SliceKey | null = null;
  for (const k of slice.keys) if (k.frame <= frame && (!best || k.frame > best.frame)) best = k;
  return best && best.w > 0 && best.h > 0 ? best : null;
}

/** Pixels lifted out of a cel (paste / move selection) that float above it until dropped */
export type Floating = {
  /** Untouched lifted pixels and their shape (1 = belongs to the selection) */
  src: Bitmap;
  shape: Uint8Array;
  place: Placement;
  layer: number;
  frame: number;
  /** `src` rendered at `place` */
  result: { x: number; y: number; bmp: Bitmap; mask: Uint8Array; };
};

/** Timeline content copied for pasting back into the timeline */
export type RangeClip =
  | { type: 'layers'; layers: Layer[]; }
  | { type: 'frames'; frames: { duration: number; cels: { cel: Cel; op: number; }[]; }[]; }
  | { type: 'cels'; rows: { layer: number; cels: { cel: Cel; op: number; }[]; }[]; };

/** A palette that applies from `frame` until the next one */
export type FramePalette = { frame: number; colors: string[]; };

/** Parts of a document an extension can lock, and what can be done to them */
export type LockKind = 'tags' | 'layers' | 'frames' | 'slices' | 'palette' | 'canvas';
export type LockOp = keyof LockFlags;

/**
 * Last operation refused by document locks; the reason is an i18n key (`locks.<kind>.<op>`).
 * `at` changes on every refusal so the same reason twice still notifies.
 */
export const lockedNotice = signal<{ kind: LockKind; op: LockOp; reason: string; owner: string; at: number; } | null>(null);

/** Extensions known to be installed; locks of other owners show up as `orphanLocks` (set by the extension host) */
export const lockOwners = { installed: (_id: string) => true };

function isExtData(v: unknown): v is ExtData {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isLocksRecord(v: unknown): v is LocksRecord {
  return isExtData(v) && typeof v.owner === 'string';
}

type Snapshot = {
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
const TAG_COLORS = ['#e0a33a', '#5aa9d6', '#9bd35a', '#d65a8f', '#a07be0', '#e06a4a'];

/** `next` with the extension data of the cel it replaces */
function keepExt(prev: CelImage, next: Cel): Cel {
  return next && prev.ext && !next.ext ? { ...next, ext: prev.ext } : next;
}

function copyLayers(layers: Layer[]) {
  return layers.map(l => ({ ...l, cels: l.cels.slice(), celOpacity: l.celOpacity.slice() }));
}

function newLayer(name: string, frames: number): Layer {
  return {
    name, visible: true, locked: false, background: false, continuous: true,
    opacity: 1, blend: 'source-over', cels: Array(frames).fill(null), celOpacity: Array(frames).fill(1),
    group: false, depth: 0, collapsed: false, tileset: -1,
  };
}

/** First index of the block made of layer `i` and everything nested in it (the block ends at `i`) */
export function subtreeStart(layers: Layer[], i: number) {
  const d = layers[i]?.depth ?? 0;
  let s = i;
  while (s > 0 && layers[s - 1].depth > d) s--;
  return s;
}

/** Index of the group containing layer `i`, or -1 at top level */
export function parentOf(layers: Layer[], i: number) {
  const d = layers[i]?.depth ?? 0;
  if (!d) return -1;
  for (let k = i + 1; k < layers.length; k++) if (layers[k].depth < d) return k;
  return -1;
}

/** Direct children of group `g`, bottom to top */
export function childrenOf(layers: Layer[], g: number) {
  const out: number[] = [];
  const d = layers[g].depth;
  for (let k = subtreeStart(layers, g); k < g; k++) if (layers[k].depth === d + 1) out.push(k);
  return out;
}

/** Top-level layers, bottom to top */
export function rootsOf(layers: Layer[]) {
  return layers.map((l, i) => l.depth === 0 ? i : -1).filter(i => i >= 0);
}

/**
 * Repairs nesting after reordering: a layer can only be as deep as the layer above allows
 * (one deeper than a group above it, the same depth as a plain layer above it).
 */
function normalizeDepths(layers: Layer[]) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const above = layers[i + 1];
    const max = !above ? 0 : above.group ? above.depth + 1 : above.depth;
    if (layers[i].depth > max) layers[i] = { ...layers[i], depth: max };
    if (layers[i].background && layers[i].depth) layers[i] = { ...layers[i], depth: 0 };
  }
  return layers;
}

const span = ([a, b]: [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

@reactive()
export class Sprite {
  @prop name = 'untitled';
  @prop info: ProjectInfo = {};
  @prop width = 32;
  @prop height = 32;
  @prop layers: Layer[] = [];
  @prop frames: Frame[] = [];
  @prop tags: Tag[] = [];
  @prop slices: Slice[] = [];
  /** Guide lines of the document (replaced, never mutated) */
  @prop guides: Guide[] = [];
  /** Locked guides can't be dragged or removed with the mouse */
  @prop guidesLocked = false;
  /** Tilesets used by tilemap layers (replaced, never mutated, so undo can keep old ones) */
  @prop tilesets: Tileset[] = [];
  @prop tilesetMode: TilesetMode = 'auto';
  /** Slices picked with the slice tool */
  @prop selectedSlices: number[] = [];
  @prop layer = 0;
  @prop frame = 0;
  /** Timeline range; commands apply to it when set */
  @prop range: Range | null = null;
  /** Playback loop section (inclusive frames), used when no tag covers the current frame */
  @prop loop: [number, number] | null = null;

  /** Pixels are always RGBA; indexed / gray sprites keep every written pixel on the palette / gray */
  @prop colorMode: ColorMode = 'rgb';
  /** Palettes that change over the animation (empty = one palette for every frame) */
  @prop framePalettes: FramePalette[] = [];

  /** The palette key in effect at a frame */
  framePaletteAt(frame = this.frame) {
    let best: FramePalette | null = null;
    for (const k of this.framePalettes) if (k.frame <= frame && (!best || k.frame > best.frame)) best = k;
    return best;
  }

  /** Frames a palette key governs */
  framesOfPalette(key: FramePalette) {
    const next = Math.min(this.frames.length, ...this.framePalettes.filter(k => k.frame > key.frame).map(k => k.frame));
    return new Set(Array.from({ length: next - key.frame }, (_, i) => key.frame + i));
  }

  /** From this frame on, a separate copy of the palette (the first one also covers frame 0) */
  addFramePalette(colors: string[]) {
    if (this.refuse('palette', 'create')) return;
    if (this.framePalettes.some(k => k.frame === this.frame)) return;
    this.checkpoint('Palette for frame');
    const base = this.framePalettes.length ? this.framePalettes : [{ frame: 0, colors: colors.slice() }];
    this.framePalettes = this.frame === 0 ? base : [...base, { frame: this.frame, colors: colors.slice() }].sort((a, b) => a.frame - b.frame);
    this.touch();
  }

  /** Drops this frame's palette key (frames fall back to the previous one) */
  removeFramePalette() {
    if (this.refuse('palette', 'delete')) return;
    const k = this.framePaletteAt();
    if (!k) return;
    this.checkpoint('Remove frame palette');
    const rest = this.framePalettes.filter(x => x !== k);
    // A single remaining key at frame 0 is the same as one global palette
    this.framePalettes = rest.length === 1 && rest[0].frame === 0 ? [] : rest;
    this.touch();
  }

  /** Where the app palette lives, so history can save and restore it */
  paletteHost: { get(): string[]; set(p: string[]): void; } | null = null;

  /**
   * Records a palette change after the fact: the step remembers `before` as the palette to go back to.
   * Steps arriving within `mergeMs` of the previous palette step are merged into it (slider drags).
   */
  private lastPaletteStep = 0;
  paletteStep(before: string[], mergeMs = 600) {
    const now = performance.now();
    if (this.history.at(-1) === 'Palette' && now - this.lastPaletteStep < mergeMs) { this.lastPaletteStep = now; return; }
    this.lastPaletteStep = now;
    this.checkpoint('Palette');
    this.undoStack[this.undoStack.length - 1].palette = before;
  }

  /** Extension data of the whole document */
  @prop ext: ExtData = {};
  /** Locks set by an extension (one owner at a time), null when none */
  @prop locks: LocksRecord | null = null;
  /** Locks loaded from a file whose owner extension isn't installed: UI offers to unlock */
  @prop orphanLocks: LocksRecord | null = null;

  /** Palette lookup for the indexed mode, kept in sync with the app palette */
  palette: PaletteMap | null = null;
  /** Indexed mode: palette entry that stands for transparency (-1 = none) */
  transparentIndex = -1;

  @prop mask: Mask | null = null;
  @prop floating: Floating | null = null;
  /** Resampling used for rotated/scaled floating pixels */
  @prop transformAlgo: Algorithm = 'fast';
  /** History depth right after the floating pixels were lifted (for cancel), -1 when none */
  private floatingStart = -1;
  private lastMask: Mask | null = null;

  /** Id of this open editor's working copy (survives reloads until the tab is closed) */
  sessionId: string | null = null;

  /** Id of the stored project (IndexedDB), null until first stored */
  @prop projectId: string | null = null;
  /** `version` when last written to storage */
  storedVersion = -1;
  /** Editor snapshot (JSON) when last written to storage */
  storedEditor = '';

  /** Camera of this document while another one is shown */
  view: { zoom: number; camX: number; camY: number; } | null = null;
  /** Editor settings that belong to this project (tool, colors, view toggles…), applied when it is shown */
  editor: Record<string, unknown> | null = null;
  /** `version` when last saved on purpose (Ctrl+S), -1 = has unsaved changes from an earlier session */
  @prop savedVersion = 0;

  /** Unsaved: never saved as a project (new, imported, copied), or changed since the last Ctrl+S */
  get modified() { return !this.projectId || this.version !== this.savedVersion; }

  markSaved() { this.savedVersion = this.version; }

  /** Replaces the project info (not an undo step, but the document counts as changed) */
  setInfo(info: ProjectInfo) {
    this.info = cleanInfo(info);
    this.touch();
  }

  /** Bumped on every pixel or structure change */
  @prop version = 0;
  @prop history: string[] = [];
  @prop future: string[] = [];

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private cache = new Map<string, OffscreenCanvas>();
  private cacheVersion = -1;

  constructor(width = 32, height = 32) {
    this.reset(width, height);
  }

  get size() { return this.width * this.height; }
  get undoDepth() { return this.undoStack.length; }
  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get current() { return this.layers[this.layer]; }
  get editable() { return !!this.current && !this.current.group && !this.current.reference && this.visibleDeep(this.layer) && !this.lockedDeep(this.layer); }

  /** Visible itself and inside visible groups */
  visibleDeep(i: number): boolean {
    for (let k = i; k >= 0; k = parentOf(this.layers, k)) if (!this.layers[k]?.visible) return false;
    return true;
  }

  lockedDeep(i: number): boolean {
    for (let k = i; k >= 0; k = parentOf(this.layers, k)) if (this.layers[k]?.locked) return true;
    return false;
  }

  reset(width: number, height: number, name = 'untitled') {
    this.name = name;
    this.info = {};
    this.colorMode = 'rgb';
    this.width = width;
    this.height = height;
    this.layers = [newLayer('Layer 1', 1)];
    this.frames = [{ duration: 100 }];
    this.tags = [];
    this.slices = [];
    this.guides = [];
    this.selectedSlices = [];
    this.tilesets = [];
    this.framePalettes = [];
    this.transparentIndex = -1;
    this.ext = {};
    this.locks = null;
    this.orphanLocks = null;
    this.loop = null;
    this.layer = 0;
    this.frame = 0;
    this.range = null;
    this.mask = null;
    this.floating = null;
    this.lastMask = null;
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistory();
    this.touch();
    // A fresh document has nothing to save yet
    this.savedVersion = this.version;
  }

  touch() {
    this.version++;
  }

  private snapshot(label: string): Snapshot {
    const { width, height, layers, frames, tags, loop, mask, floating, layer, frame } = this;
    return { label, ext: this.ext, guides: this.guides, palette: this.paletteHost?.get() ?? null, framePalettes: this.framePalettes, colorMode: this.colorMode, transparentIndex: this.transparentIndex, width, height, layers: copyLayers(layers), frames: frames.map(f => ({ ...f })), tags: tags.map(t => ({ ...t })), slices: this.slices, tilesets: this.tilesets, loop, mask, floating, layer, frame };
  }

  private restore(s: Snapshot) {
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

  private syncHistory() {
    this.history = this.undoStack.map(s => s.label);
    this.future = this.redoStack.map(s => s.label).reverse();
  }

  /** Call before any mutation that should be undoable; `label` is shown in the history panel */
  checkpoint(label = 'Edit') {
    this.undoStack.push(this.snapshot(label));
    this.redoStack = [];
    this.trimHistory();
    this.syncHistory();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot(s.label));
    this.restore(s);
    this.syncHistory();
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot(s.label));
    this.restore(s);
    this.syncHistory();
  }

  /** Pixel memory kept only by history (cels the current document doesn't share) */
  historyBytes() {
    const live = new Set<Uint32Array>();
    for (const l of this.layers) for (const c of l.cels) if (c) live.add(c.data);
    const seen = new Set<Uint32Array>();
    let n = 0;
    for (const s of [...this.undoStack, ...this.redoStack]) for (const l of s.layers) for (const c of l.cels)
      if (c && !live.has(c.data) && !seen.has(c.data)) { seen.add(c.data); n += c.data.byteLength; }
    return n;
  }

  /** Drops the oldest steps beyond the limits */
  trimHistory() {
    const before = this.undoStack.length;
    while (this.undoStack.length > Math.max(1, historyLimits.steps)) this.undoStack.shift();
    if (historyLimits.bytes > 0)
      while (this.undoStack.length > 1 && this.historyBytes() > historyLimits.bytes) this.undoStack.shift();
    if (before !== this.undoStack.length) this.syncHistory();
  }

  /** Undo back to `depth` steps and forget the undone ones (cancelled strokes) */
  rollback(depth: number) {
    if (this.undoStack.length <= depth) return;
    while (this.undoStack.length > depth) this.undo();
    this.redoStack = [];
    this.syncHistory();
  }

  /** Jump so that exactly `count` steps are applied */
  goToStep(count: number) {
    while (this.undoStack.length > count && this.undoStack.length) this.undo();
    while (this.undoStack.length < count && this.redoStack.length) this.redo();
  }

  /** Whether locks forbid `op` on `kind` ('canvas' = any canvas size change under a fixed size) */
  isLocked(kind: LockKind, op: LockOp) {
    const l = this.locks;
    if (!l) return false;
    if (kind === 'canvas') return !!l.constraints?.canvasSize;
    return !!l[kind]?.[op];
  }

  /** True (and a `lockedNotice`) when locks forbid the operation; mutators return early then */
  private refuse(kind: LockKind, op: LockOp) {
    if (!this.isLocked(kind, op)) return false;
    lockedNotice.value = { kind, op, reason: `locks.${kind}.${op}`, owner: this.locks!.owner, at: performance.now() };
    return true;
  }

  /** A fixed canvas size only allows changes that end at that size */
  private refuseSize(width: number, height: number) {
    const c = this.locks?.constraints?.canvasSize;
    return !!c && (c.w !== width || c.h !== height) && this.refuse('canvas', 'resize');
  }

  /** Tag lock checks for frames inserted before `at` (count > 0) or removed at `at` (count < 0) */
  private refuseFrameShift(at: number, count: number) {
    if (!this.locks?.tags) return false;
    const inside = this.tags.some(t => count > 0 ? at > t.from && at <= t.to : at >= t.from && at <= t.to);
    const after = this.tags.some(t => t.from > at || (count > 0 && t.from === at));
    const gone = count < 0 && this.tags.some(t => t.from === at && t.to === at);
    return (gone && this.refuse('tags', 'delete')) || (inside && this.refuse('tags', 'resize')) || (after && this.refuse('tags', 'move'));
  }

  /** Replaces the locks; refused when another extension owns the current ones */
  setLocks(owner: string, locks: Locks) {
    if (this.locks && this.locks.owner !== owner) return false;
    this.locks = { ...locks, owner };
    if (this.orphanLocks?.owner === owner) this.orphanLocks = null;
    this.touch();
    return true;
  }

  getLocks(): LocksRecord | null {
    return this.locks;
  }

  /** Drops the locks of `owner` (also the orphaned ones, when the user unlocks) */
  clearLocks(owner: string) {
    if (this.orphanLocks?.owner === owner) this.orphanLocks = null;
    if (this.locks?.owner !== owner) return false;
    this.locks = null;
    this.touch();
    return true;
  }

  /** Checks orphaned locks again after extensions were installed or removed */
  refreshLockOwner() {
    const l = this.locks ?? this.orphanLocks;
    this.orphanLocks = l && !lockOwners.installed(l.owner) ? l : null;
  }

  /**
   * Checks the locks' constraints that aren't enforced while editing
   * (frame multiple, color count; `colors` = used palette size)
   */
  constraintIssues(colors?: number) {
    const c = this.locks?.constraints;
    const out: { key: string; vars: Record<string, number>; }[] = [];
    if (!c) return out;
    if (c.frameMultiple && this.frames.length % c.frameMultiple)
      out.push({ key: 'locks.constraint.frameMultiple', vars: { count: this.frames.length, multiple: c.frameMultiple } });
    if (c.maxColors && colors !== undefined && colors > c.maxColors)
      out.push({ key: 'locks.constraint.maxColors', vars: { count: colors, max: c.maxColors } });
    if (c.canvasSize && (c.canvasSize.w !== this.width || c.canvasSize.h !== this.height))
      out.push({ key: 'locks.constraint.canvasSize', vars: { w: c.canvasSize.w, h: c.canvasSize.h } });
    return out;
  }

  /** The extension's data on a part of the document, undefined when none */
  getExtData(target: MetaTarget, extId: string): unknown {
    return this.extHolder(target)?.ext?.[extId];
  }

  /** Sets (undefined removes) the extension's data on a part of the document; false when the part doesn't exist */
  setExtData(target: MetaTarget, extId: string, value: unknown, label: string | null = 'Extension data') {
    const holder = this.extHolder(target);
    if (!holder) return false;
    const ext: ExtData = { ...holder.ext };
    if (value === undefined) delete ext[extId];
    else ext[extId] = value;
    if (label) this.checkpoint(label);
    const next = Object.keys(ext).length ? ext : undefined;
    switch (target.kind) {
      case 'sprite': this.ext = next ?? {}; break;
      case 'layer': this.layers = this.layers.map((l, i) => i === target.layer ? { ...l, ext: next } : l); break;
      case 'frame': this.frames = this.frames.map((f, i) => i === target.frame ? { ...f, ext: next } : f); break;
      case 'tag': this.tags = this.tags.map((t, i) => i === target.tag ? { ...t, ext: next } : t); break;
      case 'slice': this.slices = this.slices.map((x, i) => i === target.slice ? { ...x, ext: next } : x); break;
      case 'cel': {
        // Cels are immutable: linked frames get the same new object
        const old = holder as CelImage, cel: CelImage = { ...old, ext: next };
        this.layers = this.layers.map((l, i) => i === target.layer ? { ...l, cels: l.cels.map(c => c === old ? cel : c) } : l);
        break;
      }
    }
    this.touch();
    return true;
  }

  private extHolder(t: MetaTarget): { ext?: ExtData; } | null {
    switch (t.kind) {
      case 'sprite': return this;
      case 'layer': return this.layers[t.layer] ?? null;
      case 'frame': return this.frames[t.frame] ?? null;
      case 'tag': return this.tags[t.tag] ?? null;
      case 'slice': return this.slices[t.slice] ?? null;
      case 'cel': return this.layers[t.layer]?.cels[t.frame] ?? null;
    }
  }

  getCel(layer = this.layer, frame = this.frame) {
    return this.layers[layer]?.cels[frame] ?? null;
  }

  get canvasRect(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  /** The canvas-sized window of a cel (a copy; pixels outside the canvas are not included) */
  canvasPixels(layer = this.layer, frame = this.frame) {
    return reframeCel(this.getCel(layer, frame), this.canvasRect).data;
  }

  getBitmap(layer = this.layer, frame = this.frame): Bitmap {
    return { w: this.width, h: this.height, data: this.canvasPixels(layer, frame) };
  }

  /** Pixel of a cel in sprite coordinates (also outside the canvas) */
  celPixel(x: number, y: number, layer = this.layer, frame = this.frame) {
    return celPixel(this.getCel(layer, frame), x, y);
  }

  /**
   * Replaces a cel (and every frame linked to it) with `cel`.
   * Transparent layers are trimmed to their content, background cels always cover the canvas.
   */
  setCel(cel: Cel, layer = this.layer, frame = this.frame) {
    const l = this.layers[layer];
    if (!l) return;
    if (l.tileset >= 0) return this.setTilemapCel(cel, layer, frame);
    let next = l.background ? reframeCel(cel, this.canvasRect, this.backgroundFill) : trimCel(cel);
    // Everything written lands on the palette (indexed) or on gray
    if (next && this.colorMode !== 'rgb') {
      next = { ...next, data: next.data.slice() };
      convertPixels(next.data, next.w, next.h, this.colorMode, this.palette);
      if (!l.background) next = trimCel(next);
    }
    const old = l.cels[frame];
    if (old) l.cels.forEach((c, f) => { if (c === old) l.cels[f] = next; });
    else l.cels[frame] = next;
    this.touch();
  }

  /**
   * Writes a canvas-sized buffer into a cel. The cel grows to cover the canvas while editing,
   * so pixels it had outside the canvas survive, then it is trimmed again.
   */
  putCanvas(data: Uint32Array, layer = this.layer, frame = this.frame) {
    const cel = this.getCel(layer, frame);
    const rect = unionRect(cel && celRect(cel), this.canvasRect)!;
    const out = reframeCel(cel, rect);
    const ox = -rect.x, oy = -rect.y;
    for (let y = 0; y < this.height; y++)
      out.data.set(data.subarray(y * this.width, (y + 1) * this.width), (y + oy) * rect.w + ox);
    this.setCel(out, layer, frame);
  }

  get tileset(): Tileset | null {
    return this.tilesets[this.current?.tileset ?? -1] ?? null;
  }

  private replaceCel(l: Layer, frame: number, next: Cel) {
    const old = l.cels[frame];
    if (old) l.cels.forEach((c, f) => { if (c === old) l.cels[f] = next; });
    else l.cels[frame] = next;
  }

  /** Every distinct tilemap cel using tileset `t` */
  private tilemapCels(t: number) {
    const out = new Set<CelImage>();
    for (const l of this.layers) if (l.tileset === t) for (const c of l.cels) if (c?.tiles) out.add(c);
    return [...out];
  }

  /** Swaps tileset `t` and re-renders every cel that uses it (links stay links) */
  private commitTileset(t: number, ts: Tileset, remap?: (ref: number) => number) {
    this.tilesets = this.tilesets.map((x, i) => i === t ? ts : x);
    const done = new Map<CelImage, Cel>();
    for (const l of this.layers) {
      if (l.tileset !== t) continue;
      l.cels = l.cels.map(c => {
        if (!c?.tiles) return c;
        let next = done.get(c);
        if (next === undefined) {
          const tiles = remap ? { ...c.tiles, refs: c.tiles.refs.map(remap) } : c.tiles;
          next = { ...c, tiles, data: renderTiles(ts, tiles) };
          done.set(c, next);
        }
        return next;
      });
    }
  }

  /** Smallest grid-aligned cel holding the non-empty references, or null */
  private trimTiles(ts: Tileset, x: number, y: number, t: TileRefs): Cel {
    let c0 = t.cols, r0 = t.rows, c1 = -1, r1 = -1;
    for (let r = 0; r < t.rows; r++)
      for (let c = 0; c < t.cols; c++)
        if (tileOf(t.refs[r * t.cols + c])) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    if (c1 < 0) return null;
    const cols = c1 - c0 + 1, rows = r1 - r0 + 1, refs = new Uint32Array(cols * rows);
    for (let r = 0; r < rows; r++) refs.set(t.refs.subarray((r + r0) * t.cols + c0, (r + r0) * t.cols + c0 + cols), r * cols);
    const tiles = { cols, rows, refs };
    return { x: x + c0 * ts.tw, y: y + r0 * ts.th, w: cols * ts.tw, h: rows * ts.th, tiles, data: renderTiles(ts, tiles) };
  }

  /**
   * Writes a tilemap cel. A cel that already carries tile references just moves (snapped to the grid);
   * pixels are turned into tiles following the tileset mode:
   * manual edits existing tiles in place, auto reuses / edits unshared / adds and drops orphans, stack only adds.
   */
  private setTilemapCel(cel: Cel, layer: number, frame: number) {
    const l = this.layers[layer], t = l.tileset, ts = this.tilesets[t];
    const old = l.cels[frame];
    if (!cel) { this.replaceCel(l, frame, null); return this.touch(); }
    if (cel.tiles) {
      const x = Math.round(cel.x / ts.tw) * ts.tw, y = Math.round(cel.y / ts.th) * ts.th;
      this.replaceCel(l, frame, { ...cel, x, y, data: renderTiles(ts, cel.tiles) });
      return this.touch();
    }
    const area = alignToTiles(ts, old ? unionRect(celRect(old), celRect(cel))! : celRect(cel));
    const pixels = reframeCel(cel, area).data;
    const cols = area.w / ts.tw, rows = area.h / ts.th;
    const refs = new Uint32Array(cols * rows);
    const prevRef = (c: number, r: number) => {
      const o = old?.tiles;
      if (!o) return 0;
      const oc = c + (area.x - old!.x) / ts.tw, or = r + (area.y - old!.y) / ts.th;
      return oc >= 0 && or >= 0 && oc < o.cols && or < o.rows ? o.refs[or * o.cols + oc] : 0;
    };
    // How many cells use each tile, everywhere this tileset is used
    const usage = new Map<number, number>();
    for (const c of this.tilemapCels(t)) for (const ref of c.tiles!.refs) usage.set(tileOf(ref), (usage.get(tileOf(ref)) ?? 0) + 1);
    const tiles = ts.tiles.slice();
    let index = tileIndex({ ...ts, tiles });
    let changed = false;
    const replaced = new Set<number>();
    const mode = this.tilesetMode;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const img = cutTile(ts, pixels, area, c, r);
        const prevFull = prevRef(c, r), prev = tileOf(prevFull), flags = flagsOf(prevFull);
        let ref = prevFull;
        // Untouched cells still match the tile as it was before this edit (as this cell shows it)
        if (prev ? !sameTile(tileImage(ts, prevFull), img) : !isEmptyTile(img)) {
          // A flipped cell stores the edit back in the tile's own orientation
          const stored = transformTile(img, ts.tw, ts.th, flags, true);
          if (mode === 'manual') {
            // Only existing tiles are edited, and everywhere they are used
            if (prev) { tiles[prev] = stored; changed = true; }
          } else {
            const found = findTileFlipped({ ...ts, tiles }, img, index);
            if (found >= 0) ref = found;
            else if (mode === 'auto' && prev && (usage.get(prev) ?? 0) === 1) {
              tiles[prev] = stored;
              changed = true;
              index = tileIndex({ ...ts, tiles });
            } else {
              tiles.push(img);
              ref = tiles.length - 1;
              changed = true;
              index = tileIndex({ ...ts, tiles });
            }
            if (tileOf(ref) !== prev && prev) replaced.add(prev);
          }
        }
        if (tileOf(ref) !== prev) {
          usage.set(prev, (usage.get(prev) ?? 1) - 1);
          usage.set(tileOf(ref), (usage.get(tileOf(ref)) ?? 0) + 1);
        }
        refs[r * cols + c] = ref;
      }
    let next = this.trimTiles(ts, area.x, area.y, { cols, rows, refs });
    this.replaceCel(l, frame, next);
    // Auto mode drops tiles that this edit left unused and renumbers the rest
    const orphans = mode === 'auto' ? [...replaced].filter(i => !(usage.get(i) ?? 0)) : [];
    if (orphans.length) {
      const drop = new Set(orphans);
      const map = new Map<number, number>();
      const kept = tiles.filter((_, i) => { if (drop.has(i)) return false; map.set(i, map.size); return true; });
      this.commitTileset(t, { ...ts, tiles: kept }, ref => map.has(tileOf(ref)) ? (map.get(tileOf(ref))! | flagsOf(ref)) >>> 0 : 0);
      changed = false;
    } else if (changed) this.commitTileset(t, { ...ts, tiles });
    this.touch();
  }

  /** Reorders / removes tiles of the active tileset; maps keep showing the same images */
  private editTiles(label: string, order: number[]) {
    const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
    if (!ts) return;
    this.checkpoint(label);
    // order[newIndex] = oldIndex; tile 0 always stays first
    const map = new Map(order.map((old, i) => [old, i]));
    this.commitTileset(t, { ...ts, tiles: order.map(i => ts.tiles[i]) }, ref => map.has(tileOf(ref)) ? (map.get(tileOf(ref))! | flagsOf(ref)) >>> 0 : 0);
    this.touch();
  }

  /** Deletes tiles (cells that used them become empty) */
  deleteTiles(indices: number[]) {
    const ts = this.tileset;
    if (!ts) return;
    const drop = new Set(indices.filter(i => i > 0));
    if (drop.size) this.editTiles('Delete tiles', ts.tiles.map((_, i) => i).filter(i => !drop.has(i)));
  }

  /** Moves a tile to another position (never before the empty tile 0) */
  moveTile(from: number, to: number) {
    const ts = this.tileset;
    if (!ts || from < 1 || from >= ts.tiles.length) return;
    to = Math.max(1, Math.min(ts.tiles.length - 1, to));
    if (to === from) return;
    const order = ts.tiles.map((_, i) => i).filter(i => i !== from);
    order.splice(to, 0, from);
    this.editTiles('Move tile', order);
  }

  /** A copy of a tile at the end of the tileset */
  duplicateTile(index: number) {
    const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
    if (!ts || index < 1 || !ts.tiles[index]) return;
    this.checkpoint('Duplicate tile');
    this.tilesets = this.tilesets.map((x, i) => i === t ? { ...ts, tiles: [...ts.tiles, ts.tiles[index].slice()] } : x);
    this.touch();
  }

  /** How many cells use each tile of the active tileset (all layers and frames sharing it) */
  tileUsage(): number[] {
    const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
    return ts ? tileUsage(ts.tiles.length, this.tilemapCels(t)) : [];
  }

  /** Deletes the tiles no cell uses; returns how many went */
  removeUnusedTiles() {
    const use = this.tileUsage();
    const drop = use.map((n, i) => i > 0 && !n ? i : -1).filter(i => i > 0);
    if (drop.length) this.deleteTiles(drop);
    return drop.length;
  }

  /** Folds tiles equal to an earlier one (also mirrored / turned) into it; returns how many went */
  mergeDuplicateTiles() {
    const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
    if (!ts) return 0;
    // Each tile maps to a reference into the kept tiles
    const kept: Uint32Array[] = [ts.tiles[0]], to: number[] = [0];
    let index = tileIndex({ ...ts, tiles: kept });
    for (let i = 1; i < ts.tiles.length; i++) {
      const found = isEmptyTile(ts.tiles[i]) ? -1 : findTileFlipped({ ...ts, tiles: kept }, ts.tiles[i], index);
      if (found > 0) to.push(found);
      else { kept.push(ts.tiles[i]); to.push(kept.length - 1); index = tileIndex({ ...ts, tiles: kept }); }
    }
    const gone = ts.tiles.length - kept.length;
    if (!gone) return 0;
    this.checkpoint('Merge duplicate tiles');
    this.commitTileset(t, { ...ts, tiles: kept }, ref => {
      const m = to[tileOf(ref)];
      if (m === undefined) return 0;
      return (tileOf(m) | composeFlags(ts, flagsOf(m), flagsOf(ref))) >>> 0;
    });
    this.touch();
    return gone;
  }

  /**
   * Moves the active tilemap layer onto tileset `target` (same tile size).
   * `rematch` finds each shown tile in the target by its pixels (also mirrored / turned), adding missing ones;
   * otherwise references keep their numbers (ones past the end become empty).
   */
  changeTileset(target: number, rematch: boolean) {
    const l = this.current, src = this.tilesets[l?.tileset ?? -1], dst = this.tilesets[target];
    if (!l || !src || !dst || l.tileset === target || src.tw !== dst.tw || src.th !== dst.th) return;
    this.checkpoint('Change tileset');
    const tiles = dst.tiles.slice();
    let index = tileIndex({ ...dst, tiles });
    const map = (ref: number) => {
      if (!tileOf(ref)) return 0;
      if (!rematch) return tileOf(ref) < tiles.length ? ref : 0;
      const img = tileImage(src, ref);
      let found = findTileFlipped({ ...dst, tiles }, img, index);
      if (found < 0) { tiles.push(img); found = tiles.length - 1; index = tileIndex({ ...dst, tiles }); }
      return found;
    };
    const done = new Map<CelImage, Cel>();
    const cels = l.cels.map(c => {
      if (!c?.tiles) return c;
      if (!done.has(c)) done.set(c, { ...c, tiles: { ...c.tiles, refs: c.tiles.refs.map(map) } });
      return done.get(c)!;
    });
    const li = this.layers.indexOf(l);
    this.layers = this.layers.map((x, i) => i === li ? { ...x, tileset: target, cels } : x);
    // Other layers on the target only gained tiles at the end; this re-renders everything using it
    this.commitTileset(target, { ...dst, tiles });
    this.touch();
  }

  /** Slices a pixel cel into tiles of `tiles` (reusing identical ones, appending new ones) */
  private tilesFromPixels(ts: Tileset, tiles: Uint32Array[], cel: CelImage): Cel {
    const area = alignToTiles(ts, celRect(cel));
    const pixels = reframeCel(cel, area).data;
    const cols = area.w / ts.tw, rows = area.h / ts.th, refs = new Uint32Array(cols * rows);
    let index = tileIndex({ ...ts, tiles });
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const img = cutTile(ts, pixels, area, c, r);
        let ref = findTileFlipped({ ...ts, tiles }, img, index);
        if (ref < 0) { tiles.push(img); ref = tiles.length - 1; index = tileIndex({ ...ts, tiles }); }
        refs[r * cols + c] = ref;
      }
    return this.trimTiles({ ...ts, tiles }, area.x, area.y, { cols, rows, refs });
  }

  /** New tilemap layer with its own tileset, placed like a new layer */
  addTilemapLayer(tw: number, th: number, tileset = -1) {
    if (this.refuse('layers', 'create')) return;
    const name = this.addLayer();
    // An existing tileset can be shared by several tilemap layers
    if (!this.tilesets[tileset]) {
      this.tilesets = [...this.tilesets, newTileset(tw, th, `Tileset ${this.tilesets.length + 1}`)];
      tileset = this.tilesets.length - 1;
    }
    this.layers = this.layers.map((l, i) => i === this.layer ? { ...l, tileset, name: name.replace('Layer', 'Tilemap') } : l);
    this.touch();
  }

  /** Appends tiles (tile-sized images) to the active tileset */
  importTiles(tiles: Uint32Array[]) {
    const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
    if (!ts || !tiles.length) return;
    this.checkpoint('Import tiles');
    this.tilesets = this.tilesets.map((x, i) => i === t ? { ...ts, tiles: [...ts.tiles, ...tiles] } : x);
    this.touch();
  }

  /** Turns a pixel layer into a tilemap, making a tileset from its pixels */
  convertToTilemap(tw: number, th: number, index = this.layer) {
    const l = this.layers[index];
    if (!l || l.group || l.background || l.tileset >= 0) return;
    this.dropFloating();
    this.checkpoint('Convert to tilemap');
    const ts = newTileset(tw, th, `Tileset ${this.tilesets.length + 1}`);
    const tiles = ts.tiles.slice();
    const done = new Map<CelImage, Cel>();
    const cels = l.cels.map(c => c ? done.get(c) ?? done.set(c, this.tilesFromPixels(ts, tiles, c)).get(c)! : null);
    const final = { ...ts, tiles };
    this.tilesets = [...this.tilesets, final];
    const t = this.tilesets.length - 1;
    this.layers = this.layers.map((x, i) => i === index ? { ...x, tileset: t, cels } : x);
    this.commitTileset(t, final);
    this.touch();
  }

  /** Back to plain pixels (the tileset stays in the sprite) */
  convertToPixels(index = this.layer) {
    const l = this.layers[index];
    if (!l || l.tileset < 0) return;
    this.checkpoint('Convert to layer');
    const done = new Map<CelImage, Cel>();
    const cels = l.cels.map(c => c ? done.get(c) ?? done.set(c, trimCel({ ...celRect(c), data: c.data })).get(c)! : null);
    this.layers = this.layers.map((x, i) => i === index ? { ...x, tileset: -1, cels } : x);
    this.touch();
  }

  /** Tiles mode: puts tile `ref` at grid cell (gx, gy) of the active tilemap cel */
  setTileAt(gx: number, gy: number, ref: number, layer = this.layer, frame = this.frame) {
    const l = this.layers[layer], ts = this.tilesets[l?.tileset ?? -1];
    if (!ts) return;
    const old = l.cels[frame];
    const ox = old?.tiles ? old.x / ts.tw : gx, oy = old?.tiles ? old.y / ts.th : gy;
    const oc = old?.tiles?.cols ?? 0, or = old?.tiles?.rows ?? 0;
    const c0 = Math.min(ox, gx), r0 = Math.min(oy, gy);
    const cols = Math.max(ox + oc, gx + 1) - c0, rows = Math.max(oy + or, gy + 1) - r0;
    const refs = new Uint32Array(cols * rows);
    if (old?.tiles) for (let r = 0; r < or; r++) refs.set(old.tiles.refs.subarray(r * oc, (r + 1) * oc), (r + oy - r0) * cols + (ox - c0));
    refs[(gy - r0) * cols + (gx - c0)] = ref;
    this.replaceCel(l, frame, this.trimTiles(ts, c0 * ts.tw, r0 * ts.th, { cols, rows, refs }));
    this.touch();
  }

  /** Tile reference under a sprite pixel on a tilemap layer */
  tileAt(x: number, y: number, layer = this.layer, frame = this.frame) {
    const l = this.layers[layer], ts = this.tilesets[l?.tileset ?? -1], c = l?.cels[frame];
    if (!ts || !c?.tiles) return 0;
    const gc = Math.floor((x - c.x) / ts.tw), gr = Math.floor((y - c.y) / ts.th);
    return gc >= 0 && gr >= 0 && gc < c.tiles.cols && gr < c.tiles.rows ? c.tiles.refs[gr * c.tiles.cols + gc] : 0;
  }

  /** After whole-canvas changes: rebuilds tilesets from the pixels so maps stay on the grid */
  private rebuildTilemaps() {
    this.tilesets.forEach((ts, t) => {
      if (!this.layers.some(l => l.tileset === t)) return;
      const tiles = [new Uint32Array(ts.tw * ts.th)];
      const done = new Map<CelImage, Cel>();
      this.layers = this.layers.map(l => l.tileset !== t ? l : {
        ...l,
        cels: l.cels.map(c => c ? done.get(c) ?? done.set(c, this.tilesFromPixels(ts, tiles, { ...celRect(c), data: c.data })).get(c)! : null),
      });
      this.commitTileset(t, { ...ts, tiles });
    });
  }

  /** Moves a cel (and its links) without touching its pixels */
  offsetCel(dx: number, dy: number, layer = this.layer, frame = this.frame) {
    const cel = this.getCel(layer, frame);
    if (!cel) return;
    this.setCel({ ...cel, x: cel.x + dx, y: cel.y + dy }, layer, frame);
  }

  /** Frames of `layer` sharing the cel at `frame` (including itself) */
  linkedFrames(layer = this.layer, frame = this.frame) {
    const l = this.layers[layer];
    const cel = l?.cels[frame];
    if (!cel) return [frame];
    return l.cels.map((c, f) => c === cel ? f : -1).filter(f => f >= 0);
  }

  isLinked(layer = this.layer, frame = this.frame) {
    return this.linkedFrames(layer, frame).length > 1;
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Topmost visible non-transparent pixel of the composite */
  pick(x: number, y: number, frame = this.frame) {
    if (!this.inBounds(x, y)) return 0;
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const layer = this.layers[l];
      const v = !layer.group && this.visibleDeep(l) ? celPixel(layer.cels[frame], x, y) : 0;
      if (v >>> 24) return v;
    }
    return 0;
  }

  /** Frames affected by frame-level commands: the timeline range or the current frame */
  get selectedFrames() {
    if (!this.range || this.range.type === 'layers') return [this.frame];
    return span(this.range.frames);
  }

  get selectedLayers() {
    if (!this.range || this.range.type === 'frames') return [this.layer];
    return span(this.range.layers);
  }

  /** Every (layer, frame) the range covers, or the current cel */
  get selectedCels() {
    const r = this.range;
    const layers = !r ? [this.layer] : r.type === 'frames' ? this.layers.map((_, i) => i) : span(r.layers);
    const frames = !r ? [this.frame] : r.type === 'layers' ? this.frames.map((_, i) => i) : span(r.frames);
    return layers.flatMap(l => frames.map(f => [l, f] as [number, number]));
  }

  // Layers

  /** Color used where a background layer needs pixels (secondary color, kept in sync by the app) */
  backgroundFill = 0xffffffff;

  get backgroundIndex() {
    return this.layers.findIndex(l => l.background);
  }

  private filledCel(): CelImage {
    return { ...this.canvasRect, data: new Uint32Array(this.size).fill(this.backgroundFill) };
  }

  /** "Prefix N" with N one more than the highest used so far (gaps are not reused) */
  private nextName(prefix: string) {
    const re = new RegExp(`^${prefix} (\\d+)$`);
    return `${prefix} ${Math.max(0, ...this.layers.map(l => +(re.exec(l.name)?.[1] ?? 0))) + 1}`;
  }

  /** Where a new layer goes: inside an open active group (at its bottom), else right above the active layer */
  private insertionPoint() {
    const cur = this.current;
    if (!cur) return { index: this.layers.length, depth: 0 };
    if (cur.group && !cur.collapsed) return { index: subtreeStart(this.layers, this.layer), depth: cur.depth + 1 };
    return { index: this.layer + 1, depth: cur.depth };
  }

  addLayer(below = false) {
    if (this.refuse('layers', 'create')) return '';
    this.dropFloating();
    this.checkpoint('New layer');
    const layers = this.layers.slice();
    const layer = newLayer(this.nextName('Layer'), this.frames.length);
    let at: number;
    if (below && this.current && !this.current.background) {
      at = subtreeStart(layers, this.layer);
      layer.depth = this.current.depth;
    } else {
      const p = this.insertionPoint();
      at = p.index;
      layer.depth = p.depth;
    }
    layers.splice(at, 0, layer);
    this.layers = normalizeDepths(layers);
    this.layer = at;
    this.range = null;
    this.touch();
    return layer.name;
  }

  /** New group above the active layer; selected sibling layers move into it */
  addGroup() {
    if (this.refuse('layers', 'create')) return;
    this.dropFloating();
    this.checkpoint('New group');
    const layers = this.layers.slice();
    const group: Layer = { ...newLayer(this.nextName('Group'), this.frames.length), group: true };
    const sel = this.range?.type === 'layers' ? this.selectedLayers : [];
    const d = layers[sel[0]]?.depth;
    const siblings = sel.length > 0 && sel.every(i => layers[i].depth === d && !layers[i].background)
      && sel.every(i => parentOf(layers, i) === parentOf(layers, sel[0]));
    if (siblings) {
      // Wrap the selected blocks: they become contiguous children right below the new group
      const top = Math.max(...sel);
      const blocks = sel.map(i => [subtreeStart(layers, i), i] as const);
      const inside = new Set(blocks.flatMap(([a, b]) => span([a, b])));
      const moved = layers.filter((_, i) => inside.has(i)).map(l => ({ ...l, depth: l.depth + 1 }));
      const rest: Layer[] = [];
      let at = 0;
      layers.forEach((l, i) => {
        if (inside.has(i)) return;
        rest.push(l);
        if (i < top) at = rest.length;
      });
      group.depth = d;
      rest.splice(at, 0, ...moved, group);
      this.layers = normalizeDepths(rest);
      this.layer = at + moved.length;
    } else {
      const p = this.insertionPoint();
      group.depth = p.depth;
      layers.splice(p.index, 0, group);
      this.layers = normalizeDepths(layers);
      this.layer = p.index;
    }
    this.range = null;
    this.touch();
  }

  duplicateLayer() {
    const src = this.current;
    if (!src || this.refuse('layers', 'create')) return;
    this.dropFloating();
    this.checkpoint('Duplicate layer');
    const layers = this.layers.slice();
    // A duplicate (with everything nested in it) keeps link structure inside itself but not with the original
    const start = subtreeStart(layers, this.layer);
    const copies = new Map<CelImage, Cel>();
    const block = layers.slice(start, this.layer + 1).map((l, k, all) => ({
      ...l,
      name: k === all.length - 1 ? `${l.name} copy` : l.name,
      background: false,
      cels: l.cels.map(c => c && (copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!)),
      celOpacity: l.celOpacity.slice(),
    }));
    layers.splice(this.layer + 1, 0, ...block);
    this.layers = normalizeDepths(layers);
    this.layer += block.length;
    this.range = null;
    this.touch();
  }

  removeLayers() {
    // Removing a group removes everything inside it
    const sel = new Set(this.selectedLayers.flatMap(i => span([subtreeStart(this.layers, i), i])));
    if (rootsOf(this.layers).every(i => sel.has(i))) return false;
    if (this.refuse('layers', 'delete')) return false;
    this.dropFloating();
    this.checkpoint(sel.size > 1 ? 'Delete layers' : 'Delete layer');
    this.layers = normalizeDepths(this.layers.filter((_, i) => !sel.has(i)));
    // The layer below the removed block becomes active, or the one above when nothing is below
    this.layer = Math.max(0, Math.min(Math.min(...sel) - 1, this.layers.length - 1));
    this.range = null;
    this.touch();
    return true;
  }

  /**
   * One step up or down among siblings. At the edge of a group the layer leaves it;
   * moving down onto an open group enters it.
   */
  moveLayer(dir: -1 | 1) {
    const layers = this.layers;
    const i = this.layer, cur = layers[i];
    if (!cur || cur.background) return;
    const start = subtreeStart(layers, i);
    let before: number, depth = cur.depth;
    if (dir > 0) {
      const j = i + 1;
      if (j >= layers.length) return;
      if (layers[j].depth < cur.depth) { before = j + 1; depth = layers[j].depth; }
      else {
        // Jump over the whole sibling block above (a group with its contents)
        let r = j;
        while (layers[r].depth > cur.depth) r++;
        before = r + 1;
      }
    } else {
      const k = start - 1;
      if (k < 0 || layers[k].background) {
        if (!cur.depth) return;
        before = start;
        depth = cur.depth - 1;
      } else if (layers[k].depth < cur.depth) {
        // Bottom child: step out below the parent group
        before = start;
        depth = cur.depth - 1;
      } else if (layers[k].group && !layers[k].collapsed) {
        before = k;
        depth = cur.depth + 1;
      } else before = subtreeStart(layers, k);
    }
    this.moveBlock(start, i, before, depth, 'Reorder layers');
  }

  /** Moves layers [a..b] so they end up right below index `before`, re-nesting the block's root at `depth` */
  private moveBlock(a: number, b: number, before: number, depth: number, label: string) {
    if (this.refuse('layers', 'move')) return;
    this.dropFloating();
    this.checkpoint(label);
    const delta = depth - this.layers[b].depth;
    const block = this.layers.slice(a, b + 1).map(l => ({ ...l, depth: l.depth + delta }));
    const rest = this.layers.filter((_, k) => k < a || k > b);
    const at = before > b ? before - block.length : before;
    rest.splice(at, 0, ...block);
    this.layers = normalizeDepths(rest);
    this.layer = at + block.length - 1;
    this.range = null;
    this.touch();
  }

  /** Takes the active layer out of its group, right above the group */
  moveOutOfGroup() {
    const p = parentOf(this.layers, this.layer);
    if (p < 0) return;
    this.moveBlock(subtreeStart(this.layers, this.layer), this.layer, p + 1, this.layers[p].depth, 'Move out of group');
  }

  /** Dissolves a group, keeping its contents in place */
  ungroup() {
    const g = this.layer, l = this.current;
    if (!l?.group || this.refuse('layers', 'delete')) return;
    this.dropFloating();
    this.checkpoint('Ungroup');
    const start = subtreeStart(this.layers, g);
    this.layers = normalizeDepths(this.layers
      .map((x, k) => k >= start && k < g ? { ...x, depth: x.depth - 1 } : x)
      .filter((_, k) => k !== g));
    this.layer = Math.max(0, g - 1);
    this.touch();
  }

  toggleCollapsed(i: number) {
    this.layers = this.layers.map((l, k) => k === i ? { ...l, collapsed: !l.collapsed } : l);
    this.touch();
  }

  updateLayer(index: number, patch: Partial<Omit<Layer, 'cels' | 'celOpacity'>>, label = 'Layer properties') {
    if (!this.layers[index]) return false;
    if (patch.name !== undefined && patch.name !== this.layers[index].name && this.refuse('layers', 'rename')) return false;
    this.checkpoint(label);
    this.layers = this.layers.map((l, i) => i === index ? { ...l, ...patch } : l);
    this.touch();
    return true;
  }

  /** Reference layer above the current one holding an outside image, scaled to fit the canvas */
  addReferenceLayer(src: string, w: number, h: number, name = 'Reference') {
    if (this.refuse('layers', 'create')) return;
    this.addLayer();
    const scale = Math.min(this.width / w, this.height / h) || 1;
    const reference: RefImage = { src, scale, x: (this.width - w * scale) / 2, y: (this.height - h * scale) / 2 };
    this.layers[this.layer] = { ...this.layers[this.layer], name, reference, opacity: 0.5, locked: false };
    this.touch();
  }

  private soloSaved: { layers: Layer[]; visible: boolean[]; } | null = null;

  /** Shows only this layer (with its groups and children); called again on the same layer restores the rest */
  soloLayer(i: number) {
    if (!this.layers[i]) return;
    const keep = new Set<number>();
    for (let k = i; k >= 0; k = parentOf(this.layers, k)) keep.add(k);
    for (let k = subtreeStart(this.layers, i); k <= i; k++) keep.add(k);
    const solo = this.layers.map((_, k) => keep.has(k));
    const saved = this.soloSaved;
    const isSolo = this.layers.every((l, k) => l.visible === solo[k]);
    this.checkpoint('Layer flags');
    if (saved && saved.layers.length === this.layers.length && isSolo && this.layers[i].visible) {
      this.layers = this.layers.map((l, k) => ({ ...l, visible: saved.visible[k] }));
      this.soloSaved = null;
    } else {
      this.soloSaved = { layers: this.layers, visible: this.layers.map(l => l.visible) };
      this.layers = this.layers.map((l, k) => l.visible === solo[k] ? l : { ...l, visible: solo[k] });
    }
    this.touch();
  }

  /** Visibility / lock / continuous for every layer: if all are on, turn all off, otherwise all on */
  toggleAllLayers(flag: 'visible' | 'locked' | 'continuous') {
    const all = this.layers.every(l => l[flag]);
    this.checkpoint('Layer flags');
    this.layers = this.layers.map(l => ({ ...l, [flag]: !all }));
    this.touch();
  }

  /** Turns the current layer into the opaque bottom background */
  layerToBackground() {
    const l = this.current;
    if (!l || l.group || this.backgroundIndex >= 0) return;
    this.dropFloating();
    this.checkpoint('Background from layer');
    const cels = this.frames.map((_, f) => {
      const can = new OffscreenCanvas(this.width, this.height);
      const ctx = can.getContext('2d')!;
      ctx.fillStyle = `#${[0, 8, 16].map(s => ((this.backgroundFill >>> s) & 255).toString(16).padStart(2, '0')).join('')}`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawLayer(ctx, this.layer, f, true);
      return { ...this.canvasRect, data: new Uint32Array(ctx.getImageData(0, 0, this.width, this.height).data.buffer) };
    });
    const bg: Layer = { ...l, name: 'Background', background: true, opacity: 1, blend: 'source-over', cels, celOpacity: cels.map(() => 1) };
    this.layers = [bg, ...this.layers.filter((_, i) => i !== this.layer)];
    this.layer = 0;
    this.touch();
  }

  backgroundToLayer() {
    const i = this.backgroundIndex;
    if (i < 0) return;
    this.checkpoint('Layer from background');
    this.layers = this.layers.map((l, k) => k === i ? { ...l, background: false, name: l.name === 'Background' ? 'Layer 0' : l.name } : l);
    this.touch();
  }

  /** The layer below must be a plain layer at the same level */
  get canMergeDown() {
    const top = this.current, below = this.layers[this.layer - 1];
    // A plain layer can't merge into a clipping one: the result would have to be clipped and not at once
    return !!top && !!below && !top.group && !below.group && below.depth === top.depth && (!below.clip || !!top.clip)
      && !top.reference && !below.reference;
  }

  mergeDown() {
    if (!this.canMergeDown || this.refuse('layers', 'delete')) return;
    this.dropFloating();
    this.checkpoint('Merge down');
    const top = this.layer, bottom = top - 1;
    const below = this.layers[bottom];
    // Only what is shown is merged; when both are hidden both go in and the result stays hidden
    const shown = below.visible || this.layers[top].visible;
    const vis = (i: number) => !shown || this.layers[i].visible;
    const cels = this.frames.map((_, f) =>
      this.layers[top].cels[f] || below.cels[f] ? this.flatten(f, [bottom, top], !below.background, vis) : null);
    // Opacity is baked in; the blend mode stays, it still applies against what is under the result
    this.layers = this.layers
      .filter((_, i) => i !== top)
      .map((l, i) => i === bottom ? { ...below, visible: shown, opacity: 1, cels, celOpacity: cels.map(() => 1) } : l);
    this.layer = bottom;
    this.range = null;
    this.touch();
  }

  /** Sibling nodes of the timeline layer range (bottom to top), when there are at least two */
  get rangeNodes(): number[] | null {
    const r = this.range;
    if (r?.type !== 'layers' && r?.type !== 'cels') return null;
    const L = this.layers;
    const [a, b] = r.layers[0] <= r.layers[1] ? r.layers : [r.layers[1], r.layers[0]];
    // The top of the range sets the level; everything must sit in the same parent
    const p = parentOf(L, b), d = L[b]?.depth ?? 0;
    const out: number[] = [];
    for (let i = a; i <= b; i++) {
      if (L[i].depth > d) continue;
      if (L[i].depth < d || parentOf(L, i) !== p) return null;
      out.push(i);
    }
    // A clipping layer at the bottom would lose its base below the range
    if (out.length && L[out[0]].clip && out.some(i => !L[i].clip)) return null;
    return out.length > 1 && !out.some(i => L[i].reference) ? out : null;
  }

  get canMergeVisible() {
    return rootsOf(this.layers).filter(i => this.layers[i].visible && !this.layers[i].reference).length > 1;
  }

  /** Merges the shown top-level layers into one, in place of the lowest; hidden ones are kept */
  mergeVisible() {
    if (!this.canMergeVisible) return;
    this.mergeNodes(rootsOf(this.layers).filter(i => this.layers[i].visible && !this.layers[i].reference), 'Merge visible');
  }

  /** Merges the sibling layers of the timeline range (hidden ones in it are dropped) */
  mergeSelected() {
    const nodes = this.rangeNodes;
    if (nodes) this.mergeNodes(nodes, 'Merge layers');
  }

  private mergeNodes(nodes: number[], label: string) {
    if (this.refuse('layers', 'delete')) return;
    this.dropFloating();
    this.checkpoint(label);
    const L = this.layers;
    const first = L[nodes[0]];
    const shown = nodes.filter(i => L[i].visible);
    const hasBg = shown.some(i => L[i].background);
    const merged = newLayer(first.name, this.frames.length);
    merged.background = hasBg;
    merged.depth = first.depth;
    if (nodes.every(i => L[i].clip)) merged.clip = true;
    merged.visible = shown.length > 0;
    const vis = (i: number) => !shown.length || L[i].visible;
    merged.cels = this.frames.map((_, f) => this.flatten(f, nodes, !hasBg, vis));
    const drop = new Set<number>();
    for (const i of nodes) for (let k = subtreeStart(L, i); k <= i; k++) drop.add(k);
    const at = subtreeStart(L, nodes[0]);
    const out: Layer[] = [];
    L.forEach((l, i) => {
      if (i === at) out.push(merged);
      if (!drop.has(i)) out.push(l);
    });
    this.layers = out;
    this.layer = out.indexOf(merged);
    this.range = null;
    this.touch();
  }

  flattenAll() {
    if (this.layers.length < 2 || this.refuse('layers', 'delete')) return;
    this.dropFloating();
    this.checkpoint('Flatten');
    const visible = rootsOf(this.layers).filter(i => this.layers[i].visible);
    const hasBg = this.layers.some(l => l.background && l.visible);
    const merged = newLayer(hasBg ? 'Background' : 'Flattened', this.frames.length);
    merged.background = hasBg;
    merged.cels = this.frames.map((_, f) => this.flatten(f, visible, !hasBg));
    this.layers = [merged];
    this.layer = 0;
    this.range = null;
    this.touch();
  }

  /** Composites layers into one cel; `elastic` keeps pixels outside the canvas (else canvas-sized) */
  /**
   * Layers are sibling nodes, bottom to top, composited as the canvas shows them (clipping included).
   * `vis` decides which of them count as shown; a leading clipping layer has no base in the list
   * and is drawn plainly (it gets clipped again by its own base after the merge).
   */
  private flatten(frame: number, layers: number[], elastic = false, vis = (i: number) => this.layers[i].visible): Cel {
    let rect: Rect | null = elastic ? null : this.canvasRect;
    if (elastic) for (const i of layers)
      for (let k = subtreeStart(this.layers, i); k <= i; k++) {
        const c = this.layers[k]?.cels[frame];
        if (c) rect = unionRect(rect, celRect(c));
      }
    if (!rect) return null;
    const can = new OffscreenCanvas(rect.w, rect.h);
    const ctx = can.getContext('2d')!;
    let k = 0;
    if (this.layers[layers[0]]?.clip)
      for (; k < layers.length && this.layers[layers[k]].clip; k++)
        if (vis(layers[k])) this.drawNode(ctx, layers[k], frame, true, undefined, rect.x, rect.y);
    this.drawSiblings(ctx, layers.slice(k), frame, undefined, rect.x, rect.y, vis);
    const cel = { ...rect, data: new Uint32Array(ctx.getImageData(0, 0, rect.w, rect.h).data.buffer) };
    return elastic ? trimCel(cel) : cel;
  }

  // Frames

  /** Inserts frames at `at` (before it) with the given cel source per layer */
  private insertFrames(at: number, count: number, make: (layer: Layer, li: number, k: number) => Cel, duration = 100) {
    const frames = this.frames.slice();
    frames.splice(at, 0, ...Array.from({ length: count }, () => ({ duration })));
    this.layers.forEach((l, li) => {
      const cels = Array.from({ length: count }, (_, k) => make(l, li, k) ?? (l.background ? this.filledCel() : null));
      l.cels.splice(at, 0, ...cels);
      l.celOpacity.splice(at, 0, ...cels.map(() => 1));
    });
    this.shiftTags(at, count);
    this.frames = frames;
  }

  /**
   * Places outside images into this document at (x, y): as a new layer (image i lands on frame
   * current + i, frames are added when needed) or as new frames after the current one on the active layer.
   */
  importImages(images: { w: number; h: number; data: Uint32Array; delay: number; }[], mode: 'layer' | 'frames', x: number, y: number, name = 'Imported') {
    if (!images.length) return;
    this.dropFloating();
    if (mode === 'layer') {
      if (this.refuse('layers', 'create')) return;
      const need = this.frame + images.length - this.frames.length;
      if (need > 0 && (this.refuse('frames', 'create') || this.refuseFrameShift(this.frames.length, need))) return;
      this.addLayer();
      this.layers[this.layer] = { ...this.layers[this.layer], name: this.nextName(name) };
      if (need > 0) this.insertFrames(this.frames.length, need, () => null, images[images.length - 1].delay);
      images.forEach((im, i) => this.setCel({ x, y, w: im.w, h: im.h, data: im.data.slice() }, this.layer, this.frame + i));
    } else {
      if (!this.editable || this.refuse('frames', 'create') || this.refuseFrameShift(this.frame + 1, images.length)) return;
      this.checkpoint('Import frames');
      const at = this.frame + 1;
      this.insertFrames(at, images.length, () => null);
      images.forEach((im, i) => {
        this.frames[at + i] = { ...this.frames[at + i], duration: im.delay || 100 };
        this.setCel({ x, y, w: im.w, h: im.h, data: im.data.slice() }, this.layer, at + i);
      });
      this.frame = at;
    }
    this.range = null;
    this.touch();
  }

  addFrame(mode: 'empty' | 'duplicate' = 'duplicate') {
    if (this.refuse('frames', 'create') || this.refuseFrameShift(this.frame + 1, 1)) return false;
    this.dropFloating();
    this.checkpoint(mode === 'empty' ? 'New empty frame' : 'New frame');
    const src = this.frame;
    const at = src + 1;
    this.insertFrames(at, 1, l => {
      if (mode === 'empty') return null;
      const cel = l.cels[src];
      // Continuous layers link the new cel to the previous one
      return cel && (l.continuous ? cel : cloneCel(cel));
    }, this.frames[src].duration);
    this.layers.forEach(l => { if (mode === 'duplicate') l.celOpacity[at] = l.celOpacity[src]; });
    this.frame = at;
    this.range = null;
    this.touch();
    return true;
  }

  removeFrames() {
    const sel = this.selectedFrames;
    if (sel.length >= this.frames.length) return false;
    if (this.refuse('frames', 'delete') || sel.some(f => this.refuseFrameShift(f, -1))) return false;
    this.dropFloating();
    this.checkpoint(sel.length > 1 ? 'Delete frames' : 'Delete frame');
    for (const f of sel.slice().reverse()) {
      for (const l of this.layers) {
        l.cels.splice(f, 1);
        l.celOpacity.splice(f, 1);
      }
      this.shiftTags(f + 1, -1);
    }
    this.frames = this.frames.filter((_, i) => !sel.includes(i));
    this.frame = Math.min(sel[0], this.frames.length - 1);
    this.range = null;
    this.touch();
    return true;
  }

  /** Keeps tag ranges valid after inserting (delta > 0) or removing (delta -1) frames at `at` */
  private shiftTags(at: number, delta: number) {
    const shift = (from: number, to: number): [number, number] => delta > 0
      ? [from >= at ? from + delta : from, to >= at - 1 ? to + delta : to]
      : [from >= at ? from + delta : from, to >= at - 1 ? to + delta : to];
    this.tags = this.tags
      .map(t => {
        const [from, to] = shift(t.from, t.to);
        return { ...t, from, to };
      })
      .filter(t => t.to >= t.from && t.to >= 0);
    if (this.loop) {
      const [from, to] = shift(...this.loop);
      this.loop = to >= from ? [from, to] : null;
    }
  }

  moveFrame(dir: -1 | 1) {
    const to = this.frame + dir;
    if (to < 0 || to >= this.frames.length) return;
    this.moveFrames([this.frame, this.frame], dir > 0 ? to + 1 : to, false);
  }

  /**
   * Moves (or copies) the frame block [a, b] so it starts before frame `before`.
   * Durations travel with the frames; copies link cels on continuous layers.
   */
  moveFrames([a, b]: [number, number], before: number, copy: boolean) {
    const count = b - a + 1;
    if (!copy && before >= a && before <= b + 1) return;
    if (copy ? this.refuse('frames', 'create') || this.refuseFrameShift(before, count)
      : this.refuse('frames', 'move') || (!!this.locks?.tags && this.refuse('tags', 'move'))) return;
    this.dropFloating();
    this.checkpoint(copy ? 'Copy frames' : 'Move frames');
    const pick = <T,>(arr: T[]) => arr.slice(a, b + 1);
    const frames = pick(this.frames).map(f => ({ ...f }));
    const blocks = this.layers.map(l => ({
      cels: pick(l.cels).map(c => c && (copy && !l.continuous ? cloneCel(c) : c)),
      op: pick(l.celOpacity),
    }));
    let at = before;
    if (!copy) {
      this.frames = this.frames.filter((_, i) => i < a || i > b);
      this.layers.forEach(l => { l.cels.splice(a, count); l.celOpacity.splice(a, count); });
      if (before > b) at -= count;
    }
    const all = this.frames.slice();
    all.splice(at, 0, ...frames);
    this.layers.forEach((l, i) => {
      l.cels.splice(at, 0, ...blocks[i].cels);
      l.celOpacity.splice(at, 0, ...blocks[i].op);
    });
    this.frames = all;
    this.frame = at + (this.frame >= a && this.frame <= b ? this.frame - a : 0);
    this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [at, at + count - 1] };
    this.touch();
  }

  /** Moves (or copies) the layer block [a, b] so it sits right below layer index `before` (bottom-to-top order) */
  moveLayers([a, b]: [number, number], before: number, copy: boolean) {
    // Groups travel with everything inside them
    a = Math.min(a, subtreeStart(this.layers, b));
    const count = b - a + 1;
    if (!copy && before >= a && before <= b + 1) return false;
    const block = this.layers.slice(a, b + 1);
    if (!copy && block.some(l => l.background)) return false;
    const bg = this.backgroundIndex;
    if (bg >= 0 && before <= bg) return false;
    if (this.refuse('layers', copy ? 'create' : 'move')) return false;
    this.dropFloating();
    this.checkpoint(copy ? 'Copy layers' : 'Move layers');
    const moved = block.map(l => copy
      ? { ...l, background: false, name: `${l.name} copy`, cels: l.cels.map(cloneCel), celOpacity: l.celOpacity.slice() }
      : l);
    let layers = this.layers.slice();
    let at = before;
    if (!copy) {
      layers = layers.filter((_, i) => i < a || i > b);
      if (before > b) at -= count;
    }
    // Dropped right below an open group = its top child; otherwise a sibling of the layer above
    const above = layers[at];
    const depth = !above ? 0 : above.group && !above.collapsed ? above.depth + 1 : above.depth;
    const delta = depth - moved[moved.length - 1].depth;
    layers.splice(at, 0, ...moved.map(l => ({ ...l, depth: l.depth + delta })));
    this.layers = normalizeDepths(layers);
    this.layer = at + (this.layer >= a && this.layer <= b ? this.layer - a : count - 1);
    this.range = { type: 'layers', layers: [at, at + count - 1], frames: [0, this.frames.length - 1] };
    this.touch();
    return true;
  }

  /** Moves (or copies) a rectangle of cels by (dl, df); missing frames are created */
  moveCels(r: Range, dl: number, df: number, copy: boolean) {
    if (!dl && !df) return;
    const [l0, l1] = r.layers, [f0, f1] = r.frames;
    if (l0 + dl < 0 || l1 + dl >= this.layers.length || f0 + df < 0) return;
    this.dropFloating();
    this.checkpoint(copy ? 'Copy cels' : 'Move cels');
    const need = f1 + df + 1 - this.frames.length;
    if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[this.frames.length - 1].duration);
    const src = span(r.layers).map(l => span(r.frames).map(f => ({
      cel: this.layers[l].cels[f], op: this.layers[l].celOpacity[f],
    })));
    if (!copy) span(r.layers).forEach(l => span(r.frames).forEach(f => {
      const layer = this.layers[l];
      layer.cels[f] = layer.background ? this.filledCel() : null;
    }));
    src.forEach((row, i) => row.forEach(({ cel, op }, k) => {
      const l = l0 + i + dl, f = f0 + k + df;
      const layer = this.layers[l];
      const sameLayer = dl === 0;
      // Copies within a continuous layer become links
      layer.cels[f] = cel && (copy && !(sameLayer && layer.continuous) ? cloneCel(cel) : cel);
      layer.celOpacity[f] = op;
    }));
    this.layer = Math.min(this.layers.length - 1, this.layer + dl);
    this.frame = this.frame + df;
    this.range = { type: 'cels', layers: [l0 + dl, l1 + dl], frames: [f0 + df, f1 + df] };
    this.layers = this.layers.slice();
    this.touch();
  }

  /** Copies the selected cel block right after itself (links follow each layer's continuous flag) */
  duplicateCels(linked?: boolean) {
    const r = this.range ?? { type: 'cels' as const, layers: [this.layer, this.layer] as [number, number], frames: [this.frame, this.frame] as [number, number] };
    const layers = r.type === 'frames' ? this.layers.map((_, i) => i) : span(r.layers);
    const [f0, f1] = r.type === 'layers' ? [this.frame, this.frame] : r.frames;
    const count = f1 - f0 + 1;
    this.dropFloating();
    this.checkpoint('Duplicate cels');
    const need = f1 + count + 1 - this.frames.length;
    if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[f1].duration);
    for (const li of layers) {
      const l = this.layers[li];
      const copies = new Map<CelImage, Cel>();
      for (let k = 0; k < count; k++) {
        const c = l.cels[f0 + k];
        const link = linked ?? l.continuous;
        // Plain copies keep links between themselves, not with the originals
        l.cels[f1 + 1 + k] = c && (link ? c : copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!);
        l.celOpacity[f1 + 1 + k] = l.celOpacity[f0 + k];
      }
    }
    this.frame += count;
    this.range = r.type === 'layers' ? null : { ...r, frames: [f0 + count, f1 + count] };
    this.layers = this.layers.slice();
    this.touch();
  }

  /** Snapshot of the timeline range for copy/paste inside the timeline */
  copyRange(): RangeClip | null {
    const r = this.range;
    if (!r) return null;
    if (r.type === 'layers') {
      // Whole layers, groups with their contents
      const idx = new Set(span(r.layers).flatMap(i => span([subtreeStart(this.layers, i), i])));
      const layers = this.layers.filter((_, i) => idx.has(i))
        .map(l => ({ ...l, background: false, cels: l.cels.slice(), celOpacity: l.celOpacity.slice() }));
      return { type: 'layers', layers };
    }
    if (r.type === 'frames') return {
      type: 'frames',
      frames: span(r.frames).map(f => ({
        duration: this.frames[f].duration,
        cels: this.layers.map(l => ({ cel: l.cels[f], op: l.celOpacity[f] })),
      })),
    };
    // Rows top to bottom, so pasting fills from the active layer downward
    return {
      type: 'cels',
      rows: span(r.layers).reverse().map(l => ({
        layer: l,
        cels: span(r.frames).map(f => ({ cel: this.layers[l].cels[f], op: this.layers[l].celOpacity[f] })),
      })),
    };
  }

  pasteRange(clip: RangeClip) {
    if (clip.type === 'layers' && this.refuse('layers', 'create')) return;
    if (clip.type === 'frames' && (this.refuse('frames', 'create') || this.refuseFrameShift(this.frame, clip.frames.length))) return;
    this.dropFloating();
    this.checkpoint(`Paste ${clip.type}`);
    if (clip.type === 'layers') {
      // On top of everything, as independent copies
      const copies = new Map<CelImage, Cel>();
      const added = clip.layers.map(l => ({ ...l, cels: l.cels.map(c => c && (copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!)) }));
      this.layers = normalizeDepths([...this.layers, ...added]);
      this.layer = this.layers.length - 1;
      this.range = { type: 'layers', layers: [this.layers.length - added.length, this.layers.length - 1], frames: [0, this.frames.length - 1] };
    } else if (clip.type === 'frames') {
      // Inserted before the current frame with their durations
      const at = this.frame;
      clip.frames.forEach((fr, k) => {
        this.insertFrames(at + k, 1, (l, li) => {
          const c = fr.cels[li]?.cel ?? null;
          return c && (l.continuous ? c : cloneCel(c));
        }, fr.duration);
        this.layers.forEach((l, li) => { l.celOpacity[at + k] = fr.cels[li]?.op ?? 1; });
      });
      this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [at, at + clip.frames.length - 1] };
    } else {
      // Overwrites a block starting at the active cel, going down through the layers
      const f0 = this.frame;
      const need = f0 + clip.rows[0].cels.length - this.frames.length;
      if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[this.frames.length - 1].duration);
      let l = this.layer, bottom = l;
      for (const row of clip.rows) {
        while (l >= 0 && this.layers[l].group) l--;
        if (l < 0) break;
        const layer = this.layers[l];
        row.cels.forEach(({ cel, op }, k) => {
          // Links survive only when pasting back into the same continuous layer
          const keep = l === row.layer && layer.continuous;
          layer.cels[f0 + k] = layer.background ? reframeCel(cel, this.canvasRect, this.backgroundFill) : cel && (keep ? cel : cloneCel(cel));
          layer.celOpacity[f0 + k] = op;
        });
        bottom = l;
        l--;
      }
      this.range = { type: 'cels', layers: [bottom, this.layer], frames: [f0, f0 + clip.rows[0].cels.length - 1] };
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  /** Every later frame of the range shares the first non-empty cel of each layer */
  linkCels() {
    const r = this.range;
    if (!r || r.frames[0] === r.frames[1]) return;
    this.checkpoint('Link cels');
    const layers = r.type === 'frames' ? this.layers.map((_, i) => i) : span(r.layers);
    for (const li of layers) {
      const l = this.layers[li];
      if (l.locked) continue;
      const first = span(r.frames).find(f => l.cels[f]);
      if (first === undefined) continue;
      for (const f of span(r.frames)) if (f > first) l.cels[f] = l.cels[first];
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  unlinkCels() {
    this.checkpoint('Unlink cels');
    for (const [li, f] of this.selectedCels) {
      const l = this.layers[li];
      const c = l.cels[f];
      if (c && !l.locked && this.isLinked(li, f)) l.cels[f] = cloneCel(c);
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  clearCels() {
    this.dropFloating();
    this.checkpoint('Clear cel');
    for (const [li, f] of this.selectedCels) {
      const l = this.layers[li];
      if (l.locked) continue;
      l.cels[f] = l.background ? this.filledCel() : null;
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  setCelOpacity(opacity: number) {
    this.checkpoint('Cel opacity');
    for (const [li, f] of this.selectedCels) {
      const l = this.layers[li];
      if (!l.background) l.celOpacity[f] = opacity;
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  reverseFrames() {
    const sel = this.selectedFrames.length > 1 ? this.selectedFrames : this.frames.map((_, i) => i);
    const cels = this.range?.type === 'cels';
    if (!cels && this.refuse('frames', 'move')) return;
    this.checkpoint('Reverse frames');
    const rev = <T,>(arr: T[]) => {
      const part = sel.map(i => arr[i]).reverse();
      sel.forEach((i, k) => arr[i] = part[k]);
    };
    if (!cels) {
      const frames = this.frames.slice();
      rev(frames);
      this.frames = frames;
    }
    const layers = cels ? this.selectedLayers : this.layers.map((_, i) => i);
    for (const li of layers) {
      rev(this.layers[li].cels);
      rev(this.layers[li].celOpacity);
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  setDuration(duration: number, all = false) {
    const sel = all ? this.frames.map((_, i) => i) : this.selectedFrames;
    if (this.refuse('frames', 'resize')) return;
    this.checkpoint('Frame duration');
    this.frames = this.frames.map((f, i) => sel.includes(i) ? { ...f, duration } : f);
    this.touch();
  }

  /** Bulk timing: set, multiply or add to the duration of the selected (or all) frames */
  changeDurations(mode: 'set' | 'multiply' | 'add', value: number, all = false) {
    const sel = all ? this.frames.map((_, i) => i) : this.selectedFrames;
    const apply = (d: number) => mode === 'set' ? value : mode === 'multiply' ? d * value : d + value;
    if (this.refuse('frames', 'resize')) return;
    this.checkpoint('Frame duration');
    this.frames = this.frames.map((f, i) => sel.includes(i) ? { ...f, duration: Math.max(10, Math.round(apply(f.duration))) } : f);
    this.touch();
  }

  /** Scales a tag's frame durations so the whole tag lasts `total` ms */
  stretchTag(index: number, total: number) {
    const tag = this.tags[index];
    if (!tag) return;
    let sum = 0;
    for (let i = tag.from; i <= tag.to; i++) sum += this.frames[i].duration;
    if (!sum || this.refuse('frames', 'resize')) return;
    this.checkpoint('Stretch tag');
    // Rounding error is carried along so the total comes out exact
    let acc = 0, given = 0;
    this.frames = this.frames.map((f, i) => {
      if (i < tag.from || i > tag.to) return f;
      acc += f.duration * total / sum;
      const d = Math.max(10, Math.round(acc - given));
      given += d;
      return { ...f, duration: d };
    });
    this.touch();
  }

  /**
   * Inserts `count` in-between frames before the last frame of the range (or after the current one),
   * moving the current layer's cel position and opacity from the first key to the last.
   * Pixels come from the nearer key; other layers hold the first key's cel.
   */
  tweenFrames(count: number, ease = false) {
    const [a, b] = this.range && this.range.type !== 'layers' ? this.range.frames : [this.frame, this.frame + 1];
    const li = this.range && this.range.type !== 'frames' ? this.range.layers[0] : this.layer;
    const l = this.layers[li];
    if (!l || b <= a || b >= this.frames.length || count < 1) return false;
    const k0 = l.cels[a], k1 = l.cels[b];
    if (!k0 && !k1) return false;
    const o0 = l.celOpacity[a] ?? 1, o1 = l.celOpacity[b] ?? 1;
    if (this.refuse('frames', 'create') || this.refuseFrameShift(b, count)) return false;
    this.dropFloating();
    this.checkpoint('In-between frames');
    const at = b;
    const curve = (t: number) => ease ? t * t * (3 - 2 * t) : t;
    const ts = Array.from({ length: count }, (_, k) => curve((k + 1) / (count + 1)));
    this.insertFrames(at, count, (layer, i, k) => {
      if (i !== li) return layer.cels[a];
      const t = ts[k];
      const src = (t < 0.5 ? k0 ?? k1 : k1 ?? k0)!;
      if (layer.tileset >= 0 || layer.background || !k0 || !k1) return src;
      return { ...src, x: Math.round(k0.x + (k1.x - k0.x) * t), y: Math.round(k0.y + (k1.y - k0.y) * t) };
    }, this.frames[a].duration);
    this.layers.forEach((layer, i) => {
      for (let k = 0; k < count; k++)
        layer.celOpacity[at + k] = i === li ? o0 + (o1 - o0) * ts[k] : layer.celOpacity[a] ?? 1;
    });
    this.layers = this.layers.slice();
    this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [a, b + count] };
    this.touch();
    return true;
  }

  /** Moves the content of every selected cel by (dx, dy); linked cels move once */
  nudgeCels(dx: number, dy: number) {
    this.dropFloating();
    this.checkpoint('Move cel');
    const done = new Set<CelImage>();
    for (const [li, f] of this.selectedCels) {
      const l = this.layers[li];
      const cel = l?.cels[f];
      if (!cel || done.has(cel) || l.locked || l.background || l.tileset >= 0) continue;
      const next = { ...cel, x: cel.x + dx, y: cel.y + dy };
      done.add(cel).add(next);
      l.cels.forEach((c, i) => { if (c === cel) l.cels[i] = next; });
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  addTag() {
    const [from, to] = this.range && this.range.type !== 'layers' ? this.range.frames : [this.frame, this.frame];
    if (this.refuse('tags', 'create')) return false;
    this.checkpoint('New tag');
    this.tags = [...this.tags, {
      name: `Tag ${this.tags.length + 1}`,
      from, to,
      color: TAG_COLORS[this.tags.length % TAG_COLORS.length],
      direction: 'forward',
    }];
    return true;
  }

  updateTag(index: number, patch: Partial<Tag>, checkpoint = true) {
    const t = this.tags[index];
    if (!t) return false;
    if (patch.name !== undefined && patch.name !== t.name && this.refuse('tags', 'rename')) return false;
    const from = patch.from ?? t.from, to = patch.to ?? t.to;
    if (to - from !== t.to - t.from && this.refuse('tags', 'resize')) return false;
    if (from !== t.from && to - from === t.to - t.from && this.refuse('tags', 'move')) return false;
    if (checkpoint) this.checkpoint('Tag properties');
    this.tags = this.tags.map((t, i) => i === index ? { ...t, ...patch } : t);
    return true;
  }

  removeTag(index: number) {
    if (this.refuse('tags', 'delete')) return false;
    this.checkpoint('Delete tag');
    this.tags = this.tags.filter((_, i) => i !== index);
    return true;
  }

  /** The innermost (shortest) tag containing the frame */
  tagAt(frame = this.frame) {
    let best: Tag | null = null;
    for (const t of this.tags)
      if (frame >= t.from && frame <= t.to && (!best || t.to - t.from < best.to - best.from)) best = t;
    return best;
  }

  /** Frames playback and frame navigation stay within: innermost tag, else loop section, else everything */
  playRange(frame = this.frame): { from: number; to: number; direction: TagDirection; repeat?: number; } {
    const tag = this.tagAt(frame);
    if (tag) return tag;
    if (this.loop && frame >= this.loop[0] && frame <= this.loop[1])
      return { from: this.loop[0], to: this.loop[1], direction: 'forward' };
    return { from: 0, to: this.frames.length - 1, direction: 'forward' };
  }

  /** Frame order of a tag: one pass per its direction, unrolled `repeat` times (at least once) */
  tagSequence(t: { from: number; to: number; direction: TagDirection; repeat?: number; }) {
    const fwd = Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
    const pass = t.direction === 'reverse' ? fwd.slice().reverse()
      : t.direction === 'pingpong' ? [...fwd, ...fwd.slice(1, -1).reverse()]
      : t.direction === 'pingpong-reverse' ? [...fwd.slice().reverse(), ...fwd.slice(1, -1)] : fwd;
    const out: number[] = [];
    for (let k = 0; k < Math.max(1, t.repeat ?? 0); k++) out.push(...pass);
    return out;
  }

  /** Sets the loop section to the selected frames, or clears it */
  setLoopSection() {
    const r = this.range && this.range.type !== 'layers' ? this.range.frames : null;
    this.checkpoint('Loop section');
    this.loop = r && r[1] > r[0] ? [r[0], r[1]] : null;
  }

  /** "Slice N" with N one more than the highest so far */
  private nextSliceName() {
    return `Slice ${Math.max(0, ...this.slices.map(sl => +(/^Slice (\d+)$/.exec(sl.name)?.[1] ?? 0))) + 1}`;
  }

  addSlice(r: Rect, color = '#5aa9d6') {
    if (this.refuse('slices', 'create')) return false;
    this.checkpoint('New slice');
    this.slices = [...this.slices, { name: this.nextSliceName(), color, keys: [{ frame: 0, ...r }] }];
    this.selectedSlices = [this.slices.length - 1];
    this.touch();
    return true;
  }

  /** New slice edits make a key on the current frame (else they change the static frame-0 key) */
  sliceKeysPerFrame = false;

  /**
   * Edits the key in effect at the current frame. Animated slices (or with keys per frame on)
   * get their own key on this frame instead, so other frames keep their boxes.
   */
  updateSliceKey(index: number, patch: Partial<SliceKey>, checkpoint: string | null = 'Slice') {
    const sl = this.slices[index];
    if (!sl) return;
    if ((patch.w !== undefined || patch.h !== undefined) && this.refuse('slices', 'resize')) return;
    if ((patch.x !== undefined || patch.y !== undefined) && this.refuse('slices', 'move')) return;
    if (checkpoint) this.checkpoint(checkpoint);
    const cur = sliceKey(sl, this.frame) ?? sl.keys[0];
    const perFrame = this.sliceKeysPerFrame || sl.keys.length > 1;
    const keys = perFrame && cur.frame !== this.frame
      ? [...sl.keys, { ...cur, ...patch, frame: this.frame }].sort((a, b) => a.frame - b.frame)
      : sl.keys.map(k => k === cur ? { ...k, ...patch } : k);
    this.slices = this.slices.map((x, i) => i !== index ? x : { ...x, keys });
    this.touch();
  }

  /** Hides a slice from the current frame on (a zero-sized key), or removes this frame's key */
  toggleSliceHere(index: number) {
    const sl = this.slices[index];
    if (!sl || this.refuse('slices', 'resize')) return;
    this.checkpoint('Slice key');
    const here = sl.keys.find(k => k.frame === this.frame);
    const keys = here
      ? sl.keys.length > 1 ? sl.keys.filter(k => k !== here) : sl.keys
      : [...sl.keys, { frame: this.frame, x: 0, y: 0, w: 0, h: 0 }].sort((a, b) => a.frame - b.frame);
    this.slices = this.slices.map((x, i) => i === index ? { ...x, keys } : x);
    this.touch();
  }

  updateSlice(index: number, patch: Partial<Omit<Slice, 'keys'>>, checkpoint: string | null = 'Slice properties') {
    if (patch.name !== undefined && patch.name !== this.slices[index]?.name && this.refuse('slices', 'rename')) return;
    if (checkpoint) this.checkpoint(checkpoint);
    this.slices = this.slices.map((x, i) => i === index ? { ...x, ...patch } : x);
    this.touch();
  }

  removeSlices(indices = this.selectedSlices) {
    if (!indices.length || this.refuse('slices', 'delete')) return;
    this.checkpoint(indices.length > 1 ? 'Delete slices' : 'Delete slice');
    const drop = new Set(indices);
    this.slices = this.slices.filter((_, i) => !drop.has(i));
    this.selectedSlices = [];
    this.touch();
  }

  duplicateSlices(indices = this.selectedSlices) {
    if (!indices.length || this.refuse('slices', 'create')) return;
    this.checkpoint('Duplicate slice');
    const copies = indices.map(i => ({ ...this.slices[i], name: `${this.slices[i].name} copy`, keys: this.slices[i].keys.map(k => ({ ...k })) }));
    this.slices = [...this.slices, ...copies];
    this.selectedSlices = copies.map((_, k) => this.slices.length - copies.length + k);
    this.touch();
  }

  // Selection

  setMask(mask: Mask | null, label = 'Select') {
    this.dropFloating();
    this.checkpoint(label);
    if (this.mask) this.lastMask = this.mask;
    this.mask = mask && !mask.empty ? mask : null;
  }

  selectAll() {
    this.setMask(Mask.rect(this.width, this.height, { x: 0, y: 0, w: this.width, h: this.height }), 'Select all');
  }

  deselect() {
    if (!this.mask && !this.floating) return;
    this.setMask(null, 'Deselect');
  }

  reselect() {
    if (this.lastMask) this.setMask(this.lastMask, 'Reselect');
  }

  invertSelection() {
    const base = this.mask ?? new Mask(this.width, this.height);
    this.setMask(base.invert(), 'Invert selection');
  }

  /** Moves only the selection outline, pixels stay */
  moveMask(dx: number, dy: number) {
    if (!this.mask || this.floating) return;
    this.checkpoint('Move selection outline');
    this.mask = this.mask.translate(dx, dy);
    this.touch();
  }

  /** Bitmap under the selection (or the whole layer), cropped to the selection bounds */
  private selectedBitmap(layer = this.layer, frame = this.frame): { bmp: Bitmap; rect: Rect; shape: Uint8Array; } {
    const { mask } = this;
    // Without a selection the whole cel is taken, including pixels outside the canvas
    const cel = this.getCel(layer, frame);
    const rect = mask?.bounds ?? (cel ? celRect(cel) : this.canvasRect);
    const { data } = reframeCel(cel, rect);
    const bmp = { w: rect.w, h: rect.h, data };
    const shape = new Uint8Array(rect.w * rect.h).fill(1);
    if (mask)
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++)
          if (!mask.has(rect.x + x, rect.y + y)) {
            bmp.data[y * rect.w + x] = 0;
            shape[y * rect.w + x] = 0;
          }
    return { bmp, rect, shape };
  }

  private eraseSelection() {
    const { mask } = this;
    const l = this.current;
    const fill = l?.background ? this.backgroundFill : 0;
    if (!mask) return this.setCel(l?.background ? this.filledCel() : null);
    if (!this.getCel()) return;
    const out = this.canvasPixels();
    for (let i = 0; i < out.length; i++) if (mask.data[i]) out[i] = fill;
    this.putCanvas(out);
  }

  private makeFloating(src: Bitmap, shape: Uint8Array, place: Placement, layer = this.layer, frame = this.frame): Floating {
    const result = renderPlacement(src, shape, place, this.transformAlgo);
    return { src, shape, place, layer, frame, result };
  }

  /** Renders the floating pixels for a new placement and updates the selection outline to match */
  private setFloating(f: Floating | null) {
    this.floating = f;
    if (f) {
      const { x, y, bmp, mask } = f.result;
      this.mask = Mask.fromFn(this.width, this.height, (px, py) => {
        const lx = px - x, ly = py - y;
        return lx >= 0 && ly >= 0 && lx < bmp.w && ly < bmp.h && mask[ly * bmp.w + lx] === 1;
      });
    }
    this.touch();
  }

  /** Lifts the selected pixels into a floating layer so they can be moved/transformed */
  liftSelection(copy = false) {
    if (this.floating) return this.floating;
    if (!this.editable) return null;
    const { bmp, rect, shape } = this.selectedBitmap();
    this.checkpoint(copy ? 'Duplicate selection' : 'Transform');
    this.floatingStart = this.undoDepth;
    if (!copy) this.eraseSelection();
    this.setFloating(this.makeFloating(bmp, shape, {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h, angle: 0,
      px: rect.x + rect.w / 2, py: rect.y + rect.h / 2,
    }));
    return this.floating;
  }

  /** New placement for the floating pixels; re-rendered from the original every time */
  placeFloating(place: Placement) {
    const f = this.floating;
    if (!f) return;
    this.setFloating(this.makeFloating(f.src, f.shape, place, f.layer, f.frame));
  }

  moveFloating(x: number, y: number) {
    const f = this.floating;
    if (!f) return;
    const dx = x - f.place.x, dy = y - f.place.y;
    this.placeFloating({ ...f.place, x, y, px: f.place.px + dx, py: f.place.py + dy });
  }

  /** Swaps the floating pixels for a new image at the same spot (live text while typing) */
  replaceFloating(bmp: Bitmap) {
    const f = this.floating;
    if (!f) return;
    const shape = Uint8Array.from(bmp.data, v => v >>> 24 ? 1 : 0);
    this.setFloating(this.makeFloating(bmp, shape, { ...f.place, w: bmp.w, h: bmp.h, px: f.place.x + bmp.w / 2, py: f.place.y + bmp.h / 2 }, f.layer, f.frame));
  }

  /** Re-render with the current algorithm (after the user switches it) */
  rerenderFloating() {
    if (this.floating) this.placeFloating(this.floating.place);
  }

  /**
   * The floating pixels composited over a copy of their cel.
   * The cel grows to hold them, so nothing dropped outside the canvas is lost.
   */
  private mergeFloating(f: Floating): Cel {
    const { x, y, bmp } = f.result;
    const cel = this.getCel(f.layer, f.frame);
    const background = this.layers[f.layer]?.background;
    const rect = background ? this.canvasRect : unionRect(cel && celRect(cel), { x, y, w: bmp.w, h: bmp.h })!;
    const out = reframeCel(cel, rect);
    for (let ly = 0; ly < bmp.h; ly++) {
      const ty = y + ly - rect.y;
      if (ty < 0 || ty >= rect.h) continue;
      for (let lx = 0; lx < bmp.w; lx++) {
        const tx = x + lx - rect.x;
        const v = bmp.data[ly * bmp.w + lx];
        if (tx < 0 || tx >= rect.w || !(v >>> 24)) continue;
        const i = ty * rect.w + tx;
        out.data[i] = blendOver(out.data[i], v);
      }
    }
    return out;
  }

  /** Writes floating pixels into their cel (alpha composited) */
  dropFloating() {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.floatingStart = -1;
    if (this.layers[f.layer]) this.setCel(this.mergeFloating(f), f.layer, f.frame);
    this.touch();
  }

  /** Throws away the transformation and restores the pixels from before the lift */
  cancelFloating() {
    if (!this.floating || this.floatingStart < 0) return;
    const target = this.floatingStart - 1;
    this.floatingStart = -1;
    this.goToStep(target);
    this.redoStack = [];
    this.syncHistory();
  }

  /** Stamp a copy of the floating pixels and keep moving the original (Ctrl+drag while floating) */
  stampFloating() {
    const f = this.floating;
    if (!f || !this.layers[f.layer]) return;
    this.setCel(this.mergeFloating(f), f.layer, f.frame);
  }

  /** Replace the selected pixels (or the whole cel) through `fn` */
  transformSelection(label: string, fn: (bmp: Bitmap) => Bitmap) {
    const f = this.floating ?? (this.mask ? this.liftSelection() : null);
    if (f) {
      // Part of the floating session: one undo step for the whole transformation
      const bmp = fn(f.src);
      const shapeBmp = fn({ w: f.src.w, h: f.src.h, data: Uint32Array.from(f.shape) });
      const shape = Uint8Array.from(shapeBmp.data);
      const p = f.place;
      // Keep the block centered where it was
      const w = Math.sign(p.w || 1) * bmp.w, h = Math.sign(p.h || 1) * bmp.h;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      this.setFloating(this.makeFloating(bmp, shape, {
        ...p, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2),
      }, f.layer, f.frame));
      return;
    }
    if (!this.editable) return;
    const cel = this.getCel();
    if (!cel) return;
    this.checkpoint(label);
    // The whole cel turns around its own center
    const bmp = fn(cel);
    this.setCel({
      x: cel.x + Math.round((cel.w - bmp.w) / 2), y: cel.y + Math.round((cel.h - bmp.h) / 2),
      w: bmp.w, h: bmp.h, data: bmp.data,
    });
  }

  /** Rotate the selection by quarter turns as a live transform (the user can still move it) */
  rotateSelection(turns: number) {
    const f = this.floating ?? (this.mask ? this.liftSelection() : null);
    if (!f) return this.transformSelection('Turn', b => rotate(b, turns));
    this.placeFloating({ ...f.place, angle: ((f.place.angle + turns * 90) % 360 + 360) % 360 });
  }

  /** Apply a per-pixel color function to the selection (or the whole cel) */
  mapPixels(label: string, fn: (v: number) => number) {
    const f = this.floating;
    if (f) {
      this.setFloating(this.makeFloating({ ...f.src, data: f.src.data.map(fn) }, f.shape, f.place, f.layer, f.frame));
      return;
    }
    const cel = this.getCel();
    if (!this.editable || !cel) return;
    this.checkpoint(label);
    if (!this.mask) return this.setCel({ ...cel, data: cel.data.map(fn) });
    const out = this.canvasPixels();
    for (let i = 0; i < out.length; i++)
      if (this.mask.data[i]) out[i] = fn(out[i]);
    this.putCanvas(out);
  }

  /** Replace the selection's pixels with a whole-buffer filter result */
  applyFilter(label: string, fn: (data: Uint32Array, mask: Mask | null) => Uint32Array, cels: [number, number][] = [[this.layer, this.frame]]) {
    this.dropFloating();
    this.checkpoint(label);
    const done = new Set<Cel>();
    for (const [li, fi] of cels) {
      const l = this.layers[li];
      const cel = l?.cels[fi];
      if (!l || l.locked || !cel || done.has(cel)) continue;
      // Filters see the canvas; linked cels share the result through putCanvas
      this.putCanvas(fn(this.canvasPixels(li, fi), this.mask), li, fi);
      done.add(l.cels[fi]);
    }
    this.layers = this.layers.slice();
    this.touch();
  }

  clearSelection() {
    if (this.floating) {
      this.checkpoint('Clear');
      this.floating = null;
      this.floatingStart = -1;
      this.mask = null;
      this.touch();
      return;
    }
    if (!this.editable) return;
    this.checkpoint('Clear');
    this.eraseSelection();
  }

  copySelection(merged = false): Bitmap | null {
    const f = this.floating;
    if (f) return { ...f.result.bmp, data: f.result.bmp.data.slice() };
    if (!merged) return this.selectedBitmap().bmp;
    const rect = this.mask?.bounds ?? { x: 0, y: 0, w: this.width, h: this.height };
    const data = this.flatten(this.frame, rootsOf(this.layers).filter(i => this.layers[i].visible))!.data;
    const bmp = crop({ w: this.width, h: this.height, data }, rect);
    if (this.mask)
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++)
          if (!this.mask.has(rect.x + x, rect.y + y)) bmp.data[y * rect.w + x] = 0;
    return bmp;
  }

  /** Where copied pixels came from, used to paste them back in place */
  get selectionOrigin() {
    const b = this.floating ? { x: this.floating.result.x, y: this.floating.result.y } : this.mask?.bounds;
    return b ? { x: b.x, y: b.y } : null;
  }

  paste(bmp: Bitmap, at?: { x: number; y: number; }, label = 'Paste') {
    if (!this.editable) return;
    this.dropFloating();
    this.checkpoint(label);
    this.floatingStart = this.undoDepth;
    // At least one pixel stays over the canvas; the rest may hang outside (the cel grows to keep it)
    const x = Math.max(1 - bmp.w, Math.min(this.width - 1, at?.x ?? Math.round((this.width - bmp.w) / 2)));
    const y = Math.max(1 - bmp.h, Math.min(this.height - 1, at?.y ?? Math.round((this.height - bmp.h) / 2)));
    const shape = Uint8Array.from(bmp.data, v => v >>> 24 ? 1 : 0);
    this.setFloating(this.makeFloating(bmp, shape, {
      x, y, w: bmp.w, h: bmp.h, angle: 0, px: x + bmp.w / 2, py: y + bmp.h / 2,
    }));
  }

  /** Applies `fn` to every cel once, keeping linked cels linked */
  private mapAllCels(fn: (cel: CelImage, layer: Layer) => Cel) {
    const done = new Map<CelImage, Cel>();
    this.layers = this.layers.map(l => ({
      ...l,
      cels: l.cels.map(cel => cel ? done.get(cel) ?? done.set(cel, keepExt(cel, fn(cel, l))).get(cel)! : null),
    }));
    // Tilemaps are re-cut from their transformed pixels
    if (this.layers.some(l => l.tileset >= 0)) this.rebuildTilemaps();
  }

  /** Converts every cel to another color mode (with dithering when going to indexed) */
  convertColorMode(mode: ColorMode, dither: Dither = 'none', amount = 1) {
    this.dropFloating();
    this.checkpoint(`Color mode: ${mode}`);
    this.mapAllCels(c => {
      const data = c.data.slice();
      convertPixels(data, c.w, c.h, mode, this.palette, dither, amount, c.x, c.y);
      return { ...c, data };
    });
    this.colorMode = mode;
    this.touch();
  }

  /**
   * Same as convertColorMode, with the pixel work done by `convert` (a worker). Nothing changes
   * if it throws (cancelled); edits made while it runs are kept for cels it didn't touch.
   */
  async convertColorModeAsync(mode: ColorMode, dither: Dither, amount: number,
    convert: (cels: CelImage[], palette: number[] | null) => Promise<Uint32Array[]>) {
    this.dropFloating();
    const cels = [...new Set(this.layers.flatMap(l => l.cels.filter((c): c is CelImage => !!c)))];
    const out = await convert(cels, this.palette?.colors ?? null);
    const result = new Map(cels.map((c, i) => [c, out[i]]));
    this.checkpoint(`Color mode: ${mode}`);
    this.mapAllCels(c => result.has(c) ? { ...c, data: result.get(c)! } : (() => {
      const data = c.data.slice();
      convertPixels(data, c.w, c.h, mode, this.palette, dither, amount, c.x, c.y);
      return { ...c, data };
    })());
    this.colorMode = mode;
    this.touch();
  }

  /** Indexed mode: palette entry colors changed, so pixels of the old colors follow them */
  recolor(changes: Map<number, number>, frames?: Set<number>) {
    if (!changes.size) return;
    if (!frames) this.mapAllCels(c => ({ ...c, data: c.data.map(v => changes.get(v) ?? v) }));
    else {
      // Only the frames this palette governs
      const done = new Map<CelImage, Cel>();
      this.layers = this.layers.map(l => ({
        ...l,
        cels: l.cels.map((c, f) => !c || !frames.has(f) ? c : done.get(c) ?? done.set(c, { ...c, data: c.data.map(v => changes.get(v) ?? v) }).get(c)!),
      }));
      if (this.layers.some(l => l.tileset >= 0)) this.rebuildTilemaps();
    }
    this.touch();
  }

  /** Moves / resizes every slice key along with a whole-canvas change */
  private mapSliceKeys(fn: (k: SliceKey) => SliceKey) {
    this.slices = this.slices.map(sl => ({ ...sl, keys: sl.keys.map(fn) }));
  }

  /** Background cels always cover exactly the canvas */
  private refitBackgrounds() {
    this.layers = this.layers.map(l => l.background
      ? { ...l, cels: l.cels.map(c => reframeCel(c, this.canvasRect, this.backgroundFill)) }
      : l);
  }

  /**
   * New canvas size; content is offset by (dx, dy).
   * Cels only move: pixels that end up outside the canvas are kept unless `trimOutside`.
   */
  canvasSize(width: number, height: number, dx = 0, dy = 0, trimOutside = false) {
    width = Math.max(1, Math.min(4096, Math.round(width)));
    height = Math.max(1, Math.min(4096, Math.round(height)));
    if (width === this.width && height === this.height && !dx && !dy) return;
    if (this.refuseSize(width, height)) return;
    this.dropFloating();
    this.checkpoint('Canvas size');
    const canvas = { x: 0, y: 0, w: width, h: height };
    this.mapAllCels(c => {
      const moved = { ...c, x: c.x + dx, y: c.y + dy };
      return trimOutside ? trimCel(reframeCel(moved, canvas)) : moved;
    });
    this.mask = this.mask?.reframe(width, height, dx, dy) ?? null;
    this.mapSliceKeys(k => ({ ...k, x: k.x + dx, y: k.y + dy }));
    this.width = width;
    this.height = height;
    this.refitBackgrounds();
    this.touch();
  }

  scaleSprite(width: number, height: number) {
    width = Math.max(1, Math.min(4096, Math.round(width)));
    height = Math.max(1, Math.min(4096, Math.round(height)));
    if (this.refuseSize(width, height)) return;
    this.dropFloating();
    this.checkpoint('Sprite size');
    const sx = width / this.width, sy = height / this.height;
    this.mapAllCels(c => {
      const x = Math.round(c.x * sx), y = Math.round(c.y * sy);
      const w = Math.max(1, Math.round((c.x + c.w) * sx) - x), h = Math.max(1, Math.round((c.y + c.h) * sy) - y);
      return { x, y, w, h, data: scaleNearest(c, w, h).data };
    });
    this.mapSliceKeys(k => ({
      ...k, x: Math.round(k.x * sx), y: Math.round(k.y * sy), w: Math.max(1, Math.round(k.w * sx)), h: Math.max(1, Math.round(k.h * sy)),
      center: k.center && { x: Math.round(k.center.x * sx), y: Math.round(k.center.y * sy), w: Math.max(1, Math.round(k.center.w * sx)), h: Math.max(1, Math.round(k.center.h * sy)) },
      pivot: k.pivot && { x: Math.round(k.pivot.x * sx), y: Math.round(k.pivot.y * sy) },
    }));
    this.mask = null;
    this.width = width;
    this.height = height;
    this.refitBackgrounds();
    this.touch();
  }

  /** Mirrors every cel across the canvas center (positions and pixels) */
  flipSprite(axis: 'h' | 'v') {
    this.dropFloating();
    this.checkpoint(axis === 'h' ? 'Flip canvas horizontal' : 'Flip canvas vertical');
    this.mapAllCels(c => axis === 'h'
      ? { ...c, x: this.width - c.x - c.w, data: flipH(c).data }
      : { ...c, y: this.height - c.y - c.h, data: flipV(c).data });
    this.mapSliceKeys(k => axis === 'h'
      ? { ...k, x: this.width - k.x - k.w, center: k.center && { ...k.center, x: k.w - k.center.x - k.center.w }, pivot: k.pivot && { ...k.pivot, x: k.w - k.pivot.x } }
      : { ...k, y: this.height - k.y - k.h, center: k.center && { ...k.center, y: k.h - k.center.y - k.center.h }, pivot: k.pivot && { ...k.pivot, y: k.h - k.pivot.y } });
    this.mask = null;
    this.touch();
  }

  rotateSprite(turns: number) {
    turns = ((turns % 4) + 4) % 4;
    if (!turns) return;
    if (turns % 2 && this.refuseSize(this.height, this.width)) return;
    this.dropFloating();
    this.checkpoint('Rotate canvas');
    const { width: W, height: H } = this;
    this.mapAllCels(c => {
      const r = rotate(c, turns);
      // Where the cel's rectangle lands after turning the whole canvas
      const x = turns === 1 ? H - c.y - c.h : turns === 2 ? W - c.x - c.w : c.y;
      const y = turns === 1 ? c.x : turns === 2 ? H - c.y - c.h : W - c.x - c.w;
      return { x, y, w: r.w, h: r.h, data: r.data };
    });
    // Slices keep their boxes (9-slice centers and pivots are dropped: they no longer fit the turned art)
    this.mapSliceKeys(k => {
      const x = turns === 1 ? H - k.y - k.h : turns === 2 ? W - k.x - k.w : k.y;
      const y = turns === 1 ? k.x : turns === 2 ? H - k.y - k.h : W - k.x - k.w;
      return { frame: k.frame, x, y, w: turns % 2 ? k.h : k.w, h: turns % 2 ? k.w : k.h };
    });
    if (turns % 2) [this.width, this.height] = [H, W];
    this.mask = null;
    this.touch();
  }

  /** The canvas becomes `r`; cels keep their pixels and just shift */
  private cropTo(r: Rect, label: string) {
    if (this.refuseSize(r.w, r.h)) return;
    this.dropFloating();
    this.checkpoint(label);
    this.mapAllCels(c => ({ ...c, x: c.x - r.x, y: c.y - r.y }));
    this.mapSliceKeys(k => ({ ...k, x: k.x - r.x, y: k.y - r.y }));
    this.width = r.w;
    this.height = r.h;
    this.mask = null;
    this.refitBackgrounds();
    this.touch();
  }

  cropToSelection() {
    const r = this.mask?.bounds;
    if (r) this.cropTo(r, 'Crop');
  }

  /** Crop the canvas to the visible content of all cels */
  trim() {
    let r: Rect | null = null;
    for (const l of this.layers)
      for (const cel of l.cels)
        if (cel) {
          const b = opaqueBounds(reframeCel(cel, this.canvasRect));
          r = unionRect(r, b);
        }
    if (!r || (r.w === this.width && r.h === this.height)) return;
    this.cropTo(r, 'Trim');
  }

  // Rendering

  /**
   * Draws a layer at its cels' positions; (ox, oy) is the sprite point at the context's origin.
   * `override` is a canvas-sized buffer shown instead of the cel (previews).
   */
  private drawLayer(ctx: OffscreenCanvasRenderingContext2D, index: number, frame: number, force = false, override?: Uint32Array, ox = 0, oy = 0) {
    const layer = this.layers[index];
    if (!layer || (!force && !layer.visible)) return;
    const cel: Cel = override ? { ...this.canvasRect, data: override } : layer.cels[frame];
    const f = this.floating;
    const hasFloating = f && f.layer === index && f.frame === frame;
    if (!cel && !hasFloating) return;

    let src: OffscreenCanvas;
    let sx = cel?.x ?? 0, sy = cel?.y ?? 0;
    if (hasFloating) {
      // Drawn inside the layer so its opacity and blend apply: dropping causes no visual jump
      const r = unionRect(cel && celRect(cel), { x: f.result.x, y: f.result.y, w: f.result.bmp.w, h: f.result.bmp.h })!;
      src = new OffscreenCanvas(r.w, r.h);
      const c = src.getContext('2d')!;
      if (cel) c.drawImage(bitmapToCanvas(cel), cel.x - r.x, cel.y - r.y);
      c.drawImage(bitmapToCanvas(f.result.bmp), f.result.x - r.x, f.result.y - r.y);
      sx = r.x;
      sy = r.y;
    } else src = bitmapToCanvas(cel!);
    ctx.globalAlpha = layer.opacity * (layer.celOpacity[frame] ?? 1);
    ctx.globalCompositeOperation = layer.blend;
    ctx.drawImage(src, sx - ox, sy - oy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Draws a layer, or a group composited from its children with the group's opacity and blend */
  private drawNode(ctx: OffscreenCanvasRenderingContext2D, i: number, frame: number, force: boolean, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0) {
    const l = this.layers[i];
    if (!l || (!force && !l.visible)) return;
    if (!l.group) return this.drawLayer(ctx, i, frame, true, override?.(i), ox, oy);
    const can = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
    const c = can.getContext('2d')!;
    this.drawSiblings(c, childrenOf(this.layers, i), frame, override, ox, oy);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(can, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draws sibling nodes bottom to top. A run of clipping layers is drawn on a copy of the
   * layer under it, masked by that layer's alpha, then the result goes down with its blend.
   */
  private drawSiblings(ctx: OffscreenCanvasRenderingContext2D, list: number[], frame: number, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0, vis = (i: number) => this.layers[i].visible) {
    const L = this.layers;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      let m = n + 1;
      while (m < list.length && L[list[m]].clip) m++;
      if (m === n + 1 || !vis(i)) {
        // Clipping layers over a hidden base are hidden too
        if (vis(i)) this.drawNode(ctx, i, frame, true, override, ox, oy);
        n = m - 1;
        continue;
      }
      const { width, height } = ctx.canvas;
      const base = new OffscreenCanvas(width, height);
      this.drawNode(base.getContext('2d')!, i, frame, true, override, ox, oy);
      const out = new OffscreenCanvas(width, height);
      const oc = out.getContext('2d')!;
      oc.drawImage(base, 0, 0);
      for (let k = n + 1; k < m; k++) {
        const j = list[k];
        if (!vis(j)) continue;
        const layer = new OffscreenCanvas(width, height);
        const lc = layer.getContext('2d')!;
        this.drawNode(lc, j, frame, true, override, ox, oy);
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(base, 0, 0);
        oc.globalCompositeOperation = L[j].blend;
        oc.drawImage(layer, 0, 0);
      }
      ctx.globalCompositeOperation = L[i].blend;
      ctx.drawImage(out, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      n = m - 1;
    }
  }

  /**
   * Set by the editor while a stroke changes only this layer: the composites below and above it
   * are kept between redraws (checked against the cels they were made from).
   */
  focusLayer: number | null = null;
  private split: { sig: unknown[]; below: OffscreenCanvas; above: OffscreenCanvas; } | null = null;

  /** Composite as below + layer + above, reusing the cached parts; null when the layer stack doesn't allow it */
  private renderSplit(frame: number, at: number, override?: (i: number) => Uint32Array | undefined) {
    const L = this.layers;
    const roots = rootsOf(L);
    const n = roots.indexOf(at);
    const l = L[at];
    if (n < 0 || !l || l.group || l.clip || L[roots[n + 1]]?.clip) return null;
    const above = roots.slice(n + 1);
    // Blending above the layer depends on what is under it
    if (above.some(i => L[i].blend !== 'source-over')) return null;
    const sig: unknown[] = [frame, at, this.width, this.height, this.floating];
    L.forEach((x, i) => { if (i !== at) sig.push(x, x.cels[frame]); });
    const old = this.split;
    if (!old || old.sig.length !== sig.length || old.sig.some((v, k) => v !== sig[k])) {
      const below = new OffscreenCanvas(this.width, this.height);
      this.drawSiblings(below.getContext('2d')!, roots.slice(0, n), frame, override);
      const top = new OffscreenCanvas(this.width, this.height);
      this.drawSiblings(top.getContext('2d')!, above, frame, override);
      this.split = { sig, below, above: top };
    }
    const out = new OffscreenCanvas(this.width, this.height);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.split!.below, 0, 0);
    this.drawNode(ctx, at, frame, false, override);
    ctx.drawImage(this.split!.above, 0, 0);
    return out;
  }

  /**
   * Flattened image of a frame, cached until the next change.
   * `only` renders a single layer; `override` swaps one layer's pixels (brush preview) and skips the cache.
   */
  render(frame = this.frame, only?: number, override?: { layer: number; data: Uint32Array; }) {
    if (this.cacheVersion !== this.version) {
      this.cache.clear();
      this.cacheVersion = this.version;
    }
    const key = `${frame}:${only ?? ''}`;
    const cached = !override && this.cache.get(key);
    if (cached) return cached;

    const out = new OffscreenCanvas(this.width, this.height);
    const ctx = out.getContext('2d')!;
    const data = (i: number) => override?.layer === i ? override.data : undefined;
    if (only !== undefined) this.drawNode(ctx, only, frame, true, data);
    else {
      const fast = this.focusLayer !== null && !override ? this.renderSplit(frame, this.focusLayer) : null;
      if (fast) ctx.drawImage(fast, 0, 0);
      else {
        if (this.focusLayer === null) this.split = null;
        this.drawSiblings(ctx, rootsOf(this.layers), frame, data);
      }
    }
    if (!override) this.cache.set(key, out);
    return out;
  }

  // Serialization

  /** Layers with floating pixels merged in, as they would be saved */
  private savedLayers() {
    const f = this.floating;
    return this.layers.map((l, li) => ({
      ...l,
      cels: l.cels.map((cel, fi) => f && f.layer === li && f.frame === fi ? this.mergeFloating(f) : cel),
    }));
  }

  toJSON() {
    const b64 = (data: Uint32Array) => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const encode = (cel: Cel) => {
      if (!cel) return null;
      const t = cel.tiles;
      return { x: cel.x, y: cel.y, w: cel.w, h: cel.h, d: b64(cel.data), ...(t ? { tc: t.cols, tr: t.rows, t: b64(t.refs) } : {}), ...(cel.ext ? { ext: cel.ext } : {}) };
    };
    return {
      format: 'pixprite',
      version: 4,
      colorMode: this.colorMode,
      transparentIndex: this.transparentIndex,
      name: this.name,
      ...(Object.keys(this.info).length ? { info: this.info } : {}),
      width: this.width,
      height: this.height,
      frames: this.frames,
      tags: this.tags,
      slices: this.slices,
      guides: this.guides,
      framePalettes: this.framePalettes,
      tilesets: this.tilesets.map(ts => {
        const all = new Uint32Array(ts.tiles.length * ts.tw * ts.th);
        ts.tiles.forEach((tile, i) => all.set(tile, i * ts.tw * ts.th));
        return { name: ts.name, tw: ts.tw, th: ts.th, baseIndex: ts.baseIndex, count: ts.tiles.length, d: b64(all), ...(ts.userData ? { userData: ts.userData } : {}) };
      }),
      loop: this.loop,
      ...(Object.keys(this.ext).length ? { ext: this.ext } : {}),
      ...(this.locks ?? this.orphanLocks ? { locks: this.locks ?? this.orphanLocks } : {}),
      // Linked cels are stored once, later frames reference the first one
      layers: this.savedLayers().map(l => ({
        ...l,
        cels: l.cels.map((cel, fi) => {
          const first = cel ? l.cels.indexOf(cel) : -1;
          return first >= 0 && first < fi ? { link: first } : encode(cel);
        }),
      })),
    };
  }

  load(data: any) {
    if (data?.format !== 'pixprite') throw new Error('Unknown file format');
    const bytes = (s: string) => {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return new Uint32Array(out.buffer);
    };
    // v3 stored full-canvas buffers as plain strings, v4 stores placed cel images
    const decode = (c: string | { x: number; y: number; w: number; h: number; d: string; } | null): Cel => {
      if (!c) return null;
      if (typeof c === 'string') return trimCel({ x: 0, y: 0, w: data.width, h: data.height, data: bytes(c) });
      const cel: CelImage = { x: c.x, y: c.y, w: c.w, h: c.h, data: bytes(c.d) };
      const t = (c as { t?: string; tc?: number; tr?: number; });
      if (t.t) cel.tiles = { cols: t.tc!, rows: t.tr!, refs: bytes(t.t) };
      const ext = (c as { ext?: unknown; }).ext;
      if (isExtData(ext)) cel.ext = ext;
      return cel;
    };
    this.reset(data.width, data.height, data.name ?? 'untitled');
    this.info = cleanInfo(data.info);
    const count = data.frames.length;
    this.frames = data.frames.map((f: Frame) => ({ ...f }));
    this.tags = data.tags ?? [];
    this.slices = data.slices ?? [];
    this.guides = Array.isArray(data.guides) ? data.guides.filter((g: any) => (g?.axis === 'x' || g?.axis === 'y') && Number.isFinite(g.pos)) : [];
    this.framePalettes = data.framePalettes ?? [];
    this.tilesets = (data.tilesets ?? []).map((t: any) => {
      const all = bytes(t.d), n = t.tw * t.th;
      return { name: t.name, tw: t.tw, th: t.th, baseIndex: t.baseIndex ?? 1, ...(t.userData ? { userData: t.userData } : {}), tiles: Array.from({ length: t.count }, (_, i) => all.slice(i * n, (i + 1) * n)) };
    });
    this.loop = data.loop ?? null;
    this.colorMode = data.colorMode ?? 'rgb';
    this.transparentIndex = data.transparentIndex ?? -1;
    this.ext = isExtData(data.ext) ? data.ext : {};
    // Locks of an extension that isn't installed are kept aside until it is (or the user unlocks)
    const locks = isLocksRecord(data.locks) ? data.locks : null;
    if (locks && lockOwners.installed(locks.owner)) this.locks = locks;
    else this.orphanLocks = locks;
    this.layers = data.layers.map((l: any) => {
      const cels: Cel[] = [];
      l.cels.forEach((c: any, i: number) => cels[i] = c && typeof c === 'object' && 'link' in c ? cels[c.link] ?? null : decode(c));
      return { ...newLayer(l.name, count), ...l, cels, celOpacity: l.celOpacity ?? Array(count).fill(1) };
    });
    this.touch();
  }

  toDocument(): AseDocument {
    return {
      width: this.width,
      height: this.height,
      frames: this.frames.map(f => ({ ...f })),
      tags: this.tags.map(t => ({ ...t })),
      palette: this.framePalettes[0]?.colors ?? [],
      slices: this.slices,
      colorMode: this.colorMode,
      framePalettes: this.framePalettes,
      tilesets: this.tilesets,
      transparentIndex: this.colorMode === 'indexed' ? this.transparentIndex : -1,
      // Reference layers belong to the editor only
      layers: this.savedLayers().filter(l => !l.reference).map(l => ({
        name: l.name, visible: l.visible, locked: l.locked, background: l.background, continuous: l.continuous,
        opacity: l.opacity, blend: l.blend, cels: l.cels, celOpacity: l.celOpacity,
        group: l.group, depth: l.depth, collapsed: l.collapsed, tileset: l.tileset,
        clip: l.clip, userData: l.userData,
      })),
    };
  }

  fromDocument(doc: AseDocument, name = 'untitled') {
    this.reset(doc.width, doc.height, name);
    const count = doc.frames.length;
    this.frames = doc.frames.map(f => ({ ...f }));
    this.tags = doc.tags.map(t => ({ ...t }));
    this.slices = doc.slices ?? [];
    this.colorMode = doc.colorMode ?? 'rgb';
    this.framePalettes = doc.framePalettes ?? [];
    this.tilesets = doc.tilesets ?? [];
    this.transparentIndex = this.colorMode === 'indexed' ? doc.transparentIndex ?? -1 : -1;
    this.layers = doc.layers.map(l => ({
      ...newLayer(l.name, count),
      ...l,
      cels: l.cels.slice(0, count),
      celOpacity: l.celOpacity ?? Array(count).fill(1),
    }));
    if (!this.layers.length) this.layers = [newLayer('Layer 1', count)];
    this.refitBackgrounds();
    this.touch();
  }

  loadImage(image: ImageBitmap | HTMLImageElement, name = 'image') {
    const { width, height } = image;
    const tmp = new OffscreenCanvas(width, height);
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    this.reset(width, height, name);
    this.layers = [{ ...newLayer('Layer 1', 1) }];
    this.setCel({ x: 0, y: 0, w: width, h: height, data: new Uint32Array(data.slice().buffer) });
  }

  /** One frame per buffer (animated GIF, image sequence) */
  loadFrames(width: number, height: number, frames: { data: Uint32Array; delay: number; }[], name = 'animation') {
    this.reset(width, height, name);
    this.frames = frames.map(f => ({ duration: f.delay || 100 }));
    this.layers = [{ ...newLayer('Layer 1', frames.length), cels: frames.map(f => trimCel({ x: 0, y: 0, w: width, h: height, data: f.data })) }];
    this.touch();
  }

  /**
   * Splits a sheet into frames: cells of cw×ch starting at (x0, y0), read by rows or columns.
   * `partial` keeps cells cut by the sheet edge.
   */
  loadSheet(image: ImageBitmap, cw: number, ch: number, name = 'sheet', opts: { x0?: number; y0?: number; byColumns?: boolean; partial?: boolean; } = {}) {
    const { x0 = 0, y0 = 0, byColumns = false, partial = false } = opts;
    const fit = (size: number, start: number, cell: number) =>
      Math.max(0, partial ? Math.ceil((size - start) / cell) : Math.floor((size - start) / cell));
    const cols = fit(image.width, x0, cw), rows = fit(image.height, y0, ch);
    const can = new OffscreenCanvas(image.width, image.height);
    const ctx = can.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const cell = (c: number, r: number) => {
      const out = new OffscreenCanvas(cw, ch);
      out.getContext('2d')!.drawImage(can, x0 + c * cw, y0 + r * ch, cw, ch, 0, 0, cw, ch);
      return trimCel({ x: 0, y: 0, w: cw, h: ch, data: new Uint32Array(out.getContext('2d')!.getImageData(0, 0, cw, ch).data.buffer) });
    };
    const cels: Cel[] = [];
    if (byColumns) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cels.push(cell(c, r));
    else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cels.push(cell(c, r));
    if (!cels.length) return false;
    this.reset(cw, ch, name);
    this.frames = cels.map(() => ({ duration: 100 }));
    this.layers = [{ ...newLayer('Sheet', cels.length), cels }];
    this.touch();
    return true;
  }

  /**
   * Builds frames from a sheet and its JSON description (the common texture-packer layout:
   * `frames` as a list or a name map, each with `frame`, optional `rotated`, `spriteSourceSize`,
   * `sourceSize`, `duration`; `meta.frameTags` become tags). Without tags in the description,
   * `tagByName` tags runs of frames named alike ("run_0", "run_1" → "run"). Returns false when nothing fits.
   */
  loadSheetData(image: ImageBitmap, json: unknown, name = 'sheet', tagByName = true) {
    type R = { x: number; y: number; w: number; h: number; };
    type Entry = { filename?: string; frame?: R; rotated?: boolean; trimmed?: boolean; spriteSourceSize?: R; sourceSize?: { w: number; h: number; }; duration?: number; };
    const root = json as { frames?: Entry[] | Record<string, Entry>; meta?: { frameTags?: { name?: string; from?: number; to?: number; direction?: string; color?: string; }[]; }; };
    const raw = root?.frames;
    const entries = (Array.isArray(raw) ? raw : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([filename, e]) => ({ filename, ...e })) : [])
      .filter((e): e is Entry & { frame: R; } => !!e?.frame && e.frame.w > 0 && e.frame.h > 0);
    if (!entries.length) return false;
    const can = new OffscreenCanvas(image.width, image.height);
    can.getContext('2d')!.drawImage(image, 0, 0);
    // The canvas is the largest source size (untrimmed frame), or the largest frame when none is given
    const W = Math.max(...entries.map(e => e.sourceSize?.w ?? e.frame.w)), H = Math.max(...entries.map(e => e.sourceSize?.h ?? e.frame.h));
    const cels: Cel[] = entries.map(e => {
      const f = e.frame, at = e.spriteSourceSize ?? { x: 0, y: 0 };
      // `frame` holds the upright size; a rotated frame sits in the sheet turned 90° clockwise (h×w)
      const { w, h } = f;
      const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d')!;
      if (e.rotated) {
        ctx.translate(0, h);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(can, f.x, f.y, h, w, 0, 0, h, w);
      } else ctx.drawImage(can, f.x, f.y, w, h, 0, 0, w, h);
      return trimCel({ x: at.x, y: at.y, w, h, data: new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer) });
    });
    this.reset(W, H, name);
    this.frames = entries.map(e => ({ duration: e.duration && e.duration > 0 ? e.duration : 100 }));
    this.layers = [{ ...newLayer('Sheet', cels.length), cels }];
    const last = cels.length - 1;
    const given = root.meta?.frameTags ?? [];
    this.tags = (given.length || !tagByName ? given : tagsByName(entries.map(e => e.filename ?? '')))
      .filter(t => Number.isFinite(t.from) && Number.isFinite(t.to) && t.from! <= last)
      .map((t, i) => ({
        name: t.name || `Tag ${i + 1}`,
        from: Math.max(0, t.from!), to: Math.min(last, Math.max(t.from!, t.to!)),
        color: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color! : TAG_COLORS[i % TAG_COLORS.length],
        direction: t.direction === 'reverse' ? 'reverse' : /^pingpong[-_]reverse$/.test(t.direction ?? '') ? 'pingpong-reverse' : t.direction?.startsWith('pingpong') ? 'pingpong' : 'forward',
      }));
    this.touch();
    return true;
  }

  /** Image data of a frame for exporters */
  frameImage(frame: number) {
    const ctx = this.render(frame).getContext('2d')!;
    return ctx.getImageData(0, 0, this.width, this.height);
  }
}

export { toImageData };
