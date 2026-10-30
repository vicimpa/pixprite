import type { Bitmap } from './Image';
import type { Cel, CelImage, ExtData, Layer } from './SpriteModel';
import { applyColorEffect, applyOutline, effectBounds } from './LayerEffects';

/** An immutable shared pixel resource. Its public data view is a defensive copy. */
export type Image = Readonly<{ kind: 'image'; id: string; w: number; h: number; data: Uint32Array }>;
/** One static transparency channel in sprite coordinates, shared by all frames. Only alpha is sampled. */
export type LayerMask = Readonly<{ image: Image; x: number; y: number; outside: number; enabled: boolean; inverted: boolean }>;
export type AssetRef<Kind extends string = 'image'> = Readonly<{ kind: Kind; id: string }>;
export type CelTransform = { flipX: boolean; flipY: boolean; rotation: 0 | 90 | 180 | 270; opacity: number };
export type CelInstance = CelImage & {
  readonly image: Image;
  readonly asset: AssetRef;
  readonly transform: Readonly<CelTransform>;
};
/** Ordered pixel processors; every new discriminant must be validated before decoding. */
export type LayerFX = Readonly<{ id: string; enabled: boolean } & (
  { type: 'opacity'; amount: number } |
  { type: 'shadow'; color: number; x: number; y: number; size: number } |
  { type: 'glow'; color: number; size: number; position: 'inside' | 'outside' } |
  { type: 'overlay'; color: number } |
  { type: 'outline'; color: number; thickness: number; position: 'inside' | 'center' | 'outside'; join: 'round' | 'miter' | 'bevel' }
)>;

const sourcePixels = new WeakMap<Image, Uint32Array>();
const bufferIdentities = new WeakMap<object, object>();
const instances = new WeakMap<CelImage, { image: Image; transform: CelTransform; bitmap?: Bitmap }>();
const legacyImages = new WeakMap<Uint32Array, Map<string, Image>>();
const defaults = (): CelTransform => ({ flipX: false, flipY: false, rotation: 0, opacity: 1 });
const equalPixels = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((value, i) => value === b[i]);
let fallbackId = 0;

export function createImage(w: number, h: number, data: Uint32Array, id = `image:${globalThis.crypto?.randomUUID?.() ?? ++fallbackId}`): Image {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096 || data.length !== w * h)
    throw new Error('Invalid image dimensions or pixel buffer');
  if (typeof id !== 'string' || !id || id.length > 256) throw new Error('Invalid image resource ID');
  const pixels = data.slice();
  const image: Image = Object.freeze({ kind: 'image', id, w, h, get data() { return pixels.slice(); } });
  sourcePixels.set(image, pixels);
  return image;
}

export function validateCelTransform(transform: Partial<CelTransform>) {
  if (transform.flipX !== undefined && typeof transform.flipX !== 'boolean') throw new Error('Invalid cel reflection');
  if (transform.flipY !== undefined && typeof transform.flipY !== 'boolean') throw new Error('Invalid cel reflection');
  if (transform.rotation !== undefined && ![0, 90, 180, 270].includes(transform.rotation)) throw new Error('Invalid cel rotation');
  if (transform.opacity !== undefined && (!Number.isFinite(transform.opacity) || transform.opacity < 0 || transform.opacity > 1))
    throw new Error('Invalid instance opacity');
}

function rendered(image: Image, transform: CelTransform): Bitmap {
  const data = sourcePixels.get(image) ?? image.data;
  const quarter = transform.rotation === 90 || transform.rotation === 270;
  const w = quarter ? image.h : image.w, h = quarter ? image.w : image.h;
  const result = new Uint32Array(w * h);
  for (let y = 0; y < image.h; y++) for (let x = 0; x < image.w; x++) {
    const fx = transform.flipX ? image.w - 1 - x : x;
    const fy = transform.flipY ? image.h - 1 - y : y;
    const [dx, dy] = transform.rotation === 90 ? [image.h - 1 - fy, fx]
      : transform.rotation === 180 ? [image.w - 1 - fx, image.h - 1 - fy]
      : transform.rotation === 270 ? [fy, image.w - 1 - fx] : [fx, fy];
    const pixel = data[y * image.w + x];
    const alpha = Math.round((pixel >>> 24) * transform.opacity);
    result[dy * w + dx] = transform.opacity === 1 ? pixel : alpha ? ((pixel & 0xffffff) | (alpha << 24)) >>> 0 : 0;
  }
  return { w, h, data: result };
}

