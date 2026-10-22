/** Plain pixel buffer helpers. Pixels are packed as 0xAABBGGRR (ImageData order on little-endian). */

export type Rect = { x: number; y: number; w: number; h: number; };

export type Bitmap = {
  w: number;
  h: number;
  data: Uint32Array;
};

export function packRgba(r: number, g: number, b: number, a: number) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function unpackRgba(v: number): [number, number, number, number] {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
}

export function alphaOf(v: number) {
  return v >>> 24;
}

/** Source-over blending of two packed colors */
export function blendOver(dst: number, src: number) {
  const sa = src >>> 24;
  if (sa === 255) return src;
  if (sa === 0) return dst;
  const da = dst >>> 24;
  if (da === 0) return src;
  const sA = sa / 255, dA = da / 255;
  const oA = sA + dA * (1 - sA);
  const mix = (s: number, d: number) => Math.round((s * sA + d * dA * (1 - sA)) / oA);
  const [sr, sg, sb] = unpackRgba(src);
  const [dr, dg, db] = unpackRgba(dst);
  return packRgba(mix(sr, dr), mix(sg, dg), mix(sb, db), Math.round(oA * 255));
}

/** Euclidean RGBA distance normalized to 0..255 */
export function colorDistance(a: number, b: number) {
  if (a === b) return 0;
  const [ar, ag, ab, aa] = unpackRgba(a);
  const [br, bg, bb, ba] = unpackRgba(b);
  if (aa === 0 && ba === 0) return 0;
  return Math.sqrt(((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2 + (aa - ba) ** 2) / 4);
}

export function flipH({ w, h, data }: Bitmap): Bitmap {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out[y * w + x] = data[y * w + (w - 1 - x)];
  return { w, h, data: out };
}

export function flipV({ w, h, data }: Bitmap): Bitmap {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    out.set(data.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  return { w, h, data: out };
}

/** Rotate by quarter turns clockwise (1, 2 or 3) */
export function rotate(bmp: Bitmap, turns: number): Bitmap {
  turns = ((turns % 4) + 4) % 4;
  if (turns === 0) return bmp;
  if (turns === 2) return flipV(flipH(bmp));
  const { w, h, data } = bmp;
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [nx, ny] = turns === 1 ? [h - 1 - y, x] : [y, w - 1 - x];
      out[ny * h + nx] = data[y * w + x];
    }
  return { w: h, h: w, data: out };
}

export function scaleNearest({ w, h, data }: Bitmap, nw: number, nh: number): Bitmap {
  const out = new Uint32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(y * h / nh));
    for (let x = 0; x < nw; x++)
      out[y * nw + x] = data[sy * w + Math.min(w - 1, Math.floor(x * w / nw))];
  }
  return { w: nw, h: nh, data: out };
}

/** Copies `src` into a new w×h buffer, placing its top-left corner at (dx, dy) */
export function place(src: Bitmap, w: number, h: number, dx: number, dy: number) {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < src.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < w) out[ty * w + tx] = src.data[y * src.w + x];
    }
  }
  return out;
}

export function crop(src: Bitmap, r: Rect): Bitmap {
  return { w: r.w, h: r.h, data: place(src, r.w, r.h, -r.x, -r.y) };
}

/** Bounding box of non-transparent pixels, or null when empty */
export function opaqueBounds({ w, h, data }: Bitmap): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] >>> 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function toImageData({ w, h, data }: Bitmap) {
  // A copy of exactly these pixels (also when `data` is a view into a larger buffer)
  return new ImageData(new Uint8ClampedArray(data.slice().buffer), w, h);
}

export function bitmapToCanvas(bmp: Bitmap) {
  const can = new OffscreenCanvas(bmp.w, bmp.h);
  can.getContext('2d')!.putImageData(toImageData(bmp), 0, 0);
  return can;
}
