import { rgbToHsv, hsvToRgb, rgbToHsl, hsvToHsl, hslToHsv } from "$utils/color";
import { clampFloat, clampByte, byteToHex, floatToHex, toFixed } from "$utils/math";

const hexre = /^([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i;

export class Color {
  private _r = 0;
  private _g = 0;
  private _b = 0;

  private _h = 0;
  private _sv = 0;
  private _sl = 0;

  private _v = 0;
  private _l = 0;
  private _a = 1;

  get rgb(): [number, number, number] { return [this._r, this._g, this._b]; }
  set rgb([r, g, b]: [number, number, number]) { this.setFromRgb(r, g, b, this._a); }

  get rgba(): [number, number, number, number] { return [this._r, this._g, this._b, this._a]; }
  set rgba([r, g, b, a]: [number, number, number, number]) { this.setFromRgb(r, g, b, a); }

  get hsv(): [number, number, number] { return [this._h, this._sv, this._v]; }
  set hsv([h, s, v]: [number, number, number]) { this.setFromHsv(h, s, v, this._a); }

  get hsva(): [number, number, number, number] { return [this._h, this._sv, this._v, this._a]; }
  set hsva([h, s, v, a]: [number, number, number, number]) { this.setFromHsv(h, s, v, a); }

  get hsl(): [number, number, number] { return [this._h, this._sl, this._l]; }
  set hsl([h, s, l]: [number, number, number]) { this.setFromHsl(h, s, l, this._a); }

  get hsla(): [number, number, number, number] { return [this._h, this._sl, this._l, this._a]; }
  set hsla([h, s, l, a]: [number, number, number, number]) { this.setFromHsl(h, s, l, a); }

  setFromHex(hex: string) {
    hex = hex.trim();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex += 'f';
    if (hex.length === 6) hex += 'ff';
    if (hex.length === 4) hex = hex.replace(/\w/g, f => f + f);
    const match = hexre.exec(hex);
    if (!match) throw new Error('Invalid hex');
    const [, r, g, b, a] = match;
    this.setFromRgb(
      parseInt(r, 16),
      parseInt(g, 16),
      parseInt(b, 16),
      parseInt(a, 16) / 255,
    );
    return this;
  }

  setFromRgb(r: number, g: number, b: number, a: number) {
    this._r = clampByte(r);
    this._g = clampByte(g);
    this._b = clampByte(b);
    this._a = clampFloat(a);

    const hsv = rgbToHsv(this._r, this._g, this._b);
    const hsl = rgbToHsl(this._r, this._g, this._b);
    this._h = hsv.h;
    this._sv = hsv.s;
    this._v = hsv.v;
    this._sl = hsl.s;
    this._l = hsl.l;
    return this;
  }

  setFromHsv(h: number, s: number, v: number, a: number) {
    this._h = ((h % 360) + 360) % 360;
    this._sv = clampFloat(s);
    this._v = clampFloat(v);
    this._a = clampFloat(a);

    const { r, g, b } = hsvToRgb(this._h, this._sv, this._v);
    this._r = r; this._g = g; this._b = b;

    const { l, s: s_hsl } = hsvToHsl(this._h, this._sv, this._v);
    this._l = l;
    this._sl = s_hsl;
    return this;
  }

  setFromHsl(h: number, s: number, l: number, a: number) {
    this._h = ((h % 360) + 360) % 360;
    this._sl = clampFloat(s);
    this._l = clampFloat(l);
    this._a = clampFloat(a);

    const { v, s: s_hsv } = hslToHsv(this._h, this._sl, this._l);
    this._v = v;
    this._sv = s_hsv;

    const { r, g, b } = hsvToRgb(this._h, this._sv, this._v);
    this._r = r; this._g = g; this._b = b;
    return this;
  }

  toHexString(includeAlpha = false): string {
    const r = byteToHex(this._r);
    const g = byteToHex(this._g);
    const b = byteToHex(this._b);
    if (includeAlpha) {
      const a = floatToHex(this._a);
      return `#${r}${g}${b}${a}`;
    }
    return `#${r}${g}${b}`;
  }

  toRgbString(includeAlpha = false): string {
    if (includeAlpha) {
      return `rgba(${this._r}, ${this._g}, ${this._b}, ${toFixed(this._a, 3)})`;
    }
    return `rgb(${this._r}, ${this._g}, ${this._b})`;
  }

  toHslString(includeAlpha = false): string {
    const h = Math.round(this._h);
    const s = Math.round(this._sl * 100);
    const l = Math.round(this._l * 100);
    if (includeAlpha) {
      return `hsla(${h}, ${s}%, ${l}%, ${toFixed(this._a, 3)})`;
    }
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  toHsvString(includeAlpha = false): string {
    const h = Math.round(this._h);
    const s = Math.round(this._sv * 100);
    const v = Math.round(this._v * 100);
    if (includeAlpha) {
      return `hsva(${h}, ${s}%, ${v}%, ${toFixed(this._a, 3)})`;
    }
    return `hsv(${h}, ${s}%, ${v}%)`;
  }

  clone() {
    return Object.assign(new Color(), this);
  }

  static fromHex(hex: string) {
    return new this().setFromHex(hex);
  }

  static fromRgb(r: number, g: number, b: number, a = 1) {
    return new this().setFromRgb(r, g, b, a);
  }

  static fromHsl(h: number, s: number, l: number, a = 1) {
    return new this().setFromHsl(h, s, l, a);
  }

  static fromHsv(h: number, s: number, v: number, a = 1) {
    return new this().setFromHsv(h, s, v, a);
  }
}
