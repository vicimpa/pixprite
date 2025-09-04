import { Color } from "$core/Color";

declare var EyeDropper: (new () => EyeDropper) | null;

interface EyeDropper {
  open(): Promise<{ sRGBHex: string; }>;
}

export const hasEyeDropper = typeof EyeDropper !== 'undefined';

export const triggerEyeDropper = async () => {
  if (!EyeDropper) return null;
  const picker = new EyeDropper();
  const result = await picker.open();
  return result.sRGBHex;
};

export function hslToHsv(h: number, s: number, l: number): [number, number, number] {
  const v = l + s * Math.min(l, 1 - l);
  let sv = 0;
  if (v !== 0) {
    sv = 2 * (1 - l / v);
  }
  return [h, sv, v];
}

export function hsvToHsl(h: number, s: number, v: number): [number, number, number] {
  const l = v * (1 - s / 2);
  let sl = 0;
  if (l !== 0 && l !== 1) {
    sl = (v - l) / Math.min(l, 1 - l);
  }
  return [h, sl, l];
}

const colorRegExp = /^(\d+)\s(\d+)\s(\d+)/;

export function parsePalette(string: string) {
  const colors: Color[] = [];

  string.split(/\n+/)
    .map(e => e.trim().split(/\s+/).map(e => e.trim()).join(' '))
    .forEach(row => {
      const match = colorRegExp.exec(row);
      if (!match) return;
      const [_, r, g, b] = match;
      colors.push(new Color(+r, +g, +b, 1, true));
    });

  return colors;
}