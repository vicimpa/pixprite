/**
 * Tilesets and tilemaps. A tilemap cel keeps tile references (tile index per grid cell, 0 = empty)
 * plus the pixels they produce, so rendering and tools work on it like on any cel.
 */

import type { Rect } from "~/core/Image";

export type Tileset = {
  name: string;
  /** Tile size in pixels */
  tw: number;
  th: number;
  /** Tile images (tw×th); tile 0 is always the empty tile */
  tiles: Uint32Array[];
  /** Number shown for tile 1 in the UI (display only) */
  baseIndex: number;
  /** Note and color attached by the user */
  userData?: UserData;
};

/** Free-form note and color the user attaches to a layer, tag, slice or tileset; saved, shown nowhere on the canvas */
export type UserData = { text?: string; color?: string; };

/** How pixel edits on a tilemap turn into tiles */
export type TilesetMode = 'manual' | 'auto' | 'stack';

/** Tile references of a cel: `cols × rows` cells starting at the cel's position */
export type TileRefs = { cols: number; rows: number; refs: Uint32Array; };

/** Flip flags in the top bits of a tile reference; the rest is the tile index */
export const FLIP_X = 0x80000000, FLIP_Y = 0x40000000, FLIP_D = 0x20000000, TILE_INDEX = 0x1fffffff;
export const tileOf = (ref: number) => ref & TILE_INDEX;
export const flagsOf = (ref: number) => (ref & ~TILE_INDEX) >>> 0;

/** A tile image as a reference shows it: mirrored in x / y, then transposed (square tiles) */
export function transformTile(img: Uint32Array, tw: number, th: number, flags: number, inverse = false) {
  if (!flags) return img;
  const fx = !!(flags & FLIP_X), fy = !!(flags & FLIP_Y), fd = !!(flags & FLIP_D) && tw === th;
  const out = new Uint32Array(img.length);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      // Forward: flip, then transpose. Inverse: transpose, then flip
      let sx = x, sy = y;
      if (!inverse && fd) [sx, sy] = [sy, sx];
      if (fx) sx = tw - 1 - sx;
      if (fy) sy = th - 1 - sy;
      if (inverse && fd) [sx, sy] = [sy, sx];
      out[y * tw + x] = img[sy * tw + sx];
    }
  return out;
}

/** The image a reference shows */
export function tileImage(ts: Tileset, ref: number) {
  const tile = ts.tiles[tileOf(ref)];
  return tile ? transformTile(tile, ts.tw, ts.th, flagsOf(ref)) : new Uint32Array(ts.tw * ts.th);
}

/** Turns a reference a quarter clockwise by changing its flags */
export function rotateRef(ref: number) {
  const f = flagsOf(ref);
  const x = !!(f & FLIP_X), y = !!(f & FLIP_Y), d = !!(f & FLIP_D);
  return (tileOf(ref) | (y ? FLIP_X : 0) | (!x ? FLIP_Y : 0) | (!d ? FLIP_D : 0)) >>> 0;
}

export function newTileset(tw: number, th: number, name = 'Tileset'): Tileset {
  return { name, tw, th, tiles: [new Uint32Array(tw * th)], baseIndex: 1 };
}

/** Same content regardless of the color hidden in fully transparent pixels */
export function tileKey(img: Uint32Array) {
  let h = 2166136261;
  for (let i = 0; i < img.length; i++) h = Math.imul(h ^ ((img[i] >>> 24) ? img[i] : 0), 16777619);
  return `${img.length}:${h >>> 0}`;
}

export function sameTile(a: Uint32Array, b: Uint32Array) {
  for (let i = 0; i < a.length; i++) {
    const x = (a[i] >>> 24) ? a[i] : 0, y = (b[i] >>> 24) ? b[i] : 0;
    if (x !== y) return false;
  }
  return true;
}

export const isEmptyTile = (img: Uint32Array) => img.every(v => !(v >>> 24));