/** Detect legacy in-place writes to the instance's private bitmap before retaining its source reference. */
function reconcile(cel: CelImage) {
  const state = instances.get(cel)!;
  if (state.bitmap) {
    const identity = !state.transform.flipX && !state.transform.flipY && !state.transform.rotation && state.transform.opacity === 1;
    const expected = identity ? sourcePixels.get(state.image) ?? state.image.data : rendered(state.image, state.transform).data;
    if (!equalPixels(state.bitmap.data, expected)) {
      state.image = createImage(state.bitmap.w, state.bitmap.h, state.bitmap.data);
      state.transform = defaults();
    }
  }
  return state;
}

/** Bitmap accessors keep existing tools compatible; spreads intentionally produce independent baked cels. */
export function createCelInstance(image: Image, options: Partial<CelTransform> & { x?: number; y?: number; ext?: ExtData } = {}): CelInstance {
  if (!sourcePixels.has(image)) throw new Error('Cel instances require an image created by createImage');
  validateCelTransform(options);
  if (!Number.isInteger(options.x ?? 0) || !Number.isInteger(options.y ?? 0)) throw new Error('Invalid cel coordinates');
  const cel = { x: options.x ?? 0, y: options.y ?? 0, ...(options.ext ? { ext: options.ext } : {}) } as CelInstance;
  const state = { image, transform: {
    flipX: options.flipX ?? false, flipY: options.flipY ?? false, rotation: options.rotation ?? 0, opacity: options.opacity ?? 1,
  }, bitmap: undefined as Bitmap | undefined };
  instances.set(cel, state);
  const bitmap = () => state.bitmap ??= rendered(state.image, state.transform);
  Object.defineProperties(cel, {
    w: { enumerable: true, get: () => state.transform.rotation % 180 ? state.image.h : state.image.w },
    h: { enumerable: true, get: () => state.transform.rotation % 180 ? state.image.w : state.image.h },
    data: { enumerable: true, get: () => bitmap().data },
    image: { get: () => reconcile(cel).image },
    asset: { get: () => ({ kind: 'image', id: reconcile(cel).image.id }) },
    transform: { get: () => Object.freeze({ ...reconcile(cel).transform }) },
  });
  return cel;
}

export function isCelInstance(cel: CelImage): cel is CelInstance { return instances.has(cel); }

/** Opaque diagnostics token: never exposes the private immutable source buffer. */
export function retainedBufferIdentity(buffer: ArrayBufferLike): object {
  let token = bufferIdentities.get(buffer);
  if (!token) {
    token = Object.freeze({});
    bufferIdentities.set(buffer, token);
  }
  return token;
}

/** Read-only diagnostics: count existing storage without materializing/reconciling a bitmap. */
export function visitCelBuffers(cel: CelImage, visit: (identity: object, bytes: number) => void, metadata?: (identity: object, bytes: number) => void) {
  const state = instances.get(cel);
  if (!state) return;
  const source = sourcePixels.get(state.image);
  if (source) visit(retainedBufferIdentity(source.buffer), source.buffer.byteLength);
  if (state.bitmap) visit(retainedBufferIdentity(state.bitmap.data.buffer), state.bitmap.data.buffer.byteLength);
  // Private fields retain these payloads even when the compatibility bitmap was never read.
  // Opaque identities prevent callers from changing the private transform or source pixels.
  if (metadata) {
    for (const value of [state.image, state.transform, state.bitmap]) if (value) {
      let identity = bufferIdentities.get(value);
      if (!identity) bufferIdentities.set(value, identity = Object.freeze({}));
      const bytes = value === state.image ? 29 + new TextEncoder().encode(state.image.id).length
        : value === state.transform ? 43 : 22;
      metadata(identity, bytes);
    }
  }
}

export function hasCelTransform(cel: CelImage) {
  if (!isCelInstance(cel)) return false;
  const transform = cel.transform;
  return transform.flipX || transform.flipY || transform.rotation !== 0 || transform.opacity !== 1;
}

