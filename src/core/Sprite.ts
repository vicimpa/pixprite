import type { Locks, LocksRecord, MetaTarget } from "@pixprite/api";
import { prop, reactive } from "@vicimpa/decorators";
import { convertPixels, type ColorMode, type Dither, type PaletteMap } from "~/core/ColorMode";
import type { AseDocument } from "~/core/formats/Aseprite";
import { flipH, flipV, opaqueBounds, rotate, scaleNearest, toImageData, unionRect, type Bitmap, type Rect } from "~/core/Image";
import { Mask } from "~/core/Mask";
import type { TileRefs, Tileset, TilesetMode } from "~/core/Tilemap";
import type { Algorithm, Placement } from "~/core/Transform";
import * as FrameOperations from "./FrameOperations";
import * as LayerOperations from "./LayerOperations";
import * as SelectionOperations from "./SelectionOperations";
import type { SpriteContext } from "./SpriteContext";
import * as SpriteHistory from "./SpriteHistory";
import type { Snapshot } from "./SpriteHistory";
import {
  celPixel, celRect, cleanInfo, keepExt, lockedNotice, lockOwners, newLayer, parentOf, reframeCel,
  sliceKey, span, trimCel, type Cel, type CelImage, type ExtData, type Floating, type Frame,
  type FramePalette, type Guide, type Layer, type LockKind, type LockOp, type ProjectInfo, type Range,
  type RangeClip, type Slice, type SliceKey, type Tag, type TagDirection,
} from "./SpriteModel";
import * as SpriteRenderer from "./SpriteRenderer";
import * as SpriteSerialization from "./SpriteSerialization";
import * as TileOperations from "./TileOperations";
import { isCelInstance, moveCel, transformCel, validateCelTransform, validateLayerFX, type CelTransform, type LayerFX } from './DocumentModel';

export { packRgba, unpackRgba } from '~/core/Image';
export { historyLimits } from "./SpriteHistory";
export { createImage, createCelInstance, imageOf, transformCel, bakeCel, type Image, type AssetRef, type CelInstance, type CelTransform, type LayerFX } from './DocumentModel';
export {
  celRect, reframeCel, tagsByName, trimCel, cloneCel, celPixel, BLEND_MODES, cleanInfo, sliceKey,
  lockedNotice, lockOwners, subtreeStart, parentOf, childrenOf, rootsOf,
  type ExtData, type CelImage, type Cel, type BlendMode, type Layer, type RefImage, type Guide,
  type ProjectInfo, type Range, type Frame, type TagDirection, type Tag, type SliceKey, type Slice,
  type Floating, type RangeClip, type FramePalette, type LockKind, type LockOp,
} from "./SpriteModel";
export { migratePixpriteV3, migratePixpriteV4, PIXPRITE_VERSION, SUPPORTED_PIXPRITE_VERSIONS, type PixpriteData } from "./SpriteValidation";

