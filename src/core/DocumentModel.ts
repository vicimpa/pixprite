import type { Bitmap } from './Image';
import type { Cel, CelImage, ExtData } from './SpriteModel';

/** An immutable shared pixel resource. Its public data view is a defensive copy. */
export type Image = Readonly<{ kind: 'image'; id: string; w: number; h: number; data: Uint32Array }>;
export type AssetRef<Kind extends string = 'image'> = Readonly<{ kind: Kind; id: string }>;
export type CelTransform = { flipX: boolean; flipY: boolean; rotation: 0 | 90 | 180 | 270; opacity: number };
export type CelInstance = CelImage & {
  readonly image: Image;
  readonly asset: AssetRef;
  readonly transform: Readonly<CelTransform>;
};
/** The first processing primitive; further effects can extend this discriminated union. */
export type LayerFX = Readonly<{ id: string; type: 'opacity'; enabled: boolean; amount: number }>;

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
export function visitCelBuffers(cel: CelImage, visit: (identity: object, bytes: number) => void) {
  const state = instances.get(cel);
  if (!state) return;
  const source = sourcePixels.get(state.image);
  if (source) visit(retainedBufferIdentity(source.buffer), source.buffer.byteLength);
  if (state.bitmap) visit(retainedBufferIdentity(state.bitmap.data.buffer), state.bitmap.data.buffer.byteLength);
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
    if (!effect || typeof effect.id !== 'string' || !effect.id || ids.has(effect.id) || effect.type !== 'opacity'
      || typeof effect.enabled !== 'boolean' || !Number.isFinite(effect.amount) || effect.amount < 0 || effect.amount > 1)
      throw new Error('Invalid layer effect');
    ids.add(effect.id);
  }
}

export const layerFXOpacity = (effects: readonly LayerFX[] = []) => effects.reduce((alpha, effect) => effect.enabled ? alpha * effect.amount : alpha, 1);

/** Shared pipeline used by live layer rendering and format conversion. Source resources never change. */
export function bakeCel(cel: Cel, effects: readonly LayerFX[] = []): Cel {
  if (!cel) return null;
  const opacity = layerFXOpacity(effects);
  const data = opacity === 1 ? cel.data : cel.data.map(pixel => {
    const alpha = Math.round((pixel >>> 24) * opacity);
    return alpha ? ((pixel & 0xffffff) | (alpha << 24)) >>> 0 : 0;
  });
  return { x: cel.x, y: cel.y, w: cel.w, h: cel.h, data, ...(cel.ext ? { ext: cel.ext } : {}), ...(cel.tiles && opacity === 1 && !hasCelTransform(cel) ? { tiles: cel.tiles } : {}) };
}
