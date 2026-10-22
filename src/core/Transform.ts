import type { Bitmap } from "~/core/Image";

/** Selection transformation helpers: affine placement of a source bitmap rendered with nearest-neighbour or RotSprite. */

export type Algorithm = 'fast' | 'rotsprite' | 'edge';

/** Affine placement of a source bitmap: its box (x, y, w, h in sprite pixels; w/h may be NEGATIVE meaning mirrored on that axis), rotated by `angle` degrees clockwise around the pivot (px, py) in sprite coordinates */
/** Box at (x, y) of w×h, sheared by `skew` degrees (horizontally), rotated by `angle` around (px, py) */
export type Placement = { x: number; y: number; w: number; h: number; angle: number; px: number; py: number; skew?: number; };

const shear = (p: Placement) => Math.tan(Math.max(-85, Math.min(85, p.skew ?? 0)) * Math.PI / 180);

const EPS = 1e-6;
/** Largest 8× intermediate image (pixels) before RotSprite falls back to fast */
const MAX_ROTSPRITE = 16 * 1024 * 1024;

/** cos/sin of a clockwise angle in degrees, exact for multiples of 90 */
function trig(angle: number): [number, number] {
  const a = ((angle % 360) + 360) % 360;
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const r = a * Math.PI / 180;
  return [Math.cos(r), Math.sin(r)];
}

function isRightAngle(angle: number) {
  return ((angle % 90) + 90) % 90 === 0;
}

/** Corners of the transformed box in sprite coordinates: [topLeft, topRight, bottomRight, bottomLeft] of the (possibly mirrored) source */
export function placementCorners(p: Placement): [number, number][] {
  const [c, s] = trig(p.angle);
  const t = shear(p);
  const pts: [number, number][] = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
  return pts.map(([x, y]) => {
    const dy = y - p.py, dx = x - p.px + t * dy;
    return [p.px + dx * c - dy * s, p.py + dx * s + dy * c];
  });
}

/** EPX/Scale2x upscale, comparing exact pixel values */
export function scale2x({ w, h, data }: Bitmap): Bitmap {
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  for (let y = 0; y < h; y++) {
    const ya = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      const p = data[y * w + x];
      const a = data[ya * w + x], d = data[yd * w + x];
      const c = data[y * w + xl], b = data[y * w + xr];
      let e0 = p, e1 = p, e2 = p, e3 = p;
      if (a !== d && c !== b) {
        if (c === a) e0 = a;
        if (a === b) e1 = b;
        if (c === d) e2 = c;
        if (d === b) e3 = d;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0; out[o + 1] = e1;
      out[o + W] = e2; out[o + W + 1] = e3;
    }
  }
  return { w: W, h: h * 2, data: out };
}

/** Corner-rounding 3× upscale (own design): each pixel becomes 3×3; a corner cell takes the colour of the two
 *  side neighbours touching it when they agree and differ from the pixel, unless that would bite into a
 *  one-pixel-thin line (the opposite side shows the same colour and the diagonal does not). Edges/centre stay. */
export function cornerRound3x({ w, h, data }: Bitmap): Bitmap {
  const W = w * 3, out = new Uint32Array(W * h * 3);
  const at = (x: number, y: number) => data[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = data[y * w + x];
      const n = at(x, y - 1), s = at(x, y + 1), wv = at(x - 1, y), e = at(x + 1, y);
      const corner = (a: number, b: number, oppA: number, oppB: number, diag: number) =>
        a === b && a !== p && (diag === a || (oppA !== a && oppB !== a)) ? a : p;
      const o = y * 3 * W + x * 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out[o + j * W + i] = p;
      out[o] = corner(n, wv, s, e, at(x - 1, y - 1));
      out[o + 2] = corner(n, e, s, wv, at(x + 1, y - 1));
      out[o + 2 * W] = corner(s, wv, n, e, at(x - 1, y + 1));
      out[o + 2 * W + 2] = corner(s, e, n, wv, at(x + 1, y + 1));
    }
  return { w: W, h: h * 3, data: out };
}

function upscaleMask(mask: Uint8Array, w: number, h: number, k: number) {
  const W = w * k, out = new Uint8Array(W * h * k);
  for (let y = 0; y < h * k; y++) {
    const row = ((y / k) | 0) * w;
    for (let x = 0; x < W; x++) out[y * W + x] = mask[row + ((x / k) | 0)];
  }
  return out;
}

