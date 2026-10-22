import type { Rect } from "~/core/Image";

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Immutable 1-byte-per-pixel selection. Every operation returns a new mask. */
export class Mask {
  readonly bounds: Rect | null;
  private _edges?: Float32Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly data = new Uint8Array(w * h),
  ) {
    this.bounds = Mask.measure(w, h, data);
  }

  private static measure(w: number, h: number, data: Uint8Array): Rect | null {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[y * w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  get empty() { return this.bounds === null; }

  has(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[y * this.w + x] !== 0;
  }

  static fromFn(w: number, h: number, fn: (x: number, y: number) => boolean) {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (fn(x, y)) data[y * w + x] = 1;
    return new Mask(w, h, data);
  }

  static rect(w: number, h: number, r: Rect) {
    return Mask.fromFn(w, h, (x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  }

  static ellipse(w: number, h: number, r: Rect) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const rx = r.w / 2, ry = r.h / 2;
    return Mask.fromFn(w, h, (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1);
  }

  /** Even-odd fill sampled at pixel centers */
  static polygon(w: number, h: number, points: [number, number][]) {
    const data = new Uint8Array(w * h);
    if (points.length < 3) {
      for (const [x, y] of points)
        if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 1;
      return new Mask(w, h, data);
    }
    for (let y = 0; y < h; y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        const ayi = yi + 0.5, ayj = yj + 0.5;
        if ((ayi > py) !== (ayj > py))
          xs.push(xi + 0.5 + (py - ayi) / (ayj - ayi) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, Math.ceil(xs[k + 1] - 0.5)); x++)
          data[y * w + x] = 1;
    }
    // Outline pixels always belong to the shape
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let s = 0; s <= n; s++) {
        const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
        if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 1;
      }
    }
    return new Mask(w, h, data);
  }

  combine(other: Mask, mode: SelectMode) {
    if (mode === 'replace') return other;
    const out = new Uint8Array(this.w * this.h);
    for (let i = 0; i < out.length; i++) {
      const a = this.data[i], b = other.data[i];
      out[i] = mode === 'add' ? a | b : mode === 'subtract' ? a & (b ^ 1) : a & b;
    }
    return new Mask(this.w, this.h, out);
  }

  invert() {
    return new Mask(this.w, this.h, this.data.map(v => v ^ 1));
  }

  /** Grow (n > 0) or shrink (n < 0) by n pixels using a square neighbourhood */
  morph(n: number) {
    const { w, h, data } = this;
    const grow = n > 0;
    const r = Math.abs(n);
    return Mask.fromFn(w, h, (x, y) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          const v = nx >= 0 && ny >= 0 && nx < w && ny < h ? data[ny * w + nx] : 0;
          if (grow && v) return true;
          if (!grow && !v) return false;
        }
      return !grow;
    });
  }

  border(n: number) {
    const outer = this.morph(n), inner = this.morph(-n);
    return outer.combine(inner, 'subtract');
  }

  translate(dx: number, dy: number) {
    const { w, h } = this;
    return Mask.fromFn(w, h, (x, y) => this.has(x - dx, y - dy));
  }

  /** Resize the canvas the mask lives on, shifting content by (dx, dy) */
  reframe(w: number, h: number, dx = 0, dy = 0) {
    return Mask.fromFn(w, h, (x, y) => this.has(x - dx, y - dy));
  }

  /** Line segments (x0, y0, x1, y1, ...) along the selection border, in pixel units */
  get edges() {
    if (this._edges) return this._edges;
    const { w, h } = this;
    const out: number[] = [];
    for (let y = 0; y <= h; y++) {
      for (let x = 0; x <= w; x++) {
        const v = this.has(x, y);
        if (v !== this.has(x, y - 1) && x < w) out.push(x, y, x + 1, y);
        if (v !== this.has(x - 1, y) && y < h) out.push(x, y, x, y + 1);
      }
    }
    return this._edges = new Float32Array(out);
  }
}
