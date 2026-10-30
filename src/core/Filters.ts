import { alphaLockedPixel } from './SpriteModel';
/** Image filters over packed 0xAABBGGRR buffers. Every filter returns a new buffer. */

import { packRgba, unpackRgba } from "~/core/Image";
import type { Mask } from "~/core/Mask";

export type Channels = { r: boolean; g: boolean; b: boolean; a: boolean; };

export type FilterTarget = {
  w: number;
  h: number;
  data: Uint32Array;
  mask?: Mask | null;
  tiledX?: boolean;
  tiledY?: boolean;
  /** keep source alpha and silhouette (background or Lock Alpha layers) */
  lockAlpha?: boolean;
};

export type Kernel = {
  name: string;
  w: number;
  h: number;
  cx: number;
  cy: number;
  values: number[];
  divisor?: number | 'auto';
  bias?: number | 'auto';
  channels?: Channels;
};

export const ALL_CHANNELS: Channels = { r: true, g: true, b: true, a: true };

const k3 = (name: string, values: number[], divisor?: number | 'auto', bias?: number | 'auto'): Kernel =>
  ({ name, w: 3, h: 3, cx: 1, cy: 1, values, divisor, bias });

export const KERNEL_PRESETS: Kernel[] = [
  k3('Box blur 3x3', [1, 1, 1, 1, 1, 1, 1, 1, 1]),
  { name: 'Box blur 5x5', w: 5, h: 5, cx: 2, cy: 2, values: new Array(25).fill(1) },
  k3('Gaussian 3x3', [1, 2, 1, 2, 4, 2, 1, 2, 1]),
  {
    name: 'Gaussian 5x5', w: 5, h: 5, cx: 2, cy: 2, values: [
      1, 4, 6, 4, 1,
      4, 16, 24, 16, 4,
      6, 24, 36, 24, 6,
      4, 16, 24, 16, 4,
      1, 4, 6, 4, 1,
    ],
  },
  k3('Sharpen', [0, -1, 0, -1, 5, -1, 0, -1, 0]),
  k3('Sharpen more', [-1, -1, -1, -1, 9, -1, -1, -1, -1]),
  k3('Edge detect', [0, -1, 0, -1, 4, -1, 0, -1, 0], 1, 0),
  k3('Emboss', [-2, -1, 0, -1, 1, 1, 0, 1, 2]),
  { name: 'Motion blur horizontal', w: 5, h: 1, cx: 2, cy: 0, values: [1, 1, 1, 1, 1] },
  { name: 'Motion blur vertical', w: 1, h: 5, cx: 0, cy: 2, values: [1, 1, 1, 1, 1] },
  k3('Outline', [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0),
];

/** Resolve a neighbour coordinate: wrap when tiled, otherwise clamp to the edge */
function sampler(t: FilterTarget) {
  const { w, h } = t;
  const sx = (x: number) => t.tiledX ? ((x % w) + w) % w : x < 0 ? 0 : x >= w ? w - 1 : x;
  const sy = (y: number) => t.tiledY ? ((y % h) + h) % h : y < 0 ? 0 : y >= h ? h - 1 : y;
  return (x: number, y: number) => sy(y) * w + sx(x);
}

/** Run `fn` on every pixel inside the mask; applies lockAlpha */
function perPixel(t: FilterTarget, fn: (v: number, x: number, y: number) => number) {
  const { w, h, data, mask, lockAlpha } = t;
  const out = new Uint32Array(data);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (mask && !mask.has(x, y)) continue;
      const i = y * w + x, v = data[i];
      let n = fn(v, x, y) >>> 0;
      if (lockAlpha) n = alphaLockedPixel(v, n);
      out[i] = n;
    }
  return out;
}

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

/** Merge per-channel results: untargeted channels keep their original value */
function mix(v: number, r: number, g: number, b: number, a: number, ch: Channels) {
  const [or, og, ob, oa] = unpackRgba(v);
  return packRgba(ch.r ? r : or, ch.g ? g : og, ch.b ? b : ob, ch.a ? a : oa);
}

export function convolve(t: FilterTarget, k: Kernel, ch: Channels): Uint32Array {
  const at = sampler(t);
  const { data } = t;
  const sum = k.values.reduce((s, v) => s + v, 0);
  let divisor = typeof k.divisor === 'number' ? k.divisor : sum > 0 ? sum : sum === 0 ? 1 : -sum;
  if (divisor === 0) divisor = 1;
  const bias = typeof k.bias === 'number' ? k.bias : sum > 0 ? 0 : sum === 0 ? 128 : 255;
  return perPixel(t, (v, x, y) => {
    let r = 0, g = 0, b = 0, a = 0, cdiv = divisor;
    for (let j = 0; j < k.h; j++)
      for (let i = 0; i < k.w; i++) {
        const wt = k.values[j * k.w + i];
        if (!wt) continue;
        const p = data[at(x + i - k.cx, y + j - k.cy)];
        const pa = p >>> 24;
        a += pa * wt;
        if (pa === 0) { cdiv -= wt; continue; }
        r += (p & 255) * wt;
        g += ((p >>> 8) & 255) * wt;
        b += ((p >>> 16) & 255) * wt;
      }
    const na = clamp(a / divisor + bias);
    if (cdiv === 0) return mix(v, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, na, ch);
    return mix(v, clamp(r / cdiv + bias), clamp(g / cdiv + bias), clamp(b / cdiv + bias), na, ch);
  });
}

