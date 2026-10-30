import type { LayerFX } from './DocumentModel';
import type { CelImage } from './SpriteModel';
import { blendOver, unionRect, type Rect } from './Image';

export const outlineRadii = (effect: Extract<LayerFX, { type: 'outline' }>) => ({
  inner: effect.position === 'outside' ? 0 : effect.position === 'inside' ? effect.thickness : Math.floor(effect.thickness / 2),
  outer: effect.position === 'inside' ? 0 : effect.position === 'outside' ? effect.thickness : Math.ceil(effect.thickness / 2),
});

export class LayerFXBoundsError extends RangeError {}

export function checkEffectBounds(rect: Rect): Rect {
  if (rect.w > 4096 || rect.h > 4096 || rect.w * rect.h > 16_777_216)
    throw new LayerFXBoundsError('Layer FX bounds exceed 4096 × 4096 pixels');
  return rect;
}

/** Bounds are conservative, include transparent margins, and are checked before allocation. */
export function effectBounds(rect: Rect, effects: readonly LayerFX[] = []): Rect {
  let result = checkEffectBounds(rect);
  for (const effect of effects) if (effect.enabled && effect.type !== 'opacity' && effect.color >>> 24) {
    if (effect.type === 'outline' || effect.type === 'glow' && effect.position === 'outside') {
      const outer = effect.type === 'outline' ? outlineRadii(effect).outer : effect.size;
      result = checkEffectBounds({ x: result.x - outer, y: result.y - outer, w: result.w + 2 * outer, h: result.h + 2 * outer });
    } else if (effect.type === 'shadow') {
      result = checkEffectBounds(unionRect(result, { x: result.x + effect.x - effect.size, y: result.y + effect.y - effect.size,
        w: result.w + 2 * effect.size, h: result.h + 2 * effect.size })!);
    }
  }
  return result;
}

/** Exact separable squared Euclidean transform (lower envelope of parabolas), O(n). */
function euclideanLine(input: Float32Array, output: Float32Array, n: number, sites: Int32Array, edges: Float64Array) {
  let k = 0;
  sites[0] = 0; edges[0] = -Infinity; edges[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const v = sites[k];
      s = ((input[q] + q * q) - (input[v] + v * v)) / (2 * (q - v));
      if (s > edges[k]) break;
      k--;
    } while (k >= 0);
    sites[++k] = q; edges[k] = s!; edges[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (edges[k + 1] < q) k++;
    output[q] = (q - sites[k]) ** 2 + input[sites[k]];
  }
}

/** Distance to nonzero or zero alpha. Transparent space outside the bitmap is a seed for erosion. */
function distances(data: Uint32Array, w: number, h: number, solid: boolean, join: 'round' | 'miter' | 'bevel') {
  const far = 100_000_000;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = Boolean(data[i] >>> 24) === solid ? 0 : far;
  if (join === 'round') {
    const size = Math.max(w, h) + 2, input = new Float32Array(size), output = new Float32Array(size);
    const sites = new Int32Array(size), edges = new Float64Array(size + 1);
    for (let y = 0; y < h; y++) {
      input[0] = input[w + 1] = solid ? far : 0;
      input.set(d.subarray(y * w, (y + 1) * w), 1);
      euclideanLine(input, output, w + 2, sites, edges);
      d.set(output.subarray(1, w + 1), y * w);
    }
    for (let x = 0; x < w; x++) {
      input[0] = input[h + 1] = solid ? far : 0;
      for (let y = 0; y < h; y++) input[y + 1] = d[y * w + x];
      euclideanLine(input, output, h + 2, sites, edges);
      for (let y = 0; y < h; y++) d[y * w + x] = output[y + 1];
    }
  } else {
    const diagonal = join === 'miter';
    if (!solid) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      d[y * w + x] = Math.min(d[y * w + x], x + 1, y + 1, w - x, h - y);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y) d[i] = Math.min(d[i], d[i - w] + 1,
        diagonal && x ? d[i - w - 1] + 1 : far, diagonal && x + 1 < w ? d[i - w + 1] + 1 : far);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x + 1 < w) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y + 1 < h) d[i] = Math.min(d[i], d[i + w] + 1,
        diagonal && x ? d[i + w - 1] + 1 : far, diagonal && x + 1 < w ? d[i + w + 1] + 1 : far);
    }
  }
  return d;
}

