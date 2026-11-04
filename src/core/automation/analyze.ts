import type { Sprite } from '../Sprite';
import { integer, provenance } from './document';

export function analyze(doc: Sprite, params: Record<string, unknown>) {
  const layers = (params.layers as number[] | undefined) ?? doc.layers.map((_, i) => i).filter(i => !doc.layers[i].group && !doc.layers[i].reference);
  const frames = (params.frames as number[] | undefined) ?? doc.frames.map((_, i) => i);
  if (layers.length * frames.length > 4096) throw new Error('Analysis is limited to 4096 cels; narrow layers/frames');
  const results = [];
  let scanned = 0;
  for (const layer of layers) for (const frame of frames) {
    integer(layer, 'layer', 0, doc.layers.length - 1); integer(frame, 'frame', 0, doc.frames.length - 1);
    const cel = doc.getCel(layer, frame), colors = new Map<number, number>();
    let count = 0, sumX = 0, sumY = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    if (cel) {
      scanned += cel.w * cel.h;
      if (scanned > 16_777_216) throw new Error('Analysis exceeds 16 million pixels; narrow layers/frames');
      for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
        const pixel = cel.data[y * cel.w + x]; if (!(pixel >>> 24)) continue;
        count++; const px = cel.x + x, py = cel.y + y;
        sumX += px; sumY += py; left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
        colors.set(pixel, (colors.get(pixel) ?? 0) + 1);
      }
    }
    results.push({ layer, frame, pixels: count, bounds: count ? { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } : null,
      centroid: count ? { x: sumX / count, y: sumY / count } : null, uniqueColors: colors.size,
      colors: [...colors].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([rgba, count]) => ({ color: '#' + [rgba & 255, rgba >>> 8 & 255, rgba >>> 16 & 255, rgba >>> 24].map(v => v.toString(16).padStart(2, '0')).join(''), count })) });
  }
  return { ...provenance(doc), cels: results };
}
