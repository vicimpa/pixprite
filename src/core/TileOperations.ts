import { unionRect } from "~/core/Image";
import {
  alignToTiles, composeFlags, tileUsage as countTileUsage, cutTile, findTileFlipped, flagsOf, isEmptyTile,
  newTileset, renderTiles, sameTile, tileImage, tileIndex, tileOf, transformTile, type TileRefs,
  type Tileset,
} from "~/core/Tilemap";
import type { SpriteContext } from "./SpriteContext";
import { celRect, reframeCel, trimCel, type Cel, type CelImage, type Layer } from "./SpriteModel";
import { bakeCel, createCelInstance, createImage, hasCelTransform, isCelInstance, sourcePoint } from './DocumentModel';

export function getTileset(this: SpriteContext): Tileset | null {
  return this.tilesets[this.current?.tileset ?? -1] ?? null;
}

export function replaceCel(this: SpriteContext, l: Layer, frame: number, next: Cel): void {
  const old = l.cels[frame];
  if (old) l.cels.forEach((c, f) => { if (c === old) l.cels[f] = next; });
  else l.cels[frame] = next;
}

/** Every distinct tilemap cel using tileset `t` */
export function tilemapCels(this: SpriteContext, t: number): CelImage[] {
  const out = new Set<CelImage>();
  for (const l of this.layers) if (l.tileset === t) for (const c of l.cels) if (c?.tiles) out.add(c);
  return [...out];
}

/** Swaps tileset `t` and re-renders every cel that uses it (links stay links) */
export function commitTileset(this: SpriteContext, t: number, ts: Tileset, remap?: (ref: number) => number): void {
  this.tilesets = this.tilesets.map((x, i) => i === t ? ts : x);
  const done = new Map<CelImage, Cel>();
  for (const l of this.layers) {
    if (l.tileset !== t) continue;
    l.cels = l.cels.map(c => {
      if (!c?.tiles) return c;
      let next = done.get(c);
      if (next === undefined) {
        const tiles = remap ? { ...c.tiles, refs: c.tiles.refs.map(remap) } : c.tiles;
        const data = renderTiles(ts, tiles);
        next = isCelInstance(c)
          ? Object.assign(createCelInstance(createImage(tiles.cols * ts.tw, tiles.rows * ts.th, data), { ...c.transform, x: c.x, y: c.y, ext: c.ext }), { tiles })
          : { ...c, tiles, data };
        done.set(c, next);
      }
      return next;
    });
  }
}

