import { packRgba, unpackRgba } from '~/core/Image';

type Rgb = [number, number, number];

const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;
const sat = (rgb: Rgb) => Math.max(...rgb) - Math.min(...rgb);

const clipColor = (rgb: Rgb): Rgb => {
  const l = lum(rgb);
  const n = Math.min(...rgb);
  const x = Math.max(...rgb);
  let out = rgb.map(v => {
    if (n < 0 && l !== n) return l + (v - l) * l / (l - n);
    return v;
  }) as Rgb;
  if (x > 1 && x !== l) out = out.map(v => l + (v - l) * (1 - l) / (x - l)) as Rgb;
  return out.map(v => Math.max(0, Math.min(1, v))) as Rgb;
};

const setLum = (rgb: Rgb, l: number) => {
  const d = l - lum(rgb);
  return clipColor(rgb.map(v => v + d) as Rgb);
};

const setSat = (rgb: Rgb, s: number): Rgb => {
  const sorted = rgb.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const [min, mid, max] = sorted;
  const out = [...rgb] as Rgb;
  if (max.v > min.v) {
    out[mid.i] = (mid.v - min.v) * s / (max.v - min.v);
    out[max.i] = s;
  } else {
    out[mid.i] = 0;
    out[max.i] = 0;
  }
  out[min.i] = 0;
  return out;
};

const blendChannel = (mode: string, cb: number, cs: number) => {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'color-dodge': return cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'color-burn': return cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light': return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'soft-light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    default: return cs;
  }
};

const blendRgb = (mode: string, backdrop: Rgb, source: Rgb): Rgb => {
  switch (mode) {
    case 'hue': return setLum(setSat(source, sat(backdrop)), lum(backdrop));
    case 'saturation': return setLum(setSat(backdrop, sat(source)), lum(backdrop));
    case 'color': return setLum(source, lum(backdrop));
    case 'luminosity': return setLum(backdrop, lum(source));
    default: return backdrop.map((cb, i) => blendChannel(mode, cb, source[i])) as Rgb;
  }
};

const composite = (dst: number, src: number, mode: string, alpha: number) => {
  const [sr, sg, sb, saByte] = unpackRgba(src);
  const [dr, dg, db, daByte] = unpackRgba(dst);
  const sa = saByte / 255 * alpha;
  const da = daByte / 255;
  if (mode === 'destination-in') {
    const a = Math.round(da * sa * 255);
    return a ? packRgba(dr, dg, db, a) : 0;
  }
  const outA = sa + da * (1 - sa);
  if (!outA) return 0;
  const source: Rgb = [sr / 255, sg / 255, sb / 255];
  const backdrop: Rgb = [dr / 255, dg / 255, db / 255];
  const blended = blendRgb(mode, backdrop, source);
  const channels = blended.map((b, i) => {
    const cs = source[i], cb = backdrop[i];
    const value = (1 - da) * sa * cs + (1 - sa) * da * cb + sa * da * b;
    return value / outA;
  }) as Rgb;
  return packRgba(Math.round(channels[0] * 255), Math.round(channels[1] * 255), Math.round(channels[2] * 255), Math.round(outA * 255));
};

class SoftwareImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class SoftwareCanvasRenderingContext2D {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';

  constructor(readonly canvas: SoftwareCanvas) {}

  putImageData(image: SoftwareImageData, dx: number, dy: number) {
    const pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.byteLength / 4);
    for (let y = 0; y < image.height; y++) {
      const dy2 = y + dy;
      if (dy2 < 0 || dy2 >= this.canvas.height) continue;
      for (let x = 0; x < image.width; x++) {
        const dx2 = x + dx;
        if (dx2 >= 0 && dx2 < this.canvas.width)
          this.canvas.data[dy2 * this.canvas.width + dx2] = pixels[y * image.width + x];
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number) {
    const out = new Uint32Array(w * h);
    for (let row = 0; row < h; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= this.canvas.height) continue;
      for (let col = 0; col < w; col++) {
        const sx = x + col;
        if (sx >= 0 && sx < this.canvas.width) out[row * w + col] = this.canvas.data[sy * this.canvas.width + sx];
      }
    }
    return new SoftwareImageData(new Uint8ClampedArray(out.buffer), w, h);
  }

  drawImage(source: SoftwareCanvas, dx: number, dy: number) {
    const pixels = source.data.slice();
    for (let y = 0; y < source.height; y++) {
      const dy2 = y + dy;
      if (dy2 < 0 || dy2 >= this.canvas.height) continue;
      for (let x = 0; x < source.width; x++) {
        const dx2 = x + dx;
        if (dx2 < 0 || dx2 >= this.canvas.width) continue;
        const at = dy2 * this.canvas.width + dx2;
        this.canvas.data[at] = composite(this.canvas.data[at], pixels[y * source.width + x], this.globalCompositeOperation, this.globalAlpha);
      }
    }
  }
}

class SoftwareCanvas {
  readonly data: Uint32Array;
  private context: SoftwareCanvasRenderingContext2D | null = null;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint32Array(width * height);
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    return (this.context ??= new SoftwareCanvasRenderingContext2D(this)) as unknown as OffscreenCanvasRenderingContext2D;
  }
}

export const installSoftwareCanvas = () => {
  Object.assign(globalThis, { OffscreenCanvas: SoftwareCanvas, ImageData: SoftwareImageData });
};

export const canvasPixels = (canvas: OffscreenCanvas) => {
  const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint32Array(image.data.buffer.slice(0));
};
