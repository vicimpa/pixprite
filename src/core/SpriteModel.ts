import type { LockFlags } from "@pixprite/api";
import { signal } from "@preact/signals-react";
import { opaqueBounds, type Bitmap, type Rect } from "~/core/Image";
import type { UserData } from "~/core/Tilemap";
import type { TileRefs } from "~/core/Tilemap";
import type { Placement } from "~/core/Transform";
import { copyEffectScope, createCelInstance, isCelInstance, transformCel, type LayerFX } from './DocumentModel';

export { createImage, createCelInstance, imageOf, transformCel, bakeCel, type Image, type AssetRef, type CelInstance, type CelTransform, type LayerFX } from './DocumentModel';

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
  if (cel && isCelInstance(cel)) {
    const copy = createCelInstance(cel.image, { ...cel.transform, x: cel.x, y: cel.y, ext: cel.ext });
    if (cel.tiles) copy.tiles = cel.tiles;
    return copy;
  }
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
  /** Pixel edits retain the existing silhouette and every alpha byte. Structural transforms are independent. */
  lockAlpha?: boolean;
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
  /** Ordered nondestructive processors; an absent stack is equivalent to an empty stack. */
  effects?: LayerFX[];
  /** IDs already baked into each frame; later edits to those effects leave baked frames alone. */
  bakedEffects?: string[][];
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
  | { type: 'frames'; frames: { duration: number; cels: { cel: Cel; op: number; fx?: string[]; }[]; }[]; }
  | { type: 'cels'; rows: { layer: number; cels: { cel: Cel; op: number; fx?: string[]; }[]; }[]; };

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

export const TAG_COLORS = ['#e0a33a', '#5aa9d6', '#9bd35a', '#d65a8f', '#a07be0', '#e06a4a'];

/** `next` with the extension data of the cel it replaces */
export function keepExt(prev: CelImage, next: Cel): Cel {
  if (!next || !prev.ext || next.ext) return next;
  return isCelInstance(next) ? Object.assign(transformCel(next, {}), { ext: prev.ext }) : { ...next, ext: prev.ext };
}

export function copyLayers(layers: Layer[]) {
  return layers.map(l => ({ ...l, cels: l.cels.slice(), celOpacity: l.celOpacity.slice(), ...(l.effects ? { effects: l.effects.map(effect => ({ ...effect })) } : {}), ...(l.bakedEffects ? { bakedEffects: copyEffectScope(l) } : {}) }));
}

export function newLayer(name: string, frames: number): Layer {
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
export function normalizeDepths(layers: Layer[]) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const above = layers[i + 1];
    const max = !above ? 0 : above.group ? above.depth + 1 : above.depth;
    if (layers[i].depth > max) layers[i] = { ...layers[i], depth: max };
    if (layers[i].background && layers[i].depth) layers[i] = { ...layers[i], depth: 0 };
  }
  return layers;
}

export const span = ([a, b]: [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);


/** Lock Alpha is source-atop editing. Transparent/erasing results retain the source color. */
export function alphaLockedPixel(source: number, next: number): number {
  if (!(source >>> 24) || !(next >>> 24)) return source;
  return ((source & 0xff000000) | (next & 0xffffff)) >>> 0;
}

/** Pixel editing only; cel placement/structural transformations deliberately use setCel directly. */
export function alphaLockedCel(source: Cel, next: CelImage): CelImage {
  return { ...next, data: next.data.map((pixel, i) => alphaLockedPixel(celPixel(source, next.x + i % next.w, next.y + Math.floor(i / next.w)), pixel)) };
}
