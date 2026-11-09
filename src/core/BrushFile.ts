import type { LibraryItem } from './State';
import { readBrushParameters } from './BrushParameters';

export const MAX_BRUSH_FILE_BYTES = 96 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Versioned portable brush library; validate the entire file before mutating the editor. */
export function decodeBrushFile(text: string): LibraryItem[] {
  if (text.length > MAX_BRUSH_FILE_BYTES) throw new Error('Brush file is too large');
  const root = JSON.parse(text);
  if (!root || root.format !== 'pixprite-brushes' || root.version !== 1 || !Array.isArray(root.items) || !root.items.length || root.items.length > 256)
    throw new Error('Unsupported brush file');
  let pixels = 0;
  return root.items.map((item: Record<string, unknown>) => {
    if (!item || item.kind !== 'brush' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 512 ||
      !integer(item.w, 1, 4096) || !integer(item.h, 1, 4096)) throw new Error('Invalid brush image');
    pixels += item.w * item.h;
    if (pixels > MAX_PIXELS || typeof item.data !== 'string' || item.data.length !== Math.ceil(item.w * item.h * 4 / 3) * 4 ||
      /[^A-Za-z0-9+/=]/.test(item.data) || atob(item.data).length !== item.w * item.h * 4)
      throw new Error('Invalid brush pixel data');
    if (item.align !== undefined && !['source', 'stroke', 'dab'].includes(item.align as string) ||
      item.tint !== undefined && typeof item.tint !== 'boolean' ||
      item.ox !== undefined && !integer(item.ox, -4096, 4096) || item.oy !== undefined && !integer(item.oy, -4096, 4096)) throw new Error('Invalid brush metadata');
    return { id: '', name: item.name.trim(), kind: 'brush', w: item.w, h: item.h, data: item.data,
      ox: item.ox as number ?? 0, oy: item.oy as number ?? 0, align: item.align as LibraryItem['align'] ?? 'dab', tint: item.tint as boolean ?? false,
      ...(typeof item.stampId === 'string' && /^stamp\.(star|heart|sparkle|diamond|cross|leaf)$/.test(item.stampId) ? { stampId: item.stampId } : {}),
      ...(item.settings === undefined ? {} : { settings: readBrushParameters(item.settings) }) } satisfies LibraryItem;
  });
}

export function encodeBrushFile(items: LibraryItem[]) {
  const text = JSON.stringify({ format: 'pixprite-brushes', version: 1, items });
  decodeBrushFile(text);
  return text;
}
