import * as z from 'zod/v4-mini';
import { pixelOperation } from './automation-schema';
import { bytes, integer } from './data';
export type PixelDocument = { width: number; height: number; layer: number; frame: number; layers: readonly { group: boolean; reference?: unknown }[]; frames: readonly unknown[]; lockedDeep(layer: number): boolean };

export function preparePixels(doc: PixelDocument, input: unknown) {
  const p = z.parse(pixelOperation, input);
  const layer = integer(p.layer ?? doc.layer, 'layer', 0, doc.layers.length - 1);
  const frame = integer(p.frame ?? doc.frame, 'frame', 0, doc.frames.length - 1);
  const rect = p.rect ?? (p.rows ? { x: 0, y: 0, w: p.rows[0].length, h: p.rows.length } : { x: 0, y: 0, w: doc.width, h: doc.height });
  if (rect.x + rect.w > doc.width || rect.y + rect.h > doc.height || rect.w * rect.h > 1_048_576) throw new Error('Pixel rect must fit the canvas and contain at most 1,048,576 pixels');
  if (p.action === 'read') {
    if (p.fill !== undefined || p.data !== undefined || p.rows !== undefined) throw new Error('Pixel reads cannot include fill, data or rows');
    if (p.encoding === 'hex' && rect.w * rect.h > 4096) throw new Error('Hex reads are limited to 4096 pixels; request a crop or base64');
    return { ...p, layer, frame, rect, data: undefined };
  }
  if (doc.lockedDeep(layer)) throw new Error('Layer is locked');
  if (doc.layers[layer].group || doc.layers[layer].reference) throw new Error('Layer has no pixels');
  if ([p.fill, p.data, p.rows].filter(v => v !== undefined).length !== 1) throw new Error('A pixel write requires exactly one of data, rows or fill');
  if (p.action === 'fill' && p.fill === undefined) throw new Error('Pixel fill requires fill color');
  let data: Uint8ClampedArray;
  if (p.fill !== undefined) {
    const full = p.fill.slice(1);
    const rgba = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255];
    data = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  } else if (p.rows) {
    if (p.rows.length !== rect.h || p.rows.some(row => row.length !== rect.w)) throw new Error('All rows must have the same width and match rect');
    if (rect.w * rect.h > 4096) throw new Error('Hex rows are limited to 4096 pixels; use base64 for larger buffers');
    data = new Uint8ClampedArray(rect.w * rect.h * 4);
    p.rows.forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      const raw = value.slice(1), full = raw.length < 5 ? [...raw].map(v => v + v).join('') : raw;
      data.set([parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) : 255], (y * rect.w + x) * 4);
    }));
  } else data = bytes(p.data);
  if (data.length !== rect.w * rect.h * 4) throw new Error('RGBA byte count does not match rect');
  return { ...p, layer, frame, rect, data };
}