/** Inverse placement for resource sampling, including tile eyedropper coordinates. */
export function sourcePoint(cel: CelImage, x: number, y: number): { x: number; y: number } | null {
  if (x < 0 || y < 0 || x >= cel.w || y >= cel.h) return null;
  if (!isCelInstance(cel)) return { x, y };
  const image = cel.image, transform = cel.transform;
  let fx = x, fy = y;
  if (transform.rotation === 90) { fx = y; fy = image.h - 1 - x; }
  if (transform.rotation === 180) { fx = image.w - 1 - x; fy = image.h - 1 - y; }
  if (transform.rotation === 270) { fx = image.w - 1 - y; fy = x; }
  return { x: transform.flipX ? image.w - 1 - fx : fx, y: transform.flipY ? image.h - 1 - fy : fy };
}

/** Legacy plain bitmap objects remain accepted and share resources when they share a pixel buffer. */
export function imageOf(cel: CelImage): Image {
  if (isCelInstance(cel)) return cel.image;
  const dimensions = `${cel.w}:${cel.h}`;
  const cached = legacyImages.get(cel.data) ?? new Map<string, Image>();
  const previous = cached.get(dimensions);
  if (previous && equalPixels(sourcePixels.get(previous)!, cel.data)) return previous;
  const image = createImage(cel.w, cel.h, cel.data);
  cached.set(dimensions, image);
  legacyImages.set(cel.data, cached);
  return image;
}

export function transformCel(cel: CelImage, transform: Partial<CelTransform>): CelInstance {
  const image = imageOf(cel);
  const next = createCelInstance(image, {
    ...(isCelInstance(cel) ? cel.transform : defaults()), ...transform, x: cel.x, y: cel.y, ext: cel.ext,
  });
  if (cel.tiles) next.tiles = cel.tiles;
  return next;
}

export function moveCel(cel: CelImage, x: number, y: number): CelImage {
  if (!isCelInstance(cel)) return { ...cel, x, y };
  const next = createCelInstance(cel.image, { ...cel.transform, x, y, ext: cel.ext });
  if (cel.tiles) next.tiles = cel.tiles;
  return next;
}

export function validateLayerFX(effects: unknown): asserts effects is LayerFX[] {
  if (!Array.isArray(effects) || effects.length > 64) throw new Error('Invalid layer effects');
  const ids = new Set<string>();
  for (const effect of effects) {
    if (!effect || typeof effect.id !== 'string' || !effect.id || effect.id.length > 256 || ids.has(effect.id)
      || typeof effect.enabled !== 'boolean')
      throw new Error('Invalid layer effect');
    if (effect.type === 'opacity') {
      if (!Number.isFinite(effect.amount) || effect.amount < 0 || effect.amount > 1) throw new Error('Invalid layer effect');
    } else if (effect.type === 'outline') {
      if (!Number.isInteger(effect.color) || effect.color < 0 || effect.color > 0xffffffff
        || !Number.isInteger(effect.thickness) || effect.thickness < 1 || effect.thickness > 128
        || !['inside', 'center', 'outside'].includes(effect.position) || !['round', 'miter', 'bevel'].includes(effect.join))
        throw new Error('Invalid outline effect');
    } else if (['shadow', 'glow', 'overlay'].includes(effect.type)) {
      if (!Number.isInteger(effect.color) || effect.color < 0 || effect.color > 0xffffffff) throw new Error('Invalid effect color');
      if (effect.type !== 'overlay' && (!Number.isInteger(effect.size) || effect.size < (effect.type === 'shadow' ? 0 : 1) || effect.size > 128))
        throw new Error('Invalid effect size');
      if (effect.type === 'shadow' && [effect.x, effect.y].some(v => !Number.isInteger(v) || Math.abs(v) > 1024))
        throw new Error('Invalid shadow offset');
      if (effect.type === 'glow' && !['inside', 'outside'].includes(effect.position)) throw new Error('Invalid glow position');
    } else throw new Error('Invalid layer effect');
    ids.add(effect.id);
  }
}

/** Per-frame residual scope after baking. IDs follow timeline content, never source images. */
export function effectsForFrame(layer: Pick<Layer, 'effects' | 'bakedEffects'>, frame: number): readonly LayerFX[] {
  const baked = layer.bakedEffects?.[frame];
  return baked?.length ? (layer.effects ?? []).filter(effect => !baked.includes(effect.id)) : layer.effects ?? [];
}

