import type { Bitmap } from '~/core/Image';
import { renderPlacement } from '~/core/Transform';

/** Transform the image and alpha together, rather than rotating only its footprint. */
export function transformBrush(bmp: Bitmap, angle = 0, scale = 1, flipX = false, flipY = false) {
  scale = Math.max(0, Math.min(scale, 4096 / Math.max(bmp.w, bmp.h)));
  const w = Math.max(1, Math.round(bmp.w * scale)), h = Math.max(1, Math.round(bmp.h * scale));
  const x = -Math.floor(w / 2) || 0, y = -Math.floor(h / 2) || 0;
  if (angle % 360 === 0 && w === bmp.w && h === bmp.h && !flipX && !flipY) return { x, y, bmp };
  const result = renderPlacement(bmp, null, { x: flipX ? x + w : x, y: flipY ? y + h : y,
    w: flipX ? -w : w, h: flipY ? -h : h, angle: -angle, px: 0.5, py: 0.5 }, 'fast');
  return { x: result.x, y: result.y, bmp: result.bmp };
}
