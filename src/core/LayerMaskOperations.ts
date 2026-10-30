import { bitmapToCanvas, unionRect, type Rect } from './Image';
import { createImage, createLayerMask, layerMaskAlpha, type LayerMask } from './DocumentModel';
import type { SpriteContext } from './SpriteContext';
import * as rendering from './SpriteRenderer';

/** Effective coverage as opaque grayscale, independent of enabled state and color mode. */
export function maskPixels(mask: LayerMask, rect: Rect): Uint32Array {
  return Uint32Array.from({ length: rect.w * rect.h }, (_, i) => {
    const value = layerMaskAlpha(mask, rect.x + i % rect.w, rect.y + Math.floor(i / rect.w));
    return (0xff000000 | value * 0x10101) >>> 0;
  });
}

export const maskGray = (pixel: number) => Math.round(((pixel & 255) * .299 + ((pixel >>> 8) & 255) * .587 + ((pixel >>> 16) & 255) * .114) * (pixel >>> 24) / 255);

export function maskFitsCanvas(mask: LayerMask, canvas: Rect): boolean {
  const rect = unionRect({ x: mask.x, y: mask.y, w: mask.image.w, h: mask.image.h }, canvas)!;
  return rect.w <= 4096 && rect.h <= 4096;
}

/** Convert effective grayscale to stored alpha, preserving inversion and off-canvas coverage. */
export function paintedMask(mask: LayerMask, data: Uint32Array, canvas: Rect): LayerMask {
  if (data.length !== canvas.w * canvas.h) throw new Error('Invalid mask pixel buffer');
  const rect = unionRect({ x: mask.x, y: mask.y, w: mask.image.w, h: mask.image.h }, canvas)!;
  if (rect.w > 4096 || rect.h > 4096) throw new RangeError('Mask exceeds 4096 pixels per side');
  const pixels = new Uint32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const px = rect.x + x, py = rect.y + y;
    const cx = px - canvas.x, cy = py - canvas.y;
    const coverage = cx >= 0 && cy >= 0 && cx < canvas.w && cy < canvas.h ? maskGray(data[cy * canvas.w + cx]) : layerMaskAlpha(mask, px, py);
    pixels[y * rect.w + x] = ((mask.inverted ? 255 - coverage : coverage) << 24) >>> 0;
  }
  return createLayerMask(createImage(rect.w, rect.h, pixels), { ...mask, x: rect.x, y: rect.y });
}

export function createMask(this: SpriteContext, source: 'reveal' | 'selection' | 'alpha' | 'color' = 'reveal', sourceLayer = -1, color = 0, index = this.layer): boolean {
  const layer = this.layers[index], selection = this.mask;
  if (!layer || layer.reference || this.lockedDeep(index)) return false;
  if (source === 'selection' && !selection) return false;
  if (source === 'alpha' && (sourceLayer === index || !this.layers[sourceLayer] || this.layers[sourceLayer].reference)) return false;
  // Switching away from a floating color edit cancels it. Mask creation must never commit color pixels.
  this.cancelFloating();
  let input: Uint32Array | undefined;
  if (source === 'alpha' || source === 'color' && layer.group) {
    const context = { ...this, ...rendering, effectsPreview: null, cache: new Map<string, OffscreenCanvas>(), cacheVersion: -1, focusLayer: null, split: null, canvasRect: this.canvasRect };
    const canvas = rendering.render.call(context, this.frame, source === 'alpha' ? sourceLayer : index);
    input = new Uint32Array(canvas.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.buffer);
  } else if (source === 'color') input = this.canvasPixels(index);
  const data = new Uint32Array(this.size);
  for (let i = 0; i < data.length; i++) {
    const value = source === 'reveal' ? 255 : source === 'selection' ? (selection!.data[i] ? 255 : 0)
      : source === 'alpha' ? input![i] >>> 24
      : (color >>> 24 ? (input![i] >>> 24) > 0 && (input![i] & 0xffffff) === (color & 0xffffff) : (input![i] >>> 24) === 0) ? 255 : 0;
    data[i] = (value << 24) >>> 0;
  }
  const mask = createLayerMask(createImage(this.width, this.height, data), { outside: source === 'reveal' ? 255 : 0 });
  this.checkpoint('Create layer mask');
  this.layers = this.layers.map((l, i) => i === index ? { ...l, mask } : l);
  this.editingChannel = 'mask';
  this.touch();
  return true;
}

export function updateMask(this: SpriteContext, patch: Partial<Pick<LayerMask, 'enabled' | 'inverted'>> | null, index = this.layer): boolean {
  const layer = this.layers[index];
  if (!layer?.mask || this.lockedDeep(index)) return false;
  const mask = patch && createLayerMask(layer.mask.image, { ...layer.mask, ...patch });
  this.cancelFloating();
  this.checkpoint(patch ? 'Layer mask' : 'Remove layer mask');
  this.layers = this.layers.map((l, i) => i === index ? { ...l, mask: mask ?? undefined } : l);
  if (!mask) { this.editingChannel = 'color'; this.maskView = false; }
  this.touch();
  return true;
}

/** Painting is an explicit channel write. Generic cel/extension writes keep targeting source color. */
export function putMaskPixels(this: SpriteContext, data: Uint32Array, index = this.layer): boolean {
  const layer = this.layers[index];
  if (!layer?.mask || !maskFitsCanvas(layer.mask, this.canvasRect) || !this.visibleDeep(index) || this.lockedDeep(index)) return false;
  const mask = paintedMask(layer.mask, data, this.canvasRect);
  this.layers = this.layers.map((l, i) => i === index ? { ...l, mask } : l);
  this.touch();
  return true;
}

/** Editor channel/view flags never enter rendering/captures used by exports or extensions. */
export function renderEditor(this: SpriteContext, override?: { layer: number; data: Uint32Array }): OffscreenCanvas {
  if (!this.editingMask) return this.render(this.frame, undefined, override);
  if (this.maskView) return bitmapToCanvas({ w: this.width, h: this.height, data: override?.data ?? this.layerMaskPixels() });
  if (!override || this.maskBoundsNotice) return this.render();
  const layers = this.layers.map((layer, i) => i === override.layer && layer.mask ? { ...layer, mask: paintedMask(layer.mask, override.data, this.canvasRect) } : layer);
  return rendering.render.call({ ...this, ...rendering, layers, cache: new Map(), cacheVersion: -1, focusLayer: null, split: null, canvasRect: this.canvasRect });
}
