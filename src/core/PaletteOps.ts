import { Color } from "~/core/Color";
import { paletteFromPixels } from "~/core/Quantize";
import { paletteInBackground } from "~/core/Work";
import { setPaletteKeepingPixels, state } from "~/core/State";
import { Mask } from "~/core/Mask";
import { packRgba } from "~/core/Image";
import { PaletteMap } from "~/core/ColorMode";
import { signal, effect } from "@preact/signals-react";

export type SortKey = 'hue' | 'saturation' | 'lightness' | 'luminance' | 'red' | 'green' | 'blue' | 'alpha';

function key(hex: string, k: SortKey) {
  const c = Color.fromHex(hex);
  const [r, g, b, a] = c.rgba;
  const [h, s, l] = c.hsl;
  switch (k) {
    case 'hue': return h;
    case 'saturation': return s;
    case 'lightness': return l;
    case 'luminance': return r * 0.2126 + g * 0.7152 + b * 0.0722;
    case 'red': return r;
    case 'green': return g;
    case 'blue': return b;
    case 'alpha': return a;
  }
}

/** Indices an operation applies to: the palette selection, or everything */
function targets() {
  const sel = state.paletteSelection.filter(i => i < state.palette.length);
  return sel.length > 1 ? sel.slice().sort((a, b) => a - b) : state.palette.map((_, i) => i);
}

/** Stable sort of the selected entries, written back into the same slots */
export function sortPalette(by: SortKey, descending = false) {
  const idx = targets();
  const colors = idx.map(i => state.palette[i]);
  const sorted = colors
    .map((c, i) => ({ c, i, k: key(c, by) }))
    .sort((a, b) => (a.k - b.k) * (descending ? -1 : 1) || a.i - b.i)
    .map(e => e.c);
  const pal = state.palette.slice();
  idx.forEach((i, n) => pal[i] = sorted[n]);
  setPaletteKeepingPixels(pal);
}

export function reversePalette() {
  const idx = targets();
  const colors = idx.map(i => state.palette[i]).reverse();
  const pal = state.palette.slice();
  idx.forEach((i, n) => pal[i] = colors[n]);
  setPaletteKeepingPixels(pal);
}

/** Fills the entries between the first and last selected one with a blend of the two */
export function gradientPalette(space: RampSpace = 'rgb') {
  const sel = state.paletteSelection.slice().sort((a, b) => a - b);
  if (sel.length < 2) return false;
  const a = sel[0], b = sel[sel.length - 1];
  if (b - a < 2) return false;
  const pal = state.palette.slice();
  for (let i = a + 1; i < b; i++) pal[i] = mixHex(state.palette[a], state.palette[b], (i - a) / (b - a), space);
  state.palette = pal;
  state.paletteSelection = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return true;
}

export function removeFromPalette(indices = state.paletteSelection) {
  const drop = new Set(indices);
  if (drop.size >= state.palette.length) return;
  const before = state.palette;
  const after = before.filter((_, i) => !drop.has(i));
  state.palette = after;
  state.paletteSelection = [];
  // Indexed sprites: pixels that used a removed entry move to the nearest remaining one
  const { sprite } = state;
  if (sprite.colorMode !== 'indexed') return;
  const keep = new Set(after.map(h => hexPixel(h)));
  const map = new PaletteMap(after.map(hexPixel), sprite.transparentIndex < after.length ? sprite.transparentIndex : -1);
  const changes = new Map<number, number>();
  for (const i of drop) {
    const v = hexPixel(before[i]);
    if (!keep.has(v)) changes.set(v, map.map(v));
  }
  sprite.recolor(changes);
}

/** Moves (or copies) the selected entries as one block before index `before` */
export function moveInPalette(indices: number[], before: number, copy: boolean) {
  const sel = indices.slice().sort((a, b) => a - b);
  const block = sel.map(i => state.palette[i]);
  let pal = state.palette.slice();
  let at = before;
  if (!copy) {
    pal = pal.filter((_, i) => !sel.includes(i));
    at -= sel.filter(i => i < before).length;
  }
  at = Math.max(0, Math.min(pal.length, at));
  pal.splice(at, 0, ...block);
  if (copy) state.palette = pal;
  else setPaletteKeepingPixels(pal);
  state.paletteSelection = block.map((_, k) => at + k);
}

export function setPaletteSize(size: number) {
  size = Math.max(1, Math.min(1024, size | 0));
  const pal = state.palette.slice(0, size);
  while (pal.length < size) pal.push('#000000');
  state.palette = pal;
  state.paletteSelection = state.paletteSelection.filter(i => i < size);
}

/** Palette built from the colors used in every frame of the sprite */
export function paletteFromSprite(count: number, includeAlpha: boolean) {
  const { sprite } = state;
  const buffers = sprite.frames.map((_, f) => {
    const ctx = sprite.render(f).getContext('2d')!;
    return new Uint32Array(ctx.getImageData(0, 0, sprite.width, sprite.height).data.buffer);
  });
  return paletteFromPixels(buffers, count, includeAlpha);
}

/** paletteFromSprite with the color analysis in the background (rejects with `Cancelled` on cancel) */
export function paletteFromSpriteAsync(count: number, includeAlpha: boolean) {
  const { sprite } = state;
  const buffers = sprite.frames.map((_, f) => {
    const ctx = sprite.render(f).getContext('2d')!;
    return new Uint32Array(ctx.getImageData(0, 0, sprite.width, sprite.height).data.buffer);
  });
  return paletteInBackground(buffers, count, includeAlpha);
}

export function inPalette(color: Color) {
  const hex = color.toHexString(false);
  return state.palette.some(p => p.slice(0, 7).toLowerCase() === hex.toLowerCase());
}

