/**
 * Color modes. Pixels are always stored as RGBA; an indexed or grayscale sprite keeps every
 * pixel on the palette / on gray, so tools, filters and files need no special paths.
 */

import { packRgba, unpackRgba } from "~/core/Image";

export type ColorMode = 'rgb' | 'indexed' | 'gray';
export type Dither = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'diffusion' | 'atkinson';

/** Luma used for grayscale (Rec. 709 weights) */
export function grayOf(v: number) {
  const [r, g, b, a] = unpackRgba(v);
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return packRgba(y, y, y, a);
}

/** Nearest palette color by weighted RGB distance (green matters most), cached per color */
export class PaletteMap {
  private cache = new Map<number, number>();
  private rgb: [number, number, number][];

  /** `transparent`: entry never chosen for opaque pixels; its exact color maps to transparency */
  constructor(public colors: number[], public transparent = -1) {
    this.rgb = colors.map(c => unpackRgba(c).slice(0, 3) as [number, number, number]);
  }

  index(v: number): number {
    const key = v | 0xff000000;
    let i = this.cache.get(key);
    if (i !== undefined) return i;
    const [r, g, b] = unpackRgba(v);
    let best = 0, bd = Infinity;
    for (let k = 0; k < this.rgb.length; k++) {
      if (k === this.transparent && this.rgb.length > 1) continue;
      const [pr, pg, pb] = this.rgb[k];
      const d = 3 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 2 * (b - pb) ** 2;
      if (d < bd) { bd = d; best = k; if (!d) break; }
    }
    this.cache.set(key, best);
    return best;
  }

  private pairs = new Map<number, number>();

  /**
   * The two palette colors whose mix comes closest to `v`, and how far along from the first to the second it lies:
   * the second is tried among all entries, so mixes across non-neighbouring colors are found too. Packed as a*2^17 + b*2^9 + t (0..256).
   */
  pair(v: number): [number, number, number] {
    const key = v | 0xff000000;
    let k = this.pairs.get(key);
    if (k === undefined) {
      const [r, g, b] = unpackRgba(v);
      const a = this.index(v), [ar, ag, ab] = this.rgb[a];
      let best = a, bt = 0, bd = 3 * (r - ar) ** 2 + 4 * (g - ag) ** 2 + 2 * (b - ab) ** 2;
      for (let q = 0; q < this.rgb.length && bd > 0; q++) {
        if (q === a || q === this.transparent) continue;
        const [qr, qg, qb] = this.rgb[q];
        const dr = qr - ar, dg = qg - ag, db = qb - ab;
        const len = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
        if (!len) continue;
        // Projection of the source onto the segment between the two colors
        const t = Math.max(0, Math.min(1, (3 * (r - ar) * dr + 4 * (g - ag) * dg + 2 * (b - ab) * db) / len));
        if (t <= 0) continue;
        // A small cost for wide mixes keeps the pattern calm where a near color would do
        const d = 3 * (r - ar - t * dr) ** 2 + 4 * (g - ag - t * dg) ** 2 + 2 * (b - ab - t * db) ** 2 + len * t * (1 - t) * 0.1;
        if (d < bd) { bd = d; best = q; bt = t; }
      }
      k = a * 131072 + best * 512 + Math.round(bt * 256);
      this.pairs.set(key, k);
    }
    return [Math.floor(k / 131072), Math.floor(k / 512) % 256, (k % 512) / 256];
  }

  /** Palette color for `v`; alpha snaps to fully opaque or fully transparent */
  map(v: number) {
    if ((v >>> 24) < 128 || !this.colors.length) return 0;
    if (this.transparent >= 0 && (v | 0xff000000) === (this.colors[this.transparent] | 0xff000000)) return 0;
    return this.colors[this.index(v)] | 0xff000000;
  }
}

function bayer(n: number): number[] {
  if (n <= 1) return [0];
  const half = bayer(n / 2), h = n / 2, out = new Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const q = [0, 2, 3, 1][(y < h ? 0 : 2) + ((x < h) === (y < h) ? 0 : 1)];
      out[y * n + x] = 4 * half[(y % h) * h + (x % h)] + q;
    }
  return out;
}

/**
 * Converts pixels in place. `x0, y0` place the buffer in sprite space so ordered patterns
 * line up across cels. Transparent pixels never pass error to their neighbours.
 */
export function convertPixels(data: Uint32Array, w: number, h: number, mode: ColorMode, pal: PaletteMap | null, dither: Dither = 'none', amount = 1, x0 = 0, y0 = 0) {
  if (mode === 'rgb') return;
  if (mode === 'gray') {
    for (let i = 0; i < data.length; i++) data[i] = grayOf(data[i]);
    return;
  }
  if (!pal) return;
  if (dither === 'none') {
    for (let i = 0; i < data.length; i++) data[i] = pal.map(data[i]);
    return;
  }
  if (dither === 'diffusion' || dither === 'atkinson') {
    // Error diffusion over three rolling rows, serpentine so the error does not drift to one side.
    // Floyd–Steinberg passes on all of the error; Atkinson only 3/4 of it, which keeps flat areas clean.
    const fs = dither === 'diffusion';
    const taps: [number, number, number][] = fs
      ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
      : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
    const stride = (w + 4) * 3;
    const rows = [new Float32Array(stride), new Float32Array(stride), new Float32Array(stride)];
    for (let y = 0; y < h; y++) {
      const back = y & 1;
      for (let k = 0; k < w; k++) {
        const x = back ? w - 1 - k : k, dir = back ? -1 : 1;
        const i = y * w + x, v = data[i];
        const e = (x + 2) * 3;
        if ((v >>> 24) < 128) { data[i] = 0; continue; }
        const [r, g, b] = unpackRgba(v), cur = rows[0];
        const want = [r + cur[e], g + cur[e + 1], b + cur[e + 2]].map(c => Math.max(0, Math.min(255, c)));
        const out = pal.map(packRgba(Math.round(want[0]), Math.round(want[1]), Math.round(want[2]), 255));
        data[i] = out;
        const got = unpackRgba(out);
        for (let c = 0; c < 3; c++) {
          const err = (want[c] - got[c]) * amount;
          if (!err) continue;
          for (const [dx, dy, wgt] of taps) {
            const nx = x + dx * dir;
            // Error never flows into transparent pixels or off the edge
            if (nx < 0 || nx >= w || y + dy >= h || (data[(y + dy) * w + nx] >>> 24) < 128) continue;
            rows[dy][(nx + 2) * 3 + c] += err * wgt;
          }
        }
      }
      const done = rows.shift()!;
      done.fill(0);
      rows.push(done);
    }
    return;
  }
  // Ordered: each pixel picks between the two palette colors that mix closest to it, by a threshold pattern
  const n = dither === 'bayer2' ? 2 : dither === 'bayer4' ? 4 : 8;
  const m = bayer(n), levels = n * n;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = data[i];
      if ((v >>> 24) < 128) { data[i] = 0; continue; }
      if (pal.transparent >= 0 && (v | 0xff000000) === (pal.colors[pal.transparent] | 0xff000000)) { data[i] = 0; continue; }
      const [a, b, t] = pal.pair(v);
      const th = 0.5 + ((m[((y + y0) % n + n) % n * n + ((x + x0) % n + n) % n] + 0.5) / levels - 0.5) * amount;
      data[i] = pal.colors[t > th ? b : a] | 0xff000000;
    }
}