/** Binary silhouette; outside has constant RGBA, inside uses source-atop to preserve alpha. */
export function applyOutline(cel: CelImage, effect: Extract<LayerFX, { type: 'outline' }>): CelImage {
  if (!(effect.color >>> 24)) return cel;
  const { inner, outer } = outlineRadii(effect);
  const rect = effectBounds(cel, [effect]), { w, h } = rect;
  const data = new Uint32Array(w * h);
  for (let y = 0; y < cel.h; y++) data.set(cel.data.subarray(y * cel.w, (y + 1) * cel.w), (y + outer) * w + outer);
  if (inner) {
    const distance = distances(data, w, h, false, effect.join);
    const limit = effect.join === 'round' ? inner ** 2 : inner;
    const a = (effect.color >>> 24) / 255;
    for (let i = 0; i < data.length; i++) if (data[i] >>> 24 && distance[i] <= limit) {
      const pixel = data[i];
      const mix = (shift: number) => Math.round(((effect.color >>> shift) & 255) * a + ((pixel >>> shift) & 255) * (1 - a));
      data[i] = ((pixel & 0xff000000) | mix(0) | (mix(8) << 8) | (mix(16) << 16)) >>> 0;
    }
  }
  if (outer) {
    // Inside recoloring preserves alpha, so this is still the original silhouette.
    const distance = distances(data, w, h, true, effect.join);
    const limit = effect.join === 'round' ? outer ** 2 : outer;
    for (let i = 0; i < data.length; i++) if (!(data[i] >>> 24) && distance[i] <= limit) data[i] = effect.color;
  }
  return { ...rect, data, ...(cel.ext ? { ext: cel.ext } : {}) };
}

/** Source-atop color: interpolate RGB while keeping the exact source alpha. */
function atop(pixel: number, color: number, coverage = 1) {
  if (!(pixel >>> 24)) return pixel;
  const alpha = (color >>> 24) / 255 * coverage;
  const mix = (shift: number) => Math.round(((color >>> shift) & 255) * alpha + ((pixel >>> shift) & 255) * (1 - alpha));
  return ((pixel & 0xff000000) | mix(0) | (mix(8) << 8) | (mix(16) << 16)) >>> 0;
}

/** Separable zero-padded box blur of alpha, with sliding sums: O(area), independent of radius. */
function blurredAlpha(data: Uint32Array, w: number, h: number, radius: number) {
  const temp = new Float32Array(data.length), result = new Float32Array(data.length), divisor = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < Math.min(w, radius); x++) sum += data[y * w + x] >>> 24;
    for (let x = 0; x < w; x++) {
      if (x + radius < w) sum += data[y * w + x + radius] >>> 24;
      if (x - radius - 1 >= 0) sum -= data[y * w + x - radius - 1] >>> 24;
      temp[y * w + x] = sum / divisor;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(h, radius); y++) sum += temp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + radius < h) sum += temp[(y + radius) * w + x];
      if (y - radius - 1 >= 0) sum -= temp[(y - radius - 1) * w + x];
      result[y * w + x] = sum / divisor;
    }
  }
  return result;
}

/** Shared shadow/glow/overlay processors; the complete stack is preflighted by bakeCel. */
export function applyColorEffect(cel: CelImage, effect: Extract<LayerFX, { type: 'shadow' | 'glow' | 'overlay' }>): CelImage {
  if (!(effect.color >>> 24)) return cel;
  if (effect.type === 'overlay') return { ...cel, data: cel.data.map(pixel => atop(pixel, effect.color)) };
  const rect = effectBounds(cel, [effect]), { w, h } = rect;
  const data = new Uint32Array(w * h), ox = cel.x - rect.x, oy = cel.y - rect.y;
  for (let y = 0; y < cel.h; y++) data.set(cel.data.subarray(y * cel.w, (y + 1) * cel.w), (y + oy) * w + ox);
  if (effect.type === 'shadow') {
    const shifted = new Uint32Array(w * h);
    for (let y = 0; y < cel.h; y++) shifted.set(cel.data.subarray(y * cel.w, (y + 1) * cel.w), (y + oy + effect.y) * w + ox + effect.x);
    const alpha = blurredAlpha(shifted, w, h, effect.size);
    for (let i = 0; i < data.length; i++) {
      const a = Math.round(alpha[i] * (effect.color >>> 24) / 255);
      data[i] = blendOver(((effect.color & 0xffffff) | (a << 24)) >>> 0, data[i]);
    }
  } else {
    const inner = effect.position === 'inside';
    const distance = distances(data, w, h, !inner, 'round');
    for (let i = 0; i < data.length; i++) {
      const d = Math.sqrt(distance[i]);
      if (d > effect.size) continue;
      // At the edge d=1; the outermost ring still has 1/size coverage.
      const coverage = (effect.size + 1 - d) / effect.size;
      if (inner) data[i] = atop(data[i], effect.color, coverage);
      else {
        const a = Math.round((effect.color >>> 24) * Math.min(1, coverage));
        data[i] = blendOver(((effect.color & 0xffffff) | (a << 24)) >>> 0, data[i]);
      }
    }
  }
  return { ...rect, data, ...(cel.ext ? { ext: cel.ext } : {}) };
}