/** Pixels of a tilemap cel */
export function renderTiles(ts: Tileset, t: TileRefs): Uint32Array {
  const w = t.cols * ts.tw, out = new Uint32Array(w * t.rows * ts.th);
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.cols; c++) {
      const ref = t.refs[r * t.cols + c];
      if (!tileOf(ref) || !ts.tiles[tileOf(ref)]) continue;
      const tile = tileImage(ts, ref);
      for (let y = 0; y < ts.th; y++)
        out.set(tile.subarray(y * ts.tw, (y + 1) * ts.tw), (r * ts.th + y) * w + c * ts.tw);
    }
  return out;
}

/** The tile-sized image at grid cell (c, r) of a pixel buffer covering `area` */
export function cutTile(ts: Tileset, data: Uint32Array, area: Rect, c: number, r: number) {
  const img = new Uint32Array(ts.tw * ts.th);
  for (let y = 0; y < ts.th; y++) {
    const sy = r * ts.th + y;
    if (sy >= area.h) break;
    for (let x = 0; x < ts.tw; x++) {
      const sx = c * ts.tw + x;
      if (sx < area.w) img[y * ts.tw + x] = data[sy * area.w + sx];
    }
  }
  return img;
}

/** Grid-aligned rectangle (tile grid anchored at the canvas origin) covering `r` */
export function alignToTiles(ts: Tileset, r: Rect): Rect {
  const x0 = Math.floor(r.x / ts.tw) * ts.tw, y0 = Math.floor(r.y / ts.th) * ts.th;
  const x1 = Math.ceil((r.x + r.w) / ts.tw) * ts.tw, y1 = Math.ceil((r.y + r.h) / ts.th) * ts.th;
  return { x: x0, y: y0, w: Math.max(ts.tw, x1 - x0), h: Math.max(ts.th, y1 - y0) };
}

/** Index of an identical tile, or -1 */
export function findTile(ts: Tileset, img: Uint32Array, index?: Map<string, number[]>) {
  if (isEmptyTile(img)) return 0;
  const list = index?.get(tileKey(img)) ?? ts.tiles.map((_, i) => i);
  for (const i of list) if (i > 0 && sameTile(ts.tiles[i], img)) return i;
  return -1;
}

/** All flag combinations a tile can be shown with (the diagonal one only for square tiles) */
export function tileVariants(ts: Tileset) {
  const out = [0, FLIP_X, FLIP_Y, (FLIP_X | FLIP_Y) >>> 0];
  if (ts.tw === ts.th) out.push(...out.map(f => (f | FLIP_D) >>> 0));
  return out;
}

/** Reference showing `img`: an identical tile, else a flipped / turned one; -1 if none */
export function findTileFlipped(ts: Tileset, img: Uint32Array, index?: Map<string, number[]>) {
  const plain = findTile(ts, img, index);
  if (plain >= 0) return plain;
  for (const f of tileVariants(ts).slice(1)) {
    // A reference with flags f shows transform(tile, f); so look for the inverse transform of img
    const i = findTile(ts, transformTile(img, ts.tw, ts.th, f, true), index);
    if (i > 0) return (i | f) >>> 0;
  }
  return -1;
}

/** Flags showing a tile as `g` applied over `f` (a tile that is itself tile j with flags f, shown with g) */
export function composeFlags(ts: Tileset, f: number, g: number) {
  const n = ts.tw * ts.th, probe = new Uint32Array(n);
  for (let i = 0; i < n; i++) probe[i] = i + 1;
  const want = transformTile(transformTile(probe, ts.tw, ts.th, f), ts.tw, ts.th, g);
  for (const h of tileVariants(ts)) {
    const got = transformTile(probe, ts.tw, ts.th, h);
    if (got.every((v, i) => v === want[i])) return h;
  }
  return 0;
}

/** How many cells reference each tile (by index) in the given cels */
export function tileUsage(count: number, cels: Iterable<{ tiles?: TileRefs; }>) {
  const n = new Array<number>(count).fill(0);
  for (const c of cels) if (c.tiles) for (const r of c.tiles.refs) if (tileOf(r) < count) n[tileOf(r)]++;
  return n;
}

export function tileIndex(ts: Tileset) {
  const m = new Map<string, number[]>();
  ts.tiles.forEach((t, i) => {
    if (!i) return;
    const k = tileKey(t);
    m.set(k, [...m.get(k) ?? [], i]);
  });
  return m;
}