/** Per-channel median over a w×h window centred on each pixel */
export function median(t: FilterTarget, w: number, h: number, ch: Channels): Uint32Array {
  const at = sampler(t);
  const { data } = t;
  const n = w * h, ox = Math.floor((w - 1) / 2), oy = Math.floor((h - 1) / 2);
  const bufs = [0, 1, 2, 3].map(() => new Uint8Array(n));
  const mid = n >> 1;
  return perPixel(t, (v, x, y) => {
    let c = 0;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++, c++) {
        const p = data[at(x + i - ox, y + j - oy)];
        bufs[0][c] = p & 255;
        bufs[1][c] = (p >>> 8) & 255;
        bufs[2][c] = (p >>> 16) & 255;
        bufs[3][c] = p >>> 24;
      }
    const m = bufs.map(bf => bf.sort()[mid]);
    return mix(v, m[0], m[1], m[2], m[3], ch);
  });
}

/** Build a 256-entry LUT from control points (sorted by x), linear between, flat beyond ends */
export function curveLut(points: [number, number][]): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  for (let i = 0; i < 256; i++) {
    let v: number;
    if (i <= pts[0][0]) v = pts[0][1];
    else if (i >= pts[pts.length - 1][0]) v = pts[pts.length - 1][1];
    else {
      let s = 0;
      while (pts[s + 1][0] < i) s++;
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
      v = x1 === x0 ? y1 : y0 + (y1 - y0) * (i - x0) / (x1 - x0);
    }
    lut[i] = clamp(v);
  }
  return lut;
}

export function applyCurve(t: FilterTarget, lut: Uint8Array, ch: Channels): Uint32Array {
  return perPixel(t, v => {
    const [r, g, b, a] = unpackRgba(v);
    return mix(v, lut[r], lut[g], lut[b], lut[a], ch);
  });
}

export function invert(t: FilterTarget, ch: Channels): Uint32Array {
  return perPixel(t, v => {
    const [r, g, b, a] = unpackRgba(v);
    return mix(v, 255 - r, 255 - g, 255 - b, 255 - a, ch);
  });
}

