/**
 * Color modes. Pixels are always stored as RGBA; an indexed or grayscale sprite keeps every
 * pixel on the palette / on gray, so tools, filters and files need no special paths.
 */

import { packRgba, unpackRgba } from "~/core/Image";

export type ColorMode = 'rgb' | 'indexed' | 'gray';
export type Dither = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'diffusion';

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
  if (dither === 'diffusion') {
    // Floyd–Steinberg over two rolling error rows
    let cur = new Float32Array((w + 2) * 3), next = new Float32Array((w + 2) * 3);
    for (let y = 0; y < h; y++) {
      next.fill(0);
      for (let x = 0; x < w; x++) {
        const i = y * w + x, v = data[i];
        if ((v >>> 24) < 128) { data[i] = 0; continue; }
        const [r, g, b] = unpackRgba(v);
        const e = (x + 1) * 3;
        const want = [r + cur[e], g + cur[e + 1], b + cur[e + 2]].map(c => Math.max(0, Math.min(255, c)));
        const out = pal.map(packRgba(Math.round(want[0]), Math.round(want[1]), Math.round(want[2]), 255));
        data[i] = out;
        const got = unpackRgba(out);
        for (let c = 0; c < 3; c++) {
          const err = (want[c] - got[c]) * amount;
          cur[e + 3 + c] += err * 7 / 16;
          next[e - 3 + c] += err * 3 / 16;
          next[e + c] += err * 5 / 16;
          next[e + 3 + c] += err / 16;
        }
      }
      [cur, next] = [next, cur];
    }
    return;
  }
  // Ordered: mix the nearest color with the nearest color "on the other side" of the source
  const n = dither === 'bayer2' ? 2 : dither === 'bayer4' ? 4 : 8;
  const m = bayer(n), levels = n * n;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = data[i];
      if ((v >>> 24) < 128) { data[i] = 0; continue; }
      const a = pal.map(v);
      const [r, g, b] = unpackRgba(v), [ar, ag, ab] = unpackRgba(a);
      const mirror = packRgba(
        Math.max(0, Math.min(255, 2 * r - ar)), Math.max(0, Math.min(255, 2 * g - ag)), Math.max(0, Math.min(255, 2 * b - ab)), 255);
      const bcol = pal.map(mirror);
      if (bcol === a) { data[i] = a; continue; }
      const [br, bg, bb] = unpackRgba(bcol);
      const dist = (p: number, q: number, s: number) => Math.hypot(p, q, s);
      const t = dist(r - ar, g - ag, b - ab) / Math.max(1, dist(br - ar, bg - ag, bb - ab));
      const th = (m[((y + y0) % n + n) % n * n + ((x + x0) % n + n) % n] + 0.5) / levels;
      data[i] = t > th ? bcol : a;
    }
}
