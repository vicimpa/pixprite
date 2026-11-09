import { Color } from "~/core/Color";

/** Removes the leading #, whitespace and any characters that are not hex digits. */
export function cleanHexInput(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').slice(0, 8).toLowerCase();
}

/**
 * Parses a hex color in the 3, 4, 6 or 8 digit form, with or without a leading #.
 * Returns null when the value is not a complete, valid color.
 */
export function parseHex(value: string): Color | null {
  const raw = value.trim().replace(/^#+/, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  let hex = raw.toLowerCase();
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return Color.fromRgb(r, g, b, a);
}