/** Replace colours within a per-channel box tolerance of `from` (only targeted channels compared/replaced) */
export function replaceColor(t: FilterTarget, from: number, to: number, tolerance: number, ch: Channels): Uint32Array {
  const f = unpackRgba(from), n = unpackRgba(to);
  const on = [ch.r, ch.g, ch.b, ch.a];
  return perPixel(t, v => {
    const c = unpackRgba(v);
    for (let i = 0; i < 4; i++)
      if (on[i] && Math.abs(c[i] - f[i]) > tolerance) return v;
    return mix(v, n[0], n[1], n[2], n[3], ch);
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [clamp((r + m) * 255), clamp((g + m) * 255), clamp((b + m) * 255)];
}

/** Hue rotate (degrees), saturation scale and lightness push (-100..100). Alpha kept, transparent skipped */
export function adjustHsl(t: FilterTarget, hue: number, sat: number, light: number): Uint32Array {
  const sk = 1 + sat / 100, lk = light / 100;
  return perPixel(t, v => {
    const [r, g, b, a] = unpackRgba(v);
    if (a === 0) return v;
    let [hh, s, l] = rgbToHsl(r, g, b);
    s = Math.min(1, Math.max(0, s * sk));
    l = lk > 0 ? l + (1 - l) * lk : l + l * lk;
    const [nr, ng, nb] = hslToRgb(hh + hue, s, l);
    return packRgba(nr, ng, nb, a);
  });
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Pixel-art outline: paints transparent pixels next to opaque ones (outside) or opaque pixels next to transparent ones (inside) */
export function outline(t: FilterTarget, color: number, opts: { outside: boolean; diagonal: boolean; }): Uint32Array {
  const at = sampler(t);
  const { data, w, h } = t;
  const dirs = opts.diagonal ? N8 : N4;
  return perPixel(t, (v, x, y) => {
    const opaque = (v >>> 24) !== 0;
    if (opaque === opts.outside) return v;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      // off-canvas counts as transparent for inside outlines when not tiled
      const off = (!t.tiledX && (nx < 0 || nx >= w)) || (!t.tiledY && (ny < 0 || ny >= h));
      const nOpaque = off ? false : (data[at(nx, ny)] >>> 24) !== 0;
      if (nOpaque !== opaque) return color;
    }
    return v;
  });
}

/** Shadow of opaque pixels offset by (dx, dy), drawn only where the destination is transparent */
export function dropShadow(t: FilterTarget, dx: number, dy: number, color: number): Uint32Array {
  const { data, w, h } = t;
  return perPixel(t, (v, x, y) => {
    if (v >>> 24) return v;
    let sx = x - dx, sy = y - dy;
    if (t.tiledX) sx = ((sx % w) + w) % w;
    else if (sx < 0 || sx >= w) return v;
    if (t.tiledY) sy = ((sy % h) + h) % h;
    else if (sy < 0 || sy >= h) return v;
    return (data[sy * w + sx] >>> 24) ? color : v;
  });
}

/** Reduce each targeted channel to `levels` evenly spaced values (2..256) */
export function posterize(t: FilterTarget, levels: number, ch: Channels): Uint32Array {
  const n = Math.max(2, Math.min(256, Math.round(levels))) - 1;
  const lut = Uint8Array.from({ length: 256 }, (_, v) => Math.round(Math.round(v / 255 * n) / n * 255));
  return applyCurve(t, lut, ch);
}

/** Brightness (-100..100) shifts values, contrast (-100..100) stretches them around the middle grey */
export function brightnessContrast(t: FilterTarget, brightness: number, contrast: number, ch: Channels): Uint32Array {
  const k = contrast >= 0 ? 1 / Math.max(0.01, 1 - contrast / 100) : 1 + contrast / 100;
  const shift = brightness / 100 * 255;
  const lut = Uint8Array.from({ length: 256 }, (_, v) => clamp((v - 127.5) * k + 127.5 + shift));
  return applyCurve(t, lut, ch);
}

/** Small deterministic hash → 0..1, so the preview doesn't flicker between redraws */
function hash01(x: number, y: number, seed: number, c: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Random noise of `amount` (0..255); `mono` uses one offset for all colour channels. Transparent pixels skipped */
export function noise(t: FilterTarget, amount: number, mono: boolean, seed: number, ch: Channels): Uint32Array {
  return perPixel(t, (v, x, y) => {
    const [r, g, b, a] = unpackRgba(v);
    if (a === 0) return v;
    const d = (c: number) => (hash01(x, y, seed, mono ? 0 : c) * 2 - 1) * amount;
    return mix(v, clamp(r + d(0)), clamp(g + d(1)), clamp(b + d(2)), clamp(a + d(3)), ch);
  });
}

/** Blocks of `size`×`size` (aligned to the selection or the canvas) filled with the block's most common colour */
export function pixelate(t: FilterTarget, size: number): Uint32Array {
  const { w, h, data, mask } = t;
  const s = Math.max(1, Math.round(size));
  const ox = mask?.bounds?.x ?? 0, oy = mask?.bounds?.y ?? 0;
  const block = new Uint32Array(w * h);
  const counts = new Map<number, number>();
  for (let by = oy - Math.ceil(oy / s) * s; by < h; by += s)
    for (let bx = ox - Math.ceil(ox / s) * s; bx < w; bx += s) {
      counts.clear();
      let best = 0, bestN = 0;
      for (let y = Math.max(0, by); y < Math.min(h, by + s); y++)
        for (let x = Math.max(0, bx); x < Math.min(w, bx + s); x++) {
          if (mask && !mask.has(x, y)) continue;
          const v = data[y * w + x], n = (counts.get(v) ?? 0) + 1;
          counts.set(v, n);
          if (n > bestN) { bestN = n; best = v; }
        }
      for (let y = Math.max(0, by); y < Math.min(h, by + s); y++)
        for (let x = Math.max(0, bx); x < Math.min(w, bx + s); x++) block[y * w + x] = best;
    }
  return perPixel(t, (_, x, y) => block[y * w + x]);
}

/** Shift by (dx, dy) with pixels leaving one edge coming back on the opposite one.
 *  With a selection, the wrap happens inside the selection's bounding box (only selected pixels change). */
export function offsetWrap(t: FilterTarget, dx: number, dy: number): Uint32Array {
  const { w, data, mask } = t;
  const r = mask?.bounds ?? { x: 0, y: 0, w, h: t.h };
  const m = (v: number, n: number) => ((v % n) + n) % n;
  return perPixel(t, (v, x, y) => {
    const sx = r.x + m(x - r.x - dx, r.w), sy = r.y + m(y - r.y - dy, r.h);
    return data[sy * w + sx];
  });
}