/** The tiles (without the empty tile 0) laid out in a grid image, `cols` per row */
export function tilesetImage(ts: Tileset, cols = 0): { w: number; h: number; data: Uint32Array; } {
  const n = Math.max(1, ts.tiles.length - 1);
  const c = cols > 0 ? cols : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / c), w = c * ts.tw, h = rows * ts.th;
  const data = new Uint32Array(w * h);
  for (let i = 1; i < ts.tiles.length; i++) {
    const tx = ((i - 1) % c) * ts.tw, ty = Math.floor((i - 1) / c) * ts.th;
    for (let y = 0; y < ts.th; y++) data.set(ts.tiles[i].subarray(y * ts.tw, (y + 1) * ts.tw), (ty + y) * w + tx);
  }
  return { w, h, data };
}

/** Cuts an image into tiles (left to right, then down); empty cells and repeats are skipped when asked */
export function tilesFromImage(img: { w: number; h: number; data: Uint32Array; }, tw: number, th: number, skipEmpty = true, skipDuplicates = true) {
  const out: Uint32Array[] = [];
  const seen = new Map<string, Uint32Array[]>();
  const area = { x: 0, y: 0, w: img.w, h: img.h };
  const probe: Tileset = { name: '', tw, th, tiles: [], baseIndex: 1 };
  for (let r = 0; r < Math.floor(img.h / th); r++)
    for (let c = 0; c < Math.floor(img.w / tw); c++) {
      const tile = cutTile(probe, img.data, area, c, r);
      if (skipEmpty && isEmptyTile(tile)) continue;
      if (skipDuplicates) {
        const k = tileKey(tile), list = seen.get(k) ?? [];
        if (list.some(t => sameTile(t, tile))) continue;
        seen.set(k, [...list, tile]);
      }
      out.push(tile);
    }
  return out;
}

/** A tilemap cel spread over the whole canvas grid: tile references per cell (0 = empty) */
export function mapGrid(ts: Tileset, cel: { x: number; y: number; tiles?: TileRefs; } | null, width: number, height: number) {
  const cols = Math.ceil(width / ts.tw), rows = Math.ceil(height / ts.th);
  const refs = new Uint32Array(cols * rows);
  const t = cel?.tiles;
  if (t && cel) {
    const ox = Math.round(cel.x / ts.tw), oy = Math.round(cel.y / ts.th);
    for (let r = 0; r < t.rows; r++)
      for (let c = 0; c < t.cols; c++) {
        const gx = c + ox, gy = r + oy;
        if (gx >= 0 && gy >= 0 && gx < cols && gy < rows) refs[gy * cols + gx] = t.refs[r * t.cols + c];
      }
  }
  return { cols, rows, refs };
}

/** Map as CSV: one row per line; tile index, with h / v / d appended for flips */
export function mapCsv(grid: { cols: number; rows: number; refs: Uint32Array; }) {
  const lines: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const ref = grid.refs[r * grid.cols + c];
      row.push(`${tileOf(ref)}${ref & FLIP_X ? 'h' : ''}${ref & FLIP_Y ? 'v' : ''}${ref & FLIP_D ? 'd' : ''}`);
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/** Map as JSON: tile indices plus flip flags kept apart, so readers need no bit tricks */
export function mapJson(ts: Tileset, grid: { cols: number; rows: number; refs: Uint32Array; }, layer: string, image?: string) {
  const refs = [...grid.refs];
  return JSON.stringify({
    layer, columns: grid.cols, rows: grid.rows,
    tileset: { name: ts.name, tileWidth: ts.tw, tileHeight: ts.th, tiles: ts.tiles.length - 1, image },
    /** 0 = empty, n = tile n of the tileset image (counting from 1) */
    tiles: refs.map(tileOf),
    flips: refs.some(r => flagsOf(r)) ? refs.map(r => ({ h: !!(r & FLIP_X), v: !!(r & FLIP_Y), d: !!(r & FLIP_D) })) : undefined,
  }, null, 1);
}
