import type { Sprite } from './Sprite';

/** Frame tinted red (past) or blue (future) by luminance, cached per sprite version */
const tintCache = new WeakMap<Sprite, { version: number; preview: Sprite['effectsPreview']; frames: Map<string, OffscreenCanvas> }>();
export function tinted(sprite: Sprite, frame: number, past: boolean) {
  let cache = tintCache.get(sprite);
  if (!cache || cache.version !== sprite.version || cache.preview !== sprite.effectsPreview) tintCache.set(sprite, cache = { version: sprite.version, preview: sprite.effectsPreview, frames: new Map() });
  const key = `${frame}:${past}`;
  const hit = cache.frames.get(key);
  if (hit) return hit;
  if (cache.frames.size >= 32) cache.frames.clear();
  const src = sprite.render(frame);
  const out = new OffscreenCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 2;
    d[i] = past ? 128 + l : l;
    d[i + 1] = l;
    d[i + 2] = past ? l : 128 + l;
  }
  ctx.putImageData(img, 0, 0);
  cache.frames.set(key, out);
  return out;
}

export function clearTintCache(sprite: Sprite) { tintCache.delete(sprite); }
