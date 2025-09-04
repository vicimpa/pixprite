import { byteHex } from "../utils/misc";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSVA {
  h: number;
  s: number;
  v: number;
  a: number;
}

export interface HSLA {
  h: number;
  s: number;
  l: number;
  a: number;
}

export class Color {
  r: number = 0;
  g: number = 0;
  b: number = 0;
  a: number = 1;

  constructor(r: number = 0, g: number = 0, b: number = 0, a: number = 1, is255 = true) {
    this.set(r, g, b, a, is255);
  }

  clone() {
    return Object.assign(new Color(), this);
  }

  set(r: number, g: number, b: number, a: number = 1, is255: boolean = true): this {
    const mult = is255 ? 255 : 1;
    this.r = r / mult;
    this.g = g / mult;
    this.b = b / mult;
    this.a = a;
    return this;
  }

  fromHex(hex: string, alpha = 1, is255 = true): this {
    alpha *= is255 ? 255 : 1;
    if (hex[0] === '#') hex = hex.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = hex.replace(/[\da-f]/i, e => e.repeat(2));
    if (hex.length === 6) hex += byteHex(alpha);
    if (hex.length !== 8) throw new Error('Invalid hex format');

    return this.set(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(6, 8), 16),
      true
    );
  }

  fromRgba(r: number, g: number, b: number, a: number = 1): this {
    return this.set(r, g, b, a, true);
  }

  fromHsv(h: number, s: number, v: number, a: number = 1): this {
    let c = v * s;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = v - c;

    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];

    return this.set(r + m, g + m, b + m, a, false);
  }

  fromHsl(h: number, s: number, l: number, a: number = 1): this {
    const v = l + s * Math.min(l, 1 - l);
    const sv = v === 0 ? 0 : 2 * (1 - l / v);

    let c = v * sv;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = v - c;

    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];

    return this.set(r + m, g + m, b + m, a, false);
  }

  fromInt(value: number): this {
    const r = (value >> 24) & 0xFF;
    const g = (value >> 16) & 0xFF;
    const b = (value >> 8) & 0xFF;
    const a = value & 0xFF / 255;
    return this.set(r, g, b, a, true);
  }

  toRgb(is255 = true): RGBA {
    const mult = is255 ? 255 : 1;
    return {
      r: Math.round(this.r * mult),
      g: Math.round(this.g * mult),
      b: Math.round(this.b * mult),
      a: this.a,
    };
  }

  toHex(includeAlpha = false): string {
    const { r, g, b, a } = this.toRgb();
    const hex = "#" + byteHex(r) + byteHex(g) + byteHex(b) +
      (includeAlpha ? byteHex(a * 255 | 0) : '');
    return hex.toUpperCase();
  }

  toAlphaByte() {
    return Math.round(this.a * 255);
  }

  toHsv(): HSVA {
    const r = this.r, g = this.g, b = this.b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }

    let s = max === 0 ? 0 : d / max;
    let v = max;
    return { h, s, v, a: this.a };
  }

  toHsl(): HSLA {
    const r = this.r, g = this.g, b = this.b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;

    let h = 0, s = 0;

    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }

    return { h, s, l, a: this.a };
  }

  toInt(): number {
    const { r, g, b, a } = this.toRgb(true);
    return ((r & 0xFF) << 24) |
      ((g & 0xFF) << 16) |
      ((b & 0xFF) << 8) |
      ((a * 255) & 0xFF);
  }

  toCssRgb(): string {
    const { r, g, b, a } = this.toRgb();
    return a === 1
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }

  toCssHsl(): string {
    const { h, s, l, a } = this.toHsl();
    const s100 = Math.round(s * 100);
    const l100 = Math.round(l * 100);
    return a === 1
      ? `hsl(${Math.round(h)}, ${s100}%, ${l100}%)`
      : `hsla(${Math.round(h)}, ${s100}%, ${l100}%, ${a.toFixed(3)})`;
  }
}