@reactive()
export class Sprite {
  /** A single internal boundary keeps operation collaborators from exposing private state publicly. */
  private get operationContext(): SpriteContext { return this as unknown as SpriteContext; }

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
    return SpriteHistory.snapshot.call(this.operationContext, label);
  }

  private restore(s: Snapshot): void {
    return SpriteHistory.restore.call(this.operationContext, s);
  }

  private syncHistory(): void {
    return SpriteHistory.syncHistory.call(this.operationContext);
  }

  /** Call before any mutation that should be undoable; `label` is shown in the history panel */
  checkpoint(label = 'Edit'): void {
    return SpriteHistory.checkpoint.call(this.operationContext, label);
  }

  undo(): void {
    return SpriteHistory.undo.call(this.operationContext);
  }

  redo(): void {
    return SpriteHistory.redo.call(this.operationContext);
  }

  /** Pixel memory kept only by history (cels the current document doesn't share) */
  historyBytes(): number {
    return SpriteHistory.historyBytes.call(this.operationContext);
  }

  /** Drops the oldest steps beyond the limits */
  trimHistory(): void {
    return SpriteHistory.trimHistory.call(this.operationContext);
  }

  /** Undo back to `depth` steps and forget the undone ones (cancelled strokes) */
  rollback(depth: number): void {
    return SpriteHistory.rollback.call(this.operationContext, depth);
  }

  /** Jump so that exactly `count` steps are applied */
  goToStep(count: number): void {
    return SpriteHistory.goToStep.call(this.operationContext, count);
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
    return TileOperations.getTileset.call(this.operationContext);
  }

  private replaceCel(l: Layer, frame: number, next: Cel): void {
    return TileOperations.replaceCel.call(this.operationContext, l, frame, next);
  }

  /** Every distinct tilemap cel using tileset `t` */
  private tilemapCels(t: number): CelImage[] {
    return TileOperations.tilemapCels.call(this.operationContext, t);
  }

  /** Swaps tileset `t` and re-renders every cel that uses it (links stay links) */
  private commitTileset(t: number, ts: Tileset, remap?: (ref: number) => number): void {
    return TileOperations.commitTileset.call(this.operationContext, t, ts, remap);
  }

  /** Smallest grid-aligned cel holding the non-empty references, or null */
  private trimTiles(ts: Tileset, x: number, y: number, t: TileRefs): Cel {
    return TileOperations.trimTiles.call(this.operationContext, ts, x, y, t);
  }

  /**
   * Writes a tilemap cel. A cel that already carries tile references just moves (snapped to the grid);
   * pixels are turned into tiles following the tileset mode:
   * manual edits existing tiles in place, auto reuses / edits unshared / adds and drops orphans, stack only adds.
   */
  private setTilemapCel(cel: Cel, layer: number, frame: number): void {
    return TileOperations.setTilemapCel.call(this.operationContext, cel, layer, frame);
  }

  /** Reorders / removes tiles of the active tileset; maps keep showing the same images */
  private editTiles(label: string, order: number[]): void {
    return TileOperations.editTiles.call(this.operationContext, label, order);
  }

  /** Deletes tiles (cells that used them become empty) */
  deleteTiles(indices: number[]): void {
    return TileOperations.deleteTiles.call(this.operationContext, indices);
  }

  /** Moves a tile to another position (never before the empty tile 0) */
  moveTile(from: number, to: number): void {
    return TileOperations.moveTile.call(this.operationContext, from, to);
  }

  /** A copy of a tile at the end of the tileset */
  duplicateTile(index: number): void {
    return TileOperations.duplicateTile.call(this.operationContext, index);
  }

  /** How many cells use each tile of the active tileset (all layers and frames sharing it) */
  tileUsage(): number[] {
    return TileOperations.tileUsage.call(this.operationContext);
  }

  /** Deletes the tiles no cell uses; returns how many went */
  removeUnusedTiles(): number {
    return TileOperations.removeUnusedTiles.call(this.operationContext);
  }

  /** Folds tiles equal to an earlier one (also mirrored / turned) into it; returns how many went */
  mergeDuplicateTiles(): number {
    return TileOperations.mergeDuplicateTiles.call(this.operationContext);
  }

  /**
   * Moves the active tilemap layer onto tileset `target` (same tile size).
   * `rematch` finds each shown tile in the target by its pixels (also mirrored / turned), adding missing ones;
   * otherwise references keep their numbers (ones past the end become empty).
   */
  changeTileset(target: number, rematch: boolean): void {
    return TileOperations.changeTileset.call(this.operationContext, target, rematch);
  }

  /** Slices a pixel cel into tiles of `tiles` (reusing identical ones, appending new ones) */
  private tilesFromPixels(ts: Tileset, tiles: Uint32Array[], cel: CelImage): Cel {
    return TileOperations.tilesFromPixels.call(this.operationContext, ts, tiles, cel);
  }

  /** New tilemap layer with its own tileset, placed like a new layer */
  addTilemapLayer(tw: number, th: number, tileset = -1): void {
    return TileOperations.addTilemapLayer.call(this.operationContext, tw, th, tileset);
  }

  /** Appends tiles (tile-sized images) to the active tileset */
  importTiles(tiles: Uint32Array[]): void {
    return TileOperations.importTiles.call(this.operationContext, tiles);
  }

  /** Turns a pixel layer into a tilemap, making a tileset from its pixels */
  convertToTilemap(tw: number, th: number, index = this.layer): void {
    return TileOperations.convertToTilemap.call(this.operationContext, tw, th, index);
  }

  /** Back to plain pixels (the tileset stays in the sprite) */
  convertToPixels(index = this.layer): void {
    return TileOperations.convertToPixels.call(this.operationContext, index);
  }

  /** Tiles mode: puts tile `ref` at grid cell (gx, gy) of the active tilemap cel */
  setTileAt(gx: number, gy: number, ref: number, layer = this.layer, frame = this.frame): void {
    return TileOperations.setTileAt.call(this.operationContext, gx, gy, ref, layer, frame);
  }

  /** Tile reference under a sprite pixel on a tilemap layer */
  tileAt(x: number, y: number, layer = this.layer, frame = this.frame): number {
    return TileOperations.tileAt.call(this.operationContext, x, y, layer, frame);
  }

  /** After whole-canvas changes: rebuilds tilesets from the pixels so maps stay on the grid */
  private rebuildTilemaps(): void {
    return TileOperations.rebuildTilemaps.call(this.operationContext);
  }

  /** Moves a cel (and its links) without touching its pixels */
  offsetCel(dx: number, dy: number, layer = this.layer, frame = this.frame) {
    const cel = this.getCel(layer, frame);
    if (!cel) return;
    const next = moveCel(cel, cel.x + dx, cel.y + dy);
    if (isCelInstance(cel)) {
      this.replaceCel(this.layers[layer], frame, next);
      this.touch();
    } else this.setCel(next, layer, frame);
  }

  /** Nondestructive placement changes preserve continuous links and shared source pixels. */
  setCelTransform(transform: Partial<CelTransform>, layer = this.layer, frame = this.frame): boolean {
    validateCelTransform(transform);
    const cel = this.getCel(layer, frame), target = this.layers[layer];
    if (!cel || !target || target.background || target.reference || this.lockedDeep(layer)) return false;
    const next = transformCel(cel, transform);
    this.checkpoint('Cel transform');
    this.replaceCel(target, frame, next);
    this.touch();
    return true;
  }

  setLayerEffects(effects: LayerFX[], layer = this.layer): boolean {
    validateLayerFX(effects);
    const target = this.layers[layer];
    if (!target || target.reference || this.lockedDeep(layer)) return false;
    this.checkpoint('Layer effects');
    this.layers = this.layers.map((item, i) => i === layer ? { ...item, effects: effects.map(effect => ({ ...effect })) } : item);
    this.touch();
    return true;
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

  get backgroundIndex(): number {
    return LayerOperations.getBackgroundIndex.call(this.operationContext);
  }

  private filledCel(): CelImage {
    return LayerOperations.filledCel.call(this.operationContext);
  }

  /** "Prefix N" with N one more than the highest used so far (gaps are not reused) */
  private nextName(prefix: string): string {
    return LayerOperations.nextName.call(this.operationContext, prefix);
  }

  /** Where a new layer goes: inside an open active group (at its bottom), else right above the active layer */
  private insertionPoint(): { index: number; depth: number; } {
    return LayerOperations.insertionPoint.call(this.operationContext);
  }

  addLayer(below = false): string {
    return LayerOperations.addLayer.call(this.operationContext, below);
  }

  /** New group above the active layer; selected sibling layers move into it */
  addGroup(): void {
    return LayerOperations.addGroup.call(this.operationContext);
  }

  duplicateLayer(): void {
    return LayerOperations.duplicateLayer.call(this.operationContext);
  }

  removeLayers(): boolean {
    return LayerOperations.removeLayers.call(this.operationContext);
  }

  /**
   * One step up or down among siblings. At the edge of a group the layer leaves it;
   * moving down onto an open group enters it.
   */
  moveLayer(dir: -1 | 1): void {
    return LayerOperations.moveLayer.call(this.operationContext, dir);
  }

  /** Moves layers [a..b] so they end up right below index `before`, re-nesting the block's root at `depth` */
  private moveBlock(a: number, b: number, before: number, depth: number, label: string): void {
    return LayerOperations.moveBlock.call(this.operationContext, a, b, before, depth, label);
  }

  /** Takes the active layer out of its group, right above the group */
  moveOutOfGroup(): void {
    return LayerOperations.moveOutOfGroup.call(this.operationContext);
  }

  /** Dissolves a group, keeping its contents in place */
  ungroup(): void {
    return LayerOperations.ungroup.call(this.operationContext);
  }

  toggleCollapsed(i: number): void {
    return LayerOperations.toggleCollapsed.call(this.operationContext, i);
  }

  updateLayer(index: number, patch: Partial<Omit<Layer, 'cels' | 'celOpacity'>>, label = 'Layer properties'): boolean {
    return LayerOperations.updateLayer.call(this.operationContext, index, patch, label);
  }

  /** Reference layer above the current one holding an outside image, scaled to fit the canvas */
  addReferenceLayer(src: string, w: number, h: number, name = 'Reference'): void {
    return LayerOperations.addReferenceLayer.call(this.operationContext, src, w, h, name);
  }

  private soloSaved: { layers: Layer[]; visible: boolean[]; } | null = null;

  /** Shows only this layer (with its groups and children); called again on the same layer restores the rest */
  soloLayer(i: number): void {
    return LayerOperations.soloLayer.call(this.operationContext, i);
  }

  /** Visibility / lock / continuous for every layer: if all are on, turn all off, otherwise all on */
  toggleAllLayers(flag: 'visible' | 'locked' | 'continuous'): void {
    return LayerOperations.toggleAllLayers.call(this.operationContext, flag);
  }

  /** Turns the current layer into the opaque bottom background */
  layerToBackground(): void {
    return LayerOperations.layerToBackground.call(this.operationContext);
  }

  backgroundToLayer(): void {
    return LayerOperations.backgroundToLayer.call(this.operationContext);
  }

  /** The layer below must be a plain layer at the same level */
  get canMergeDown(): boolean {
    return LayerOperations.getCanMergeDown.call(this.operationContext);
  }

  mergeDown(): void {
    return LayerOperations.mergeDown.call(this.operationContext);
  }

  /** Sibling nodes of the timeline layer range (bottom to top), when there are at least two */
  get rangeNodes(): number[] | null {
    return LayerOperations.getRangeNodes.call(this.operationContext);
  }

  get canMergeVisible(): boolean {
    return LayerOperations.getCanMergeVisible.call(this.operationContext);
  }

  /** Merges the shown top-level layers into one, in place of the lowest; hidden ones are kept */
  mergeVisible(): void {
    return LayerOperations.mergeVisible.call(this.operationContext);
  }

  /** Merges the sibling layers of the timeline range (hidden ones in it are dropped) */
  mergeSelected(): void {
    return LayerOperations.mergeSelected.call(this.operationContext);
  }

  private mergeNodes(nodes: number[], label: string): void {
    return LayerOperations.mergeNodes.call(this.operationContext, nodes, label);
  }

  flattenAll(): void {
    return LayerOperations.flattenAll.call(this.operationContext);
  }

  /** Composites layers into one cel; `elastic` keeps pixels outside the canvas (else canvas-sized) */
  /**
   * Layers are sibling nodes, bottom to top, composited as the canvas shows them (clipping included).
   * `vis` decides which of them count as shown; a leading clipping layer has no base in the list
   * and is drawn plainly (it gets clipped again by its own base after the merge).
   */
  private flatten(frame: number, layers: number[], elastic = false, vis = (i: number) => this.layers[i].visible): Cel {
    return LayerOperations.flatten.call(this.operationContext, frame, layers, elastic, vis);
  }

  // Frames

  /** Inserts frames at `at` (before it) with the given cel source per layer */
  private insertFrames(at: number, count: number, make: (layer: Layer, li: number, k: number) => Cel, duration = 100): void {
    return FrameOperations.insertFrames.call(this.operationContext, at, count, make, duration);
  }

  /**
   * Places outside images into this document at (x, y): as a new layer (image i lands on frame
   * current + i, frames are added when needed) or as new frames after the current one on the active layer.
   */
  importImages(images: { w: number; h: number; data: Uint32Array; delay: number; }[], mode: 'layer' | 'frames', x: number, y: number, name = 'Imported'): void {
    return FrameOperations.importImages.call(this.operationContext, images, mode, x, y, name);
  }

  addFrame(mode: 'empty' | 'duplicate' = 'duplicate'): boolean {
    return FrameOperations.addFrame.call(this.operationContext, mode);
  }

  removeFrames(): boolean {
    return FrameOperations.removeFrames.call(this.operationContext);
  }

  /** Keeps tag ranges valid after inserting (delta > 0) or removing (delta -1) frames at `at` */
  private shiftTags(at: number, delta: number): void {
    return FrameOperations.shiftTags.call(this.operationContext, at, delta);
  }

  moveFrame(dir: -1 | 1): void {
    return FrameOperations.moveFrame.call(this.operationContext, dir);
  }

  /**
   * Moves (or copies) the frame block [a, b] so it starts before frame `before`.
   * Durations travel with the frames; copies link cels on continuous layers.
   */
  moveFrames([a, b]: [number, number], before: number, copy: boolean): void {
    return FrameOperations.moveFrames.call(this.operationContext, [a, b], before, copy);
  }

  /** Moves (or copies) the layer block [a, b] so it sits right below layer index `before` (bottom-to-top order) */
  moveLayers([a, b]: [number, number], before: number, copy: boolean): boolean {
    return LayerOperations.moveLayers.call(this.operationContext, [a, b], before, copy);
  }

  /** Moves (or copies) a rectangle of cels by (dl, df); missing frames are created */
  moveCels(r: Range, dl: number, df: number, copy: boolean): void {
    return FrameOperations.moveCels.call(this.operationContext, r, dl, df, copy);
  }

  /** Copies the selected cel block right after itself (links follow each layer's continuous flag) */
  duplicateCels(linked?: boolean): void {
    return FrameOperations.duplicateCels.call(this.operationContext, linked);
  }

  /** Snapshot of the timeline range for copy/paste inside the timeline */
  copyRange(): RangeClip | null {
    return FrameOperations.copyRange.call(this.operationContext);
  }

  pasteRange(clip: RangeClip): void {
    return FrameOperations.pasteRange.call(this.operationContext, clip);
  }

  /** Every later frame of the range shares the first non-empty cel of each layer */
  linkCels(): void {
    return FrameOperations.linkCels.call(this.operationContext);
  }

  unlinkCels(): void {
    return FrameOperations.unlinkCels.call(this.operationContext);
  }

  clearCels(): void {
    return FrameOperations.clearCels.call(this.operationContext);
  }

  setCelOpacity(opacity: number): void {
    return FrameOperations.setCelOpacity.call(this.operationContext, opacity);
  }

  reverseFrames(): void {
    return FrameOperations.reverseFrames.call(this.operationContext);
  }

  setDuration(duration: number, all = false): void {
    return FrameOperations.setDuration.call(this.operationContext, duration, all);
  }

  /** Bulk timing: set, multiply or add to the duration of the selected (or all) frames */
  changeDurations(mode: 'set' | 'multiply' | 'add', value: number, all = false): void {
    return FrameOperations.changeDurations.call(this.operationContext, mode, value, all);
  }

  /** Scales a tag's frame durations so the whole tag lasts `total` ms */
  stretchTag(index: number, total: number): void {
    return FrameOperations.stretchTag.call(this.operationContext, index, total);
  }

  /**
   * Inserts `count` in-between frames before the last frame of the range (or after the current one),
   * moving the current layer's cel position and opacity from the first key to the last.
   * Pixels come from the nearer key; other layers hold the first key's cel.
   */
  tweenFrames(count: number, ease = false): boolean {
    return FrameOperations.tweenFrames.call(this.operationContext, count, ease);
  }

  /** Moves the content of every selected cel by (dx, dy); linked cels move once */
  nudgeCels(dx: number, dy: number): void {
    return FrameOperations.nudgeCels.call(this.operationContext, dx, dy);
  }

  addTag(): boolean {
    return FrameOperations.addTag.call(this.operationContext);
  }

  updateTag(index: number, patch: Partial<Tag>, checkpoint = true): boolean {
    return FrameOperations.updateTag.call(this.operationContext, index, patch, checkpoint);
  }

  removeTag(index: number): boolean {
    return FrameOperations.removeTag.call(this.operationContext, index);
  }

  /** The innermost (shortest) tag containing the frame */
  tagAt(frame = this.frame): Tag | null {
    return FrameOperations.tagAt.call(this.operationContext, frame);
  }

  /** Frames playback and frame navigation stay within: innermost tag, else loop section, else everything */
  playRange(frame = this.frame): { from: number; to: number; direction: TagDirection; repeat?: number; } {
    return FrameOperations.playRange.call(this.operationContext, frame);
  }

  /** Frame order of a tag: one pass per its direction, unrolled `repeat` times (at least once) */
  tagSequence(t: { from: number; to: number; direction: TagDirection; repeat?: number; }): number[] {
    return FrameOperations.tagSequence.call(this.operationContext, t);
  }

  /** Sets the loop section to the selected frames, or clears it */
  setLoopSection(): void {
    return FrameOperations.setLoopSection.call(this.operationContext);
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

  setMask(mask: Mask | null, label = 'Select'): void {
    return SelectionOperations.setMask.call(this.operationContext, mask, label);
  }

  selectAll(): void {
    return SelectionOperations.selectAll.call(this.operationContext);
  }

  deselect(): void {
    return SelectionOperations.deselect.call(this.operationContext);
  }

  reselect(): void {
    return SelectionOperations.reselect.call(this.operationContext);
  }

  invertSelection(): void {
    return SelectionOperations.invertSelection.call(this.operationContext);
  }

  /** Moves only the selection outline, pixels stay */
  moveMask(dx: number, dy: number): void {
    return SelectionOperations.moveMask.call(this.operationContext, dx, dy);
  }

  /** Bitmap under the selection (or the whole layer), cropped to the selection bounds */
  private selectedBitmap(layer = this.layer, frame = this.frame): { bmp: Bitmap; rect: Rect; shape: Uint8Array; } {
    return SelectionOperations.selectedBitmap.call(this.operationContext, layer, frame);
  }

  private eraseSelection(): void {
    return SelectionOperations.eraseSelection.call(this.operationContext);
  }

  private makeFloating(src: Bitmap, shape: Uint8Array, place: Placement, layer = this.layer, frame = this.frame): Floating {
    return SelectionOperations.makeFloating.call(this.operationContext, src, shape, place, layer, frame);
  }

  /** Renders the floating pixels for a new placement and updates the selection outline to match */
  private setFloating(f: Floating | null): void {
    return SelectionOperations.setFloating.call(this.operationContext, f);
  }

  /** Lifts the selected pixels into a floating layer so they can be moved/transformed */
  liftSelection(copy = false): Floating | null {
    return SelectionOperations.liftSelection.call(this.operationContext, copy);
  }

  /** New placement for the floating pixels; re-rendered from the original every time */
  placeFloating(place: Placement): void {
    return SelectionOperations.placeFloating.call(this.operationContext, place);
  }

  moveFloating(x: number, y: number): void {
    return SelectionOperations.moveFloating.call(this.operationContext, x, y);
  }

  /** Swaps the floating pixels for a new image at the same spot (live text while typing) */
  replaceFloating(bmp: Bitmap): void {
    return SelectionOperations.replaceFloating.call(this.operationContext, bmp);
  }

  /** Re-render with the current algorithm (after the user switches it) */
  rerenderFloating(): void {
    return SelectionOperations.rerenderFloating.call(this.operationContext);
  }

  /**
   * The floating pixels composited over a copy of their cel.
   * The cel grows to hold them, so nothing dropped outside the canvas is lost.
   */
  private mergeFloating(f: Floating): Cel {
    return SelectionOperations.mergeFloating.call(this.operationContext, f);
  }

  /** Writes floating pixels into their cel (alpha composited) */
  dropFloating(): void {
    return SelectionOperations.dropFloating.call(this.operationContext);
  }

  /** Throws away the transformation and restores the pixels from before the lift */
  cancelFloating(): void {
    return SelectionOperations.cancelFloating.call(this.operationContext);
  }

  /** Stamp a copy of the floating pixels and keep moving the original (Ctrl+drag while floating) */
  stampFloating(): void {
    return SelectionOperations.stampFloating.call(this.operationContext);
  }

  /** Replace the selected pixels (or the whole cel) through `fn` */
  transformSelection(label: string, fn: (bmp: Bitmap) => Bitmap): void {
    return SelectionOperations.transformSelection.call(this.operationContext, label, fn);
  }

  /** Rotate the selection by quarter turns as a live transform (the user can still move it) */
  rotateSelection(turns: number): void {
    return SelectionOperations.rotateSelection.call(this.operationContext, turns);
  }

  /** Apply a per-pixel color function to the selection (or the whole cel) */
  mapPixels(label: string, fn: (v: number) => number): void {
    return SelectionOperations.mapPixels.call(this.operationContext, label, fn);
  }

  /** Replace the selection's pixels with a whole-buffer filter result */
  applyFilter(label: string, fn: (data: Uint32Array, mask: Mask | null) => Uint32Array, cels: [number, number][] = [[this.layer, this.frame]]): void {
    return SelectionOperations.applyFilter.call(this.operationContext, label, fn, cels);
  }

  clearSelection(): void {
    return SelectionOperations.clearSelection.call(this.operationContext);
  }

  copySelection(merged = false): Bitmap | null {
    return SelectionOperations.copySelection.call(this.operationContext, merged);
  }

  /** Where copied pixels came from, used to paste them back in place */
  get selectionOrigin(): { x: number; y: number; } | null {
    return SelectionOperations.getSelectionOrigin.call(this.operationContext);
  }

  paste(bmp: Bitmap, at?: { x: number; y: number; }, label = 'Paste'): void {
    return SelectionOperations.paste.call(this.operationContext, bmp, at, label);
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
  private drawLayer(ctx: OffscreenCanvasRenderingContext2D, index: number, frame: number, force = false, override?: Uint32Array, ox = 0, oy = 0): void {
    return SpriteRenderer.drawLayer.call(this.operationContext, ctx, index, frame, force, override, ox, oy);
  }

  /** Draws a layer, or a group composited from its children with the group's opacity and blend */
  private drawNode(ctx: OffscreenCanvasRenderingContext2D, i: number, frame: number, force: boolean, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0): void {
    return SpriteRenderer.drawNode.call(this.operationContext, ctx, i, frame, force, override, ox, oy);
  }

  /**
   * Draws sibling nodes bottom to top. A run of clipping layers is drawn on a copy of the
   * layer under it, masked by that layer's alpha, then the result goes down with its blend.
   */
  private drawSiblings(ctx: OffscreenCanvasRenderingContext2D, list: number[], frame: number, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0, vis = (i: number) => this.layers[i].visible): void {
    return SpriteRenderer.drawSiblings.call(this.operationContext, ctx, list, frame, override, ox, oy, vis);
  }

  /**
   * Set by the editor while a stroke changes only this layer: the composites below and above it
   * are kept between redraws (checked against the cels they were made from).
   */
  focusLayer: number | null = null;
  private split: { sig: unknown[]; below: OffscreenCanvas; above: OffscreenCanvas; } | null = null;

  /** Composite as below + layer + above, reusing the cached parts; null when the layer stack doesn't allow it */
  private renderSplit(frame: number, at: number, override?: (i: number) => Uint32Array | undefined): OffscreenCanvas | null {
    return SpriteRenderer.renderSplit.call(this.operationContext, frame, at, override);
  }

  /**
   * Flattened image of a frame, cached until the next change.
   * `only` renders a single layer; `override` swaps one layer's pixels (brush preview) and skips the cache.
   */
  render(frame = this.frame, only?: number, override?: { layer: number; data: Uint32Array; }): OffscreenCanvas {
    return SpriteRenderer.render.call(this.operationContext, frame, only, override);
  }

  // Serialization

  /** Layers with floating pixels merged in, as they would be saved */
  private savedLayers(): Layer[] {
    return SpriteSerialization.savedLayers.call(this.operationContext);
  }

  toJSON(): ReturnType<typeof SpriteSerialization.toJSON> {
    return SpriteSerialization.toJSON.call(this.operationContext);
  }

  load(data: unknown): void {
    return SpriteSerialization.load.call(this.operationContext, data);
  }

  toDocument(): AseDocument {
    return SpriteSerialization.toDocument.call(this.operationContext);
  }

  fromDocument(doc: AseDocument, name = 'untitled'): void {
    return SpriteSerialization.fromDocument.call(this.operationContext, doc, name);
  }

  loadImage(image: ImageBitmap | HTMLImageElement, name = 'image'): void {
    return SpriteSerialization.loadImage.call(this.operationContext, image, name);
  }

  /** One frame per buffer (animated GIF, image sequence) */
  loadFrames(width: number, height: number, frames: { data: Uint32Array; delay: number; }[], name = 'animation'): void {
    return SpriteSerialization.loadFrames.call(this.operationContext, width, height, frames, name);
  }

  /**
   * Splits a sheet into frames: cells of cw×ch starting at (x0, y0), read by rows or columns.
   * `partial` keeps cells cut by the sheet edge.
   */
  loadSheet(image: ImageBitmap, cw: number, ch: number, name = 'sheet', opts: { x0?: number; y0?: number; byColumns?: boolean; partial?: boolean; } = {}): boolean {
    return SpriteSerialization.loadSheet.call(this.operationContext, image, cw, ch, name, opts);
  }

  /**
   * Builds frames from a sheet and its JSON description (the common texture-packer layout:
   * `frames` as a list or a name map, each with `frame`, optional `rotated`, `spriteSourceSize`,
   * `sourceSize`, `duration`; `meta.frameTags` become tags). Without tags in the description,
   * `tagByName` tags runs of frames named alike ("run_0", "run_1" → "run"). Returns false when nothing fits.
   */
  loadSheetData(image: ImageBitmap, json: unknown, name = 'sheet', tagByName = true): boolean {
    return SpriteSerialization.loadSheetData.call(this.operationContext, image, json, name, tagByName);
  }

  /** Image data of a frame for exporters */
  frameImage(frame: number): ImageData {
    return SpriteSerialization.frameImage.call(this.operationContext, frame);
  }
}

export { toImageData };