/** Smallest grid-aligned cel holding the non-empty references, or null */
export function trimTiles(this: SpriteContext, ts: Tileset, x: number, y: number, t: TileRefs): Cel {
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
/** Painting bakes only this placed instance into its own tile references, leaving sibling sources unchanged. */
function prepareTileEdit(this: SpriteContext, layer: number, frame: number) {
  const target = this.layers[layer], old = target?.cels[frame], ts = this.tilesets[target?.tileset ?? -1];
  if (!old || !ts || !hasCelTransform(old)) return;
  const tiles = ts.tiles.slice();
  const next = this.tilesFromPixels(ts, tiles, bakeCel(old)!);
  this.replaceCel(target, frame, next);
  this.tilesets = this.tilesets.map((item, index) => index === target.tileset ? { ...item, tiles } : item);
}

export function setTilemapCel(this: SpriteContext, cel: Cel, layer: number, frame: number): void {
  if (cel && hasCelTransform(cel)) cel = bakeCel(cel);
  prepareTileEdit.call(this, layer, frame);
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
export function editTiles(this: SpriteContext, label: string, order: number[]): void {
  const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
  if (!ts) return;
  this.checkpoint(label);
  // order[newIndex] = oldIndex; tile 0 always stays first
  const map = new Map(order.map((old, i) => [old, i]));
  this.commitTileset(t, { ...ts, tiles: order.map(i => ts.tiles[i]) }, ref => map.has(tileOf(ref)) ? (map.get(tileOf(ref))! | flagsOf(ref)) >>> 0 : 0);
  this.touch();
}

/** Deletes tiles (cells that used them become empty) */
export function deleteTiles(this: SpriteContext, indices: number[]): void {
  const ts = this.tileset;
  if (!ts) return;
  const drop = new Set(indices.filter(i => i > 0));
  if (drop.size) this.editTiles('Delete tiles', ts.tiles.map((_, i) => i).filter(i => !drop.has(i)));
}

/** Moves a tile to another position (never before the empty tile 0) */
export function moveTile(this: SpriteContext, from: number, to: number): void {
  const ts = this.tileset;
  if (!ts || from < 1 || from >= ts.tiles.length) return;
  to = Math.max(1, Math.min(ts.tiles.length - 1, to));
  if (to === from) return;
  const order = ts.tiles.map((_, i) => i).filter(i => i !== from);
  order.splice(to, 0, from);
  this.editTiles('Move tile', order);
}

/** A copy of a tile at the end of the tileset */
export function duplicateTile(this: SpriteContext, index: number): void {
  const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
  if (!ts || index < 1 || !ts.tiles[index]) return;
  this.checkpoint('Duplicate tile');
  this.tilesets = this.tilesets.map((x, i) => i === t ? { ...ts, tiles: [...ts.tiles, ts.tiles[index].slice()] } : x);
  this.touch();
}

/** How many cells use each tile of the active tileset (all layers and frames sharing it) */
export function tileUsage(this: SpriteContext): number[] {
  const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
  return ts ? countTileUsage(ts.tiles.length, this.tilemapCels(t)) : [];
}

/** Deletes the tiles no cell uses; returns how many went */
export function removeUnusedTiles(this: SpriteContext): number {
  const use = this.tileUsage();
  const drop = use.map((n, i) => i > 0 && !n ? i : -1).filter(i => i > 0);
  if (drop.length) this.deleteTiles(drop);
  return drop.length;
}

/** Folds tiles equal to an earlier one (also mirrored / turned) into it; returns how many went */
export function mergeDuplicateTiles(this: SpriteContext): number {
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
export function changeTileset(this: SpriteContext, target: number, rematch: boolean): void {
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
export function tilesFromPixels(this: SpriteContext, ts: Tileset, tiles: Uint32Array[], cel: CelImage): Cel {
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
export function addTilemapLayer(this: SpriteContext, tw: number, th: number, tileset = -1): void {
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
export function importTiles(this: SpriteContext, tiles: Uint32Array[]): void {
  const t = this.current?.tileset ?? -1, ts = this.tilesets[t];
  if (!ts || !tiles.length) return;
  this.checkpoint('Import tiles');
  this.tilesets = this.tilesets.map((x, i) => i === t ? { ...ts, tiles: [...ts.tiles, ...tiles] } : x);
  this.touch();
}

/** Turns a pixel layer into a tilemap, making a tileset from its pixels */
export function convertToTilemap(this: SpriteContext, tw: number, th: number, index = this.layer): void {
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
export function convertToPixels(this: SpriteContext, index = this.layer): void {
  const l = this.layers[index];
  if (!l || l.tileset < 0) return;
  this.checkpoint('Convert to layer');
  const done = new Map<CelImage, Cel>();
  const cels = l.cels.map(c => c ? done.get(c) ?? done.set(c, trimCel({ ...celRect(c), data: c.data })).get(c)! : null);
  this.layers = this.layers.map((x, i) => i === index ? { ...x, tileset: -1, cels } : x);
  this.touch();
}

/** Tiles mode: puts tile `ref` at grid cell (gx, gy) of the active tilemap cel */
export function setTileAt(this: SpriteContext, gx: number, gy: number, ref: number, layer = this.layer, frame = this.frame): void {
  prepareTileEdit.call(this, layer, frame);
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
export function tileAt(this: SpriteContext, x: number, y: number, layer = this.layer, frame = this.frame): number {
  const l = this.layers[layer], ts = this.tilesets[l?.tileset ?? -1], c = l?.cels[frame];
  if (!ts || !c?.tiles) return 0;
  const point = sourcePoint(c, x - c.x, y - c.y);
  if (!point) return 0;
  const gc = Math.floor(point.x / ts.tw), gr = Math.floor(point.y / ts.th);
  return gc >= 0 && gr >= 0 && gc < c.tiles.cols && gr < c.tiles.rows ? c.tiles.refs[gr * c.tiles.cols + gc] : 0;
}

/** After whole-canvas changes: rebuilds tilesets from the pixels so maps stay on the grid */
export function rebuildTilemaps(this: SpriteContext): void {
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