export function copyEffectScope(layer: Pick<Layer, 'bakedEffects'>) {
  return layer.bakedEffects?.map(ids => ids.slice());
}

/** Custom colors cannot be represented by grayscale; indexed also cannot retain arbitrary alpha. */
export const hasColorEffects = (effects: readonly LayerFX[] = []) => effects.some(effect => effect.enabled && effect.type !== 'opacity' && (effect.color >>> 24) > 0);

/** Conservative: arbitrary outline colors/alpha require RGB for indexed baking/export. */
export const hasPixelEffects = (effects: readonly LayerFX[] = []) => effects.some(effect => effect.enabled && (effect.type !== 'opacity' ? (effect.color >>> 24) > 0 : effect.amount !== 1));

/** Shared ordered pipeline for live rendering, baking and every export. Sources never change. */
export function bakeCel(cel: Cel, effects: readonly LayerFX[] = []): Cel {
  if (!cel) return null;
  validateLayerFX(effects);
  effectBounds(cel, effects); // Check the entire stack before any output allocation.
  let result: CelImage = cel, opacity = 1;
  const flushOpacity = () => {
    if (opacity !== 1) result = { ...result, data: result.data.map(pixel => {
      const alpha = Math.round((pixel >>> 24) * opacity);
      return alpha ? ((pixel & 0xffffff) | (alpha << 24)) >>> 0 : 0;
    }) };
    opacity = 1;
  };
  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.type === 'opacity') opacity *= effect.amount;
    else if (effect.color >>> 24) { flushOpacity(); result = effect.type === 'outline' ? applyOutline(result, effect) : applyColorEffect(result, effect); }
  }
  flushOpacity();
  return { x: result.x, y: result.y, w: result.w, h: result.h, data: result.data,
    ...(cel.ext ? { ext: cel.ext } : {}), ...(!hasPixelEffects(effects) && cel.tiles && !hasCelTransform(cel) ? { tiles: cel.tiles } : {}) };
}

/** Image resources own a private source buffer even when no cel references them (layer masks). */
export function isImage(value: object): value is Image { return sourcePixels.has(value as Image); }
export function visitImageBuffers(image: Image, visit: (identity: object, bytes: number) => void) {
  const pixels = sourcePixels.get(image);
  if (pixels) visit(retainedBufferIdentity(pixels.buffer), pixels.buffer.byteLength);
}

export function createLayerMask(image: Image, options: Partial<Omit<LayerMask, 'image'>> = {}): LayerMask {
  if (!sourcePixels.has(image)) throw new Error('Invalid mask image');
  const mask = { x: 0, y: 0, outside: 255, enabled: true, inverted: false, ...options, image };
  if (!Number.isInteger(mask.x) || !Number.isInteger(mask.y) || !Number.isInteger(mask.outside) || mask.outside < 0 || mask.outside > 255
    || typeof mask.enabled !== 'boolean' || typeof mask.inverted !== 'boolean') throw new Error('Invalid layer mask');
  return Object.freeze(mask);
}

export function layerMaskAlpha(mask: LayerMask, x: number, y: number): number {
  const { image } = mask, sx = x - mask.x, sy = y - mask.y;
  const value = sx >= 0 && sy >= 0 && sx < image.w && sy < image.h
    ? (sourcePixels.get(image)![sy * image.w + sx] >>> 24) : mask.outside;
  return mask.inverted ? 255 - value : value;
}

/** Mask follows the layer FX stack, before outer layer opacity/blend/clipping. */
export function applyLayerMask(cel: Cel, mask?: LayerMask): Cel {
  if (!cel || !mask?.enabled) return cel;
  const data = cel.data.map((pixel, i) => {
    const alpha = Math.round((pixel >>> 24) * layerMaskAlpha(mask, cel.x + i % cel.w, cel.y + Math.floor(i / cel.w)) / 255);
    return alpha ? ((pixel & 0xffffff) | (alpha << 24)) >>> 0 : 0;
  });
  return { x: cel.x, y: cel.y, w: cel.w, h: cel.h, data, ...(cel.ext ? { ext: cel.ext } : {}) };
}
