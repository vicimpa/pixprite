/** Colour quantization: palette extraction (median cut) and palette remapping. */

import { packRgba, unpackRgba } from './Image';

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** Packed colour -> '#rrggbb' or '#rrggbbaa' (when translucent and alpha requested) */
function toHex(c: number, withAlpha: boolean) {
  const [r, g, b, a] = unpackRgba(c);
  return '#' + hex2(r) + hex2(g) + hex2(b) + (withAlpha && a < 255 ? hex2(a) : '');
}

/** '#rgb', '#rrggbb' or '#rrggbbaa' -> packed colour */
function fromHex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return packRgba(r | 0, g | 0, b | 0, a | 0);
}

type Entry = { n: number; c: [number, number, number, number]; };

/** Population-weighted mean of a set of entries */
function meanOf(list: Entry[]) {
  let n = 0, r = 0, g = 0, b = 0, a = 0;
  for (const e of list) {
    n += e.n; r += e.c[0] * e.n; g += e.c[1] * e.n; b += e.c[2] * e.n; a += e.c[3] * e.n;
  }
  return packRgba(Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n));
}

type Box = { items: Entry[]; pop: number; axis: number; len: number; };

function makeBox(items: Entry[]): Box {
  let pop = 0;
  const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
  for (const e of items) {
    pop += e.n;
    for (let k = 0; k < 4; k++) {
      if (e.c[k] < lo[k]) lo[k] = e.c[k];
      if (e.c[k] > hi[k]) hi[k] = e.c[k];
    }
  }
  let axis = 0, len = -1;
  for (let k = 0; k < 4; k++) if (hi[k] - lo[k] > len) { len = hi[k] - lo[k]; axis = k; }
  return { items, pop, axis, len };
}

function medianCut(entries: Entry[], count: number) {
  const boxes: Box[] = [makeBox(entries)];
  while (boxes.length < count) {
    let best = -1, score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.items.length < 2) continue;
      const s = b.pop * (b.len + 1);
      if (s > score) { score = s; best = i; }
    }
    if (best < 0) break;
    const { items, pop, axis } = boxes[best];
    items.sort((x, y) => x.c[axis] - y.c[axis]);
    let acc = 0, cut = 1;
    for (let i = 0; i < items.length - 1; i++) {
      acc += items[i].n;
      cut = i + 1;
      if (acc * 2 >= pop) break;
    }
    boxes.splice(best, 1, makeBox(items.slice(0, cut)), makeBox(items.slice(cut)));
  }
  return boxes.map(b => meanOf(b.items));
}

/** Up to `count` representative colours of the given pixel buffers (fully transparent pixels ignored).
 * Exact distinct colours (first-appearance order) when they fit, otherwise median cut. */
export function paletteFromPixels(buffers: Uint32Array[], count: number, includeAlpha: boolean): string[] {
  count = Math.max(1, count | 0);
  const exact = new Map<number, number>();
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      if (v >>> 24 === 0) continue;
      const k = includeAlpha ? v : (v | 0xff000000) >>> 0;
      exact.set(k, (exact.get(k) ?? 0) + 1);
    }
  }
  if (exact.size <= count) return [...exact.keys()].map(c => toHex(c, includeAlpha));

  // Reduced-precision histogram: 5 bits RGB, 3 bits alpha; entries hold bucket means.
  const buckets = new Map<number, { n: number; s: [number, number, number, number]; }>();
  for (const [c, n] of exact) {
    const [r, g, b, a] = unpackRgba(c);
    const key = ((r >> 3) << 13) | ((g >> 3) << 8) | ((b >> 3) << 3) | (a >> 5);
    let e = buckets.get(key);
    if (!e) buckets.set(key, e = { n: 0, s: [0, 0, 0, 0] });
    e.n += n; e.s[0] += r * n; e.s[1] += g * n; e.s[2] += b * n; e.s[3] += a * n;
  }
  let entries: Entry[];
  if (buckets.size >= count) {
    entries = [...buckets.values()].map(e => ({ n: e.n, c: e.s.map(v => Math.round(v / e.n)) as Entry['c'] }));
  } else {
    entries = [...exact].map(([c, n]) => ({ n, c: unpackRgba(c) }));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of medianCut(entries, count)) {
    const h = toHex(c, includeAlpha);
    if (!seen.has(h)) { seen.add(h); out.push(h); }
  }
  return out;
}

/** Nearest palette entry index for a packed colour (weighted RGBA distance, red weight shifts with mean red) */
export function nearestIndex(palette: number[], color: number): number {
  const r = color & 255, g = (color >>> 8) & 255, b = (color >>> 16) & 255, a = color >>> 24;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    if (p === color) return i;
    const pr = p & 255, pg = (p >>> 8) & 255, pb = (p >>> 16) & 255, pa = p >>> 24;
    const rm = (r + pr) >> 1;
    const dr = r - pr, dg = g - pg, db = b - pb, da = a - pa;
    const d = ((512 + rm) * dr * dr >> 8) + 4 * dg * dg + ((767 - rm) * db * db >> 8) + 3 * da * da;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Map pixels to the nearest palette colour; optional ordered (Bayer 4x4) dithering. Transparent pixels stay transparent. */
export function remapToPalette(data: Uint32Array, w: number, h: number, palette: string[], dither: boolean): Uint32Array {
  const out = new Uint32Array(data.length);
  const pal = palette.map(fromHex);
  if (!pal.length) return out.set(data), out;
  const cache = new Map<number, number>();
  const spread = dither ? Math.max(8, Math.min(48, 256 / Math.cbrt(pal.length))) : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = data[i];
      if (v >>> 24 === 0) { out[i] = 0; continue; }
      if (dither) {
        const t = ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * spread;
        const [r, g, b, a] = unpackRgba(v);
        const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n + t)));
        v = packRgba(cl(r), cl(g), cl(b), a);
      }
      let c = cache.get(v);
      if (c === undefined) { c = pal[nearestIndex(pal, v)]; cache.set(v, c); }
      out[i] = c;
    }
  }
  return out;
}