/** '#rrggbb[aa]' → packed opaque pixel */
function hexPixel(hex: string) {
  const [r, g, b] = Color.fromHex(hex).rgba;
  return packRgba(r, g, b, 255);
}

export type RampSpace = 'rgb' | 'hsv' | 'oklab';

const toLin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * Math.max(0, c) : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB → OKLab (published matrices of the OKLab model) */
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max / 255];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

/** Blend of two palette colors at `t` (0..1) in the given space; alpha is mixed linearly */
export function mixHex(from: string, to: string, t: number, space: RampSpace = 'rgb') {
  const [r1, g1, b1, a1] = Color.fromHex(from).rgba, [r2, g2, b2, a2] = Color.fromHex(to).rgba;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let rgb: [number, number, number];
  if (space === 'hsv') {
    let [h1, s1, v1] = rgbToHsv(r1, g1, b1), [h2, s2, v2] = rgbToHsv(r2, g2, b2);
    // Grays have no hue: borrow the other end's so the ramp doesn't swing through the wheel
    if (!s1) h1 = h2;
    if (!s2) h2 = h1;
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    rgb = hsvToRgb((h1 + dh * t + 360) % 360, lerp(s1, s2), lerp(v1, v2));
  } else if (space === 'oklab') {
    const p = rgbToOklab(r1, g1, b1), q = rgbToOklab(r2, g2, b2);
    rgb = oklabToRgb(lerp(p[0], q[0]), lerp(p[1], q[1]), lerp(p[2], q[2]));
  } else rgb = [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)];
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return Color.fromRgb(c(rgb[0]), c(rgb[1]), c(rgb[2]), lerp(a1, a2)).toHexString();
}

/** `steps` in-between colors of entries `a` and `b`, inserted right after the lower one */
export function insertRamp(a: number, b: number, steps: number, space: RampSpace) {
  const pal = state.palette;
  if (pal[a] === undefined || pal[b] === undefined || a === b || steps < 1) return false;
  const lo = Math.min(a, b);
  const [from, to] = a < b ? [pal[a], pal[b]] : [pal[b], pal[a]];
  const ramp = Array.from({ length: steps }, (_, k) => mixHex(from, to, (k + 1) / (steps + 1), space));
  const next = pal.slice();
  next.splice(lo + 1, 0, ...ramp);
  state.palette = next;
  state.paletteSelection = Array.from({ length: steps }, (_, k) => lo + 1 + k);
  return true;
}

/** Drops repeated entries (same RGB and alpha), the first occurrence stays */
export function removeDuplicates() {
  const seen = new Set<string>();
  const pal = state.palette.filter(h => {
    const k = Color.fromHex(h).toHexString().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const removed = state.palette.length - pal.length;
  if (removed) { setPaletteKeepingPixels(pal); state.paletteSelection = []; }
  return removed;
}

/** Opaque colors present in any cel of the sprite */
export function usedColors() {
  const used = new Set<number>();
  for (const l of state.sprite.layers)
    for (const c of l.cels) {
      if (!c) continue;
      const d = c.data;
      for (let i = 0; i < d.length; i++) if (d[i] >>> 24) used.add((d[i] | 0xff000000) >>> 0);
    }
  return used;
}

/** Drops entries no pixel uses (at least one entry stays) */
export function removeUnused() {
  const used = usedColors();
  const ti = state.sprite.colorMode === 'indexed' ? state.sprite.transparentIndex : -1;
  const pal = state.palette.filter((h, i) => i === ti || used.has(hexPixel(h) >>> 0));
  const removed = state.palette.length - pal.length;
  if (removed && pal.length) { setPaletteKeepingPixels(pal); state.paletteSelection = []; }
  return pal.length ? removed : 0;
}

/** Selects the pixels of the current cel that have the color of a palette entry */
export function selectPixelsOf(hex: string) {
  const sprite = state.sprite;
  const v = hexPixel(hex) >>> 0;
  const cel = sprite.getBitmap().data;
  const w = sprite.width;
  sprite.setMask(Mask.fromFn(w, sprite.height, (x, y) => {
    const p = cel[y * w + x];
    return (p >>> 24) > 0 && ((p | 0xff000000) >>> 0) === v;
  }), 'Select color');
}

/** Indexed mode: which entry stands for transparency (-1 = none) */
export function setTransparentIndex(i: number) {
  const { sprite } = state;
  sprite.transparentIndex = i;
  sprite.palette = new PaletteMap(state.palette.map(hexPixel), i);
  sprite.touch();
}

/** Recently used primary colors, newest first */
export const recentColors = signal<string[]>((() => {
  try { return JSON.parse(localStorage.getItem('pixprite:recentColors') ?? '[]') as string[]; } catch { return []; }
})());

let recentTimer = 0;
effect(() => {
  const hex = state.colorA.toHexString();
  // Wait for the color to settle (picker drags)
  clearTimeout(recentTimer);
  recentTimer = window.setTimeout(() => {
    const list = [hex, ...recentColors.peek().filter(h => h.toLowerCase() !== hex.toLowerCase())].slice(0, 16);
    recentColors.value = list;
    try { localStorage.setItem('pixprite:recentColors', JSON.stringify(list)); } catch { /* storage off */ }
  }, 700);
});

/** Pixels of an image file, for building a palette from it */
export async function imageFilePixels(file: File) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return new Uint32Array(ctx.getImageData(0, 0, cv.width, cv.height).data.buffer);
}

export function paletteFromImage(data: Uint32Array, count: number, includeAlpha: boolean) {
  return paletteFromPixels([data], count, includeAlpha);
}