/** Renders the source into a new bitmap covering the integer bounding box of the transformed quad.
 *  `srcMask` (optional, same size as src, 1 = pixel belongs to the selection) limits which source pixels are transferred; returned `mask` marks destination pixels that received a source pixel.
 *  Fast = nearest-neighbour inverse mapping; RotSprite = same mapping against a 3×Scale2x (8×) upscale.
 *  Pure translation / mirror (angle 0, |w|,|h| equal to source size) is bit-exact. */
export function renderPlacement(src: Bitmap, srcMask: Uint8Array | null, p: Placement, algo: Algorithm): { x: number; y: number; bmp: Bitmap; mask: Uint8Array; } {
  const empty = { x: Math.round(p.x), y: Math.round(p.y), bmp: { w: 0, h: 0, data: new Uint32Array(0) }, mask: new Uint8Array(0) };
  if (src.w === 0 || src.h === 0 || Math.abs(p.w) < EPS || Math.abs(p.h) < EPS) return empty;

  // Bit-exact fast path: translation with optional mirroring
  if (!p.skew && isRightAngle(p.angle) && trig(p.angle)[0] === 1 && Math.abs(p.w) === src.w && Math.abs(p.h) === src.h) {
    const { w, h } = src;
    const ox = Math.round(Math.min(p.x, p.x + p.w)), oy = Math.round(Math.min(p.y, p.y + p.h));
    const data = new Uint32Array(w * h), mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = p.h < 0 ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const si = sy * w + (p.w < 0 ? w - 1 - x : x);
        if (srcMask && !srcMask[si]) continue;
        const v = src.data[si];
        if (v >>> 24 === 0) continue;
        data[y * w + x] = v;
        mask[y * w + x] = 1;
      }
    }
    return { x: ox, y: oy, bmp: { w, h, data }, mask };
  }

  // Bounding box of the transformed quad
  const corners = placementCorners(p);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [cx, cy] of corners) {
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
  }
  const bx = Math.floor(x0 + EPS), by = Math.floor(y0 + EPS);
  const bw = Math.max(0, Math.ceil(x1 - EPS) - bx), bh = Math.max(0, Math.ceil(y1 - EPS) - by);
  if (bw === 0 || bh === 0) return { ...empty, x: bx, y: by };

  // Sampling source: 8× Scale2x for RotSprite (right angles are exact with nearest already)
  let k = 1, smp = src, smask = srcMask;
  if (algo === 'rotsprite' && (!isRightAngle(p.angle) || p.skew) && src.w * src.h * 64 <= MAX_ROTSPRITE) {
    k = 8;
    smp = scale2x(scale2x(scale2x(src)));
    smask = srcMask ? upscaleMask(srcMask, src.w, src.h, 8) : null;
  }
  // Edge-preserving: rounded 9× source for any scaling or free rotation; 90° turns and mirrors at full size stay exact
  else if (algo === 'edge' && (!isRightAngle(p.angle) || p.skew || Math.abs(p.w) !== src.w || Math.abs(p.h) !== src.h) && src.w * src.h * 81 <= MAX_ROTSPRITE) {
    k = 9;
    smp = cornerRound3x(cornerRound3x(src));
    smask = srcMask ? upscaleMask(srcMask, src.w, src.h, 9) : null;
  }

  const [c, s] = trig(p.angle);
  const t = shear(p);
  const fx = src.w * k / p.w, fy = src.h * k / p.h;
  const SW = smp.w, SH = smp.h;
  const data = new Uint32Array(bw * bh), mask = new Uint8Array(bw * bh);

  for (let y = 0; y < bh; y++) {
    const dy = by + y + 0.5 - p.py;
    for (let x = 0; x < bw; x++) {
      const dx = bx + x + 0.5 - p.px;
      // Inverse rotation (counter-clockwise) back into the unrotated box
      const ry = -dx * s + dy * c;
      const ux = p.px + dx * c + dy * s - t * ry - p.x;
      const uy = p.py + ry - p.y;
      const sx = Math.floor(ux * fx), sy = Math.floor(uy * fy);
      if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) continue;
      const si = sy * SW + sx;
      if (smask && !smask[si]) continue;
      const v = smp.data[si];
      if (v >>> 24 === 0) continue;
      data[y * bw + x] = v;
      mask[y * bw + x] = 1;
    }
  }
  return { x: bx, y: by, bmp: { w: bw, h: bh, data }, mask };
}
