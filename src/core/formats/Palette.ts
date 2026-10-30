/** Palette file formats (GIMP .gpl, JASC .pal, .hex, Adobe .act) and built-in presets. */

export type PaletteFormat = 'gpl' | 'pal' | 'hex' | 'act' | 'png';

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => '#' + hex2(r) + hex2(g) + hex2(b);

/** '#rrggbb[aa]' -> [r, g, b, a] */
function parseHex(s: string): [number, number, number, number] {
  let h = s.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = (o: number) => parseInt(h.slice(o, o + 2), 16) || 0;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 255];
}

function lines(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes).replace(/^﻿/, '').split(/\r\n|\r|\n/);
}

function parseGpl(text: string[]) {
  const out: string[] = [];
  for (const raw of text.slice(1)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || /^(Name|Columns):/i.test(l)) continue;
    const m = l.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (m) out.push(rgbHex(+m[1], +m[2], +m[3]));
  }
  return out;
}

function parsePal(text: string[]) {
  const body = text.map(l => l.trim()).filter(Boolean);
  const count = parseInt(body[2] ?? '', 10);
  const out: string[] = [];
  for (const l of body.slice(3)) {
    const m = l.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (m) out.push(rgbHex(+m[1], +m[2], +m[3]));
  }
  return Number.isFinite(count) && count >= 0 ? out.slice(0, count) : out;
}

function parseHexText(text: string[]) {
  const out: string[] = [];
  for (const raw of text) {
    const l = raw.trim().replace(/^#/, '');
    if (!l || l.startsWith(';') || l.startsWith('//')) continue;
    if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(l)) throw new Error(`Invalid hex palette line: ${raw}`);
    out.push('#' + l.toLowerCase());
  }
  return out;
}

function parseAct(bytes: Uint8Array) {
  if (bytes.length < 768) throw new Error('ACT palette must be at least 768 bytes');
  let count = 256;
  if (bytes.length >= 772) {
    const c = (bytes[768] << 8) | bytes[769];
    if (c > 0 && c <= 256) count = c;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(rgbHex(bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]));
  return out;
}

/** Parse palette bytes, detecting format by content first, then extension. PNG is handled by the caller. */
export function parsePalette(name: string, bytes: Uint8Array): string[] {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const head = new TextDecoder().decode(bytes.subarray(0, 16)).replace(/^﻿/, '');
  if (head.startsWith('GIMP Palette')) return parseGpl(lines(bytes));
  if (head.startsWith('JASC-PAL')) return parsePal(lines(bytes));
  if (ext === 'act') return parseAct(bytes);
  if (ext === 'hex' || ext === 'txt') return parseHexText(lines(bytes));
  if (ext === 'gpl') throw new Error('Missing "GIMP Palette" header');
  if (ext === 'pal') throw new Error('Unsupported .pal variant (expected JASC-PAL)');
  if (bytes.length === 768 || bytes.length === 772) return parseAct(bytes);
  throw new Error(`Unknown palette format: ${name}`);
}

/** Serialize colours to a palette file. Alpha is dropped except for .hex when any entry is translucent. */
export function serializePalette(format: Exclude<PaletteFormat, 'png'>, colors: string[], name = 'Pixprite'): Uint8Array {
  const rgba = colors.map(parseHex);
  const enc = (s: string) => new TextEncoder().encode(s);
  switch (format) {
    case 'gpl': {
      let s = `GIMP Palette\nName: ${name.replace(/[\r\n]/g, ' ')}\nColumns: ${Math.min(16, Math.max(1, rgba.length))}\n#\n`;
      for (const [r, g, b] of rgba) s += `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${rgbHex(r, g, b).slice(1)}\n`;
      return enc(s);
    }
    case 'pal': {
      let s = `JASC-PAL\r\n0100\r\n${rgba.length}\r\n`;
      for (const [r, g, b] of rgba) s += `${r} ${g} ${b}\r\n`;
      return enc(s);
    }
    case 'hex': {
      const alpha = rgba.some(c => c[3] < 255);
      return enc(rgba.map(([r, g, b, a]) => rgbHex(r, g, b).slice(1) + (alpha ? hex2(a) : '')).join('\n') + '\n');
    }
    case 'act': {
      const n = Math.min(256, rgba.length);
      const out = new Uint8Array(772);
      for (let i = 0; i < n; i++) out.set(rgba[i].slice(0, 3), i * 3);
      out[768] = n >> 8; out[769] = n & 255;
      out[770] = 0xff; out[771] = 0xff; // no transparent index
      return out;
    }
  }
  throw new Error(`Unsupported palette format: ${format}`);
}

export { PRESET_PALETTES } from "./PalettePresets";
