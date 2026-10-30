import { t } from "./i18n";
import { maskGray } from './LayerMaskOperations';
import { Color } from "~/core/Color";
import { alphaLockedPixel } from './SpriteModel';
import { signal } from "@preact/signals-react";
import { blendOver, packRgba, unpackRgba, type Bitmap } from "~/core/Image";
import { Mask, type SelectMode } from "~/core/Mask";
import { state, type ToolName } from "~/core/State";
import { referenceImage } from "~/core/Reference";
import { sliceKey, type Guide, type RefImage, type SliceKey } from "~/core/Sprite";
import { placementCorners, type Placement } from "~/core/Transform";

export type Point = [x: number, y: number];

/** Pointer position in sprite pixels plus modifiers */
export type ToolPointer = {
  x: number;
  y: number;
  /** Sub-pixel sprite coordinates */
  fx: number;
  fy: number;
  /** Viewport coordinates */
  sx: number;
  sy: number;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  space: boolean;
  secondary: boolean;
};

/** Live pen input: pressure 0..1 while a pen touches the canvas; `active` is false for mouse and touch */
export const pen = { active: false, pressure: 1 };

/** Updates the pen state from a pointer event (call on every pointer event of the canvas) */
export function trackPen(e: { pointerType?: string; pressure?: number; buttons?: number; }) {
  pen.active = e.pointerType === 'pen' && (e.buttons ?? 1) !== 0;
  if (pen.active) pen.pressure = Math.max(0, Math.min(1, e.pressure ?? 1));
}

/** Share 0..1 a pressure-mapped parameter gets now: 1 unless a pen is used and the parameter is mapped */
export function pressureFactor(param: 'size' | 'opacity' | 'density') {
  const m = state.pressure;
  if (!pen.active || !m[param]) return 1;
  const min = Math.max(0, Math.min(100, m.min)) / 100;
  return min + (1 - min) * pen.pressure;
}

export function pressureSize() {
  return Math.max(1, Math.round(state.brushSize * pressureFactor('size')));
}

/**
 * A tool interaction. Simple tools finish on pointer up; multi-click tools
 * (polygon, curve, polygonal lasso) stay alive and receive further `down` calls.
 */
export type Session = {
  move(p: ToolPointer): void;
  /** Return true when the session is finished */
  up(p: ToolPointer): boolean;
  down?(p: ToolPointer): void;
  hover?(p: ToolPointer): void;
  tick?(): void;
  finish?(): void;
  cancel?(): void;
  /** Outline drawn by the view while the session is alive (sprite pixel coords) */
  preview?: Point[] | null;
  previewClosed?: boolean;
  /** Selection shown while dragging a selection tool */
  previewMask?: Mask | null;
  info?: string;
  /** Hide marching ants while dragging pixels */
  hideAnts?: boolean;
};

export type ToolGroup = 'select' | 'draw' | 'erase' | 'pick' | 'fill' | 'lines' | 'shapes' | 'poly' | 'fx' | 'text' | 'slice' | 'move' | 'view';

export type ToolDef = {
  name: ToolName;
  group: ToolGroup;
  key: string;
  title: string;
  hint: string;
  /** Tools added at run time (extensions): the session they start, an icon url and a css cursor */
  session?: (p: ToolPointer) => Session | null;
  icon?: string;
  cursor?: string;
  /** Id of the extension that added it */
  ext?: string;
};

/** Every tool, built-in ones first; extensions add theirs with registerTool */
export const TOOLS: ToolDef[] = [
  { name: 'marquee', group: 'select', key: 'm', title: 'tool.marquee', hint: 'hint.tool.marquee' },
  { name: 'ellipseMarquee', group: 'select', key: 'm', title: 'tool.ellipseMarquee', hint: 'hint.tool.ellipseMarquee' },
  { name: 'lasso', group: 'select', key: 'm', title: 'tool.lasso', hint: 'hint.tool.lasso' },
  { name: 'polyLasso', group: 'select', key: 'm', title: 'tool.polyLasso', hint: 'hint.tool.polyLasso' },
  { name: 'wand', group: 'select', key: 'w', title: 'tool.wand', hint: 'hint.tool.wand' },
  { name: 'pencil', group: 'draw', key: 'b', title: 'tool.pencil', hint: 'hint.tool.pencil' },
  { name: 'spray', group: 'draw', key: 'b', title: 'tool.spray', hint: 'hint.tool.spray' },
  { name: 'eraser', group: 'erase', key: 'e', title: 'tool.eraser', hint: 'hint.tool.eraser' },
  { name: 'picker', group: 'pick', key: 'i', title: 'tool.picker', hint: 'hint.tool.picker' },
  { name: 'fill', group: 'fill', key: 'g', title: 'tool.fill', hint: 'hint.tool.fill' },
  { name: 'gradient', group: 'fill', key: 'g', title: 'tool.gradient', hint: 'hint.tool.gradient' },
  { name: 'line', group: 'lines', key: 'l', title: 'tool.line', hint: 'hint.tool.line' },
  { name: 'curve', group: 'lines', key: 'l', title: 'tool.curve', hint: 'hint.tool.curve' },
  { name: 'rect', group: 'shapes', key: 'u', title: 'tool.rect', hint: 'hint.tool.rect' },
  { name: 'ellipse', group: 'shapes', key: 'u', title: 'tool.ellipse', hint: 'hint.tool.ellipse' },
  { name: 'contour', group: 'poly', key: 'p', title: 'tool.contour', hint: 'hint.tool.contour' },
  { name: 'polygon', group: 'poly', key: 'p', title: 'tool.polygon', hint: 'hint.tool.polygon' },
  { name: 'blur', group: 'fx', key: 'r', title: 'tool.blur', hint: 'hint.tool.blur' },
  { name: 'jumble', group: 'fx', key: 'r', title: 'tool.jumble', hint: 'hint.tool.jumble' },
  { name: 'text', group: 'text', key: 't', title: 'tool.text', hint: 'hint.tool.text' },
  { name: 'slice', group: 'slice', key: 'c', title: 'tool.slice', hint: 'hint.tool.slice' },
  { name: 'move', group: 'move', key: 'v', title: 'tool.move', hint: 'hint.tool.move' },
  { name: 'hand', group: 'view', key: 'h', title: 'tool.hand', hint: 'hint.tool.hand' },
  { name: 'zoom', group: 'view', key: 'z', title: 'tool.zoom', hint: 'hint.tool.zoom' },
];

export const toolDef = (name: ToolName) => TOOLS.find(t => t.name === name)!;

/** Bumped whenever a tool is added or removed, so the toolbar can re-render */
export const toolsVersion = signal(0);

/** Adds a tool (its `name` must be unique); returns the function that removes it */
export function registerTool(def: ToolDef) {
  const old = TOOLS.findIndex(t => t.name === def.name);
  if (old >= 0) TOOLS.splice(old, 1, def);
  else TOOLS.push(def);
  toolsVersion.value++;
  return () => {
    const i = TOOLS.indexOf(def);
    if (i < 0) return;
    TOOLS.splice(i, 1);
    toolsVersion.value++;
    if (state.tool === def.name) state.tool = 'pencil';
  };
}

export const PAINT_TOOLS: ToolName[] = ['pencil', 'spray', 'line', 'curve', 'rect', 'ellipse', 'contour', 'polygon', 'fill', 'gradient'];
export const EFFECT_TOOLS: ToolName[] = ['eraser', 'blur', 'jumble'];
export const SELECT_TOOLS: ToolName[] = ['marquee', 'ellipseMarquee', 'lasso', 'polyLasso', 'wand'];

// Geometry

export function linePoints([x0, y0]: Point, [x1, y1]: Point, out: Point[] = []) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (; ;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Two-point drag with modifiers: Shift squares, Ctrl/Alt mirrors around the press point */
function boxFrom(start: Point, end: Point, square: boolean, center: boolean): [Point, Point] {
  let dx = end[0] - start[0], dy = end[1] - start[1];
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  if (center) return [[start[0] - dx, start[1] - dy], [start[0] + dx, start[1] + dy]];
  return [start, [start[0] + dx, start[1] + dy]];
}

/** Is (x, y) inside the box [ax..bx]×[ay..by] with corners rounded by `r`? */
export function inRoundRect(x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number) {
  if (x < ax || x > bx || y < ay || y > by) return false;
  if (r <= 0) return true;
  // Quarter circles centered `r` pixels in from each corner
  const cx = x < ax + r ? ax + r : x > bx - r ? bx - r : x;
  const cy = y < ay + r ? ay + r : y > by - r ? by - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.5) ** 2;
}

function rectPoints([x0, y0]: Point, [x1, y1]: Point, filled: boolean, radius = 0) {
  const out: Point[] = [];
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const r = Math.min(radius, Math.floor((bx - ax) / 2), Math.floor((by - ay) / 2));
  const inside = (x: number, y: number) => inRoundRect(x, y, ax, ay, bx, by, r);
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++)
      if (inside(x, y) && (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)))
        out.push([x, y]);
  return out;
}

/** Ellipse inscribed into the box; outline pixels are those with an outside 4-neighbour */
function ellipsePoints([x0, y0]: Point, [x1, y1]: Point, filled: boolean) {
  const out: Point[] = [];
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))
        out.push([x, y]);
    }
  return out;
}

/** A filled shape turned by `angle` degrees around its box center; outline = pixels with an outside neighbour */
function rotatedShape(filled: Point[], a: Point, b: Point, angle: number, fill: boolean): Point[] {
  const inside = new Set(filled.map(([x, y]) => `${x},${y}`));
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 2;
  const rad = -angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  // Sample the unturned shape for every pixel of the turned bounding circle
  const has = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy;
    return inside.has(`${Math.round(cx + dx * c - dy * s)},${Math.round(cy + dx * s + dy * c)}`);
  };
  const out: Point[] = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (has(x, y) && (fill || !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1))) out.push([x, y]);
  return out;
}

/** Snaps a line to the directions that give clean pixel steps: 1:0, 2:1, 1:1, 1:2, 0:1 */
function snapLine([x0, y0]: Point, [x1, y1]: Point): Point {
  const dx = x1 - x0, dy = y1 - y0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  const steps: [number, number][] = [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1]];
  let best = steps[0], bestDiff = Infinity;
  const angle = Math.atan2(ay, ax);
  for (const s of steps) {
    const d = Math.abs(Math.atan2(s[1], s[0]) - angle);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  // Length along the chosen direction, in whole steps
  const n = Math.round((ax * best[0] + ay * best[1]) / (best[0] ** 2 + best[1] ** 2));
  return [x0 + sx * best[0] * n, y0 + sy * best[1] * n];
}

function bezierPoints(a: Point, c1: Point, c2: Point, b: Point) {
  const out: Point[] = [];
  const len = Math.hypot(c1[0] - a[0], c1[1] - a[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(b[0] - c2[0], b[1] - c2[1]);
  const steps = Math.max(2, Math.ceil(len));
  let prev: Point = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const p: Point = [
      Math.round(u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0]),
      Math.round(u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]),
    ];
    linePoints(prev, p, out);
    prev = p;
  }
  return out;
}

/** Nearest grid vertex when snapping is on */
export function snapGrid([x, y]: Point): Point {
  if (!state.snapToGrid) return [x, y];
  const ts = state.sprite.tileset;
  const { gridW, gridH, gridX, gridY } = ts ? { gridW: ts.tw, gridH: ts.th, gridX: 0, gridY: 0 } : state.prefs;
  return [Math.round((x - gridX) / gridW) * gridW + gridX, Math.round((y - gridY) / gridH) * gridH + gridY];
}

/** How close (in screen pixels) a guide has to be to catch a point */
const SNAP_PX = 6;

/** Lines on one axis that tools snap to: guides, canvas edges and center, the active cel's edges */
function snapTargets(axis: 'x' | 'y', withCel: boolean) {
  const { sprite } = state;
  const size = axis === 'x' ? sprite.width : sprite.height;
  const out = sprite.guides.filter(g => g.axis === axis).map(g => g.pos);
  out.push(0, size);
  if (size % 2 === 0) out.push(size / 2);
  const cel = withCel ? sprite.getCel() : null;
  if (cel) out.push(axis === 'x' ? cel.x : cel.y, axis === 'x' ? cel.x + cel.w : cel.y + cel.h);
  return out;
}

/** Nearest snap line to the sub-pixel coordinate `v`, or null when none is within reach */
export function nearLine(axis: 'x' | 'y', v: number, withCel = true): number | null {
  if (!state.snapToGuides) return null;
  let best: number | null = null, dist = SNAP_PX / state.zoom;
  for (const t of snapTargets(axis, withCel)) {
    const d = Math.abs(v - t);
    if (d <= dist) { dist = d; best = t; }
  }
  return best;
}

/** Shows which lines the current drag snapped to */
export function markSnap(lines: Guide[]) {
  if (lines.length || state.snapLines.length) state.snapLines = lines;
}

/**
 * Box corner pixel for a pointer at (fx, fy): a nearby line becomes the box edge on the side facing
 * `other` (the opposite corner). With `vertex` the corner is a grid vertex and lands on the line itself.
 */
function snapCorner(fx: number, fy: number, [x, y]: Point, other: Point | null, lines: Guide[], vertex = false): Point {
  const one = (axis: 'x' | 'y', f: number, v: number, o: number | null) => {
    const g = nearLine(axis, f);
    if (g === null) return v;
    lines.push({ axis, pos: g });
    return vertex || o === null || o >= g ? g : g - 1;
  };
  return [one('x', fx, x, other?.[0] ?? null), one('y', fy, y, other?.[1] ?? null)];
}

/** Shift that puts the nearer edge of the span [lo, hi] onto a nearby line (0 when none) */
function snapShift(axis: 'x' | 'y', lo: number, hi: number, lines: Guide[]) {
  const a = nearLine(axis, lo, false), b = nearLine(axis, hi, false);
  const da = a === null ? Infinity : a - lo, db = b === null ? Infinity : b - hi;
  const d = Math.abs(da) <= Math.abs(db) ? da : db;
  if (!Number.isFinite(d)) return 0;
  lines.push({ axis, pos: d === da ? a! : b! });
  return d;
}

/** Pixel offsets of the current brush relative to the cursor pixel */
export function brushOffsets(size = state.brushSize, shape = state.brushShape, angle = state.brushAngle): Point[] {
  if (size <= 1) return [[0, 0]];
  const out: Point[] = [];
  const half = Math.floor(size / 2);
  if (shape === 'line') {
    const a = angle * Math.PI / 180;
    const dx = Math.cos(a) * (size - 1) / 2, dy = -Math.sin(a) * (size - 1) / 2;
    return linePoints([Math.round(-dx), Math.round(-dy)], [Math.round(dx), Math.round(dy)]);
  }
  if (shape === 'square' && angle % 90 !== 0) {
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), r = size / 2;
    const ext = Math.ceil(r * Math.SQRT2) + 1;
    for (let y = -ext; y <= ext; y++)
      for (let x = -ext; x <= ext; x++) {
        const u = x * c - y * s, v = x * s + y * c;
        if (Math.abs(u) <= r - 0.25 && Math.abs(v) <= r - 0.25) out.push([x, y]);
      }
    return out;
  }
  const r = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (shape === 'square' || size <= 2 || (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r)
        out.push([x - half, y - half]);
  return out;
}

/**
 * A pixel and all its mirror images. Mirrors combine into a group: one straight axis and one
 * diagonal together give all 8 copies (every flip and quarter turn around the crossing point).
 */
export function symmetryPoints(x: number, y: number): Point[] {
  const ax = state.symAxisX, ay = state.symAxisY;
  // Work with pixel centers so mirrored pixels line up exactly
  const flips: ((p: Point) => Point)[] = [];
  if (state.symmetryX) flips.push(([px, py]) => [2 * ax - px, py]);
  if (state.symmetryY) flips.push(([px, py]) => [px, 2 * ay - py]);
  if (state.symmetryD1) flips.push(([px, py]) => [ax + (py - ay), ay + (px - ax)]);
  if (state.symmetryD2) flips.push(([px, py]) => [ax - (py - ay), ay - (px - ax)]);
  const seen = new Set<string>();
  const out: Point[] = [];
  const queue: Point[] = [[x + 0.5, y + 0.5]];
  while (queue.length && out.length < 8) {
    const p = queue.shift()!;
    const q: Point = [Math.round(p[0] - 0.5), Math.round(p[1] - 0.5)];
    const key = `${q[0]},${q[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    for (const f of flips) queue.push(f([q[0] + 0.5, q[1] + 0.5]));
  }
  return out;
}

// Painting

function colorValue(color: Color) {
  const [r, g, b, a] = color.rgba;
  return packRgba(r, g, b, Math.round(a * 255));
}

function withAlpha(v: number, a: number) {
  return ((v & 0xffffff) | (Math.round(a) << 24)) >>> 0;
}

/** Linear interpolation of all channels including alpha (partial erase) */
function merge(a: number, b: number, t: number) {
  const [ar, ag, ab, aa] = unpackRgba(a), [br, bg, bb, ba] = unpackRgba(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return packRgba(m(ar, br), m(ag, bg), m(ab, bb), m(aa, ba));
}

/** Threshold matrix of size n (power of two), values 0..n²-1 spread evenly in space */
function thresholdMatrix(n: number): number[][] {
  if (n === 1) return [[0]];
  const m = thresholdMatrix(n / 2), h = n / 2;
  const out = Array.from({ length: n }, () => new Array<number>(n));
  const quad = [[0, 2], [3, 1]];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[y][x] = 4 * m[y % h][x % h] + quad[(y / h) | 0][(x / h) | 0];
  return out;
}
const MATRICES: Record<number, number[][]> = { 2: thresholdMatrix(2), 4: thresholdMatrix(4) };

/**
 * Paint pattern cell at canvas (x, y): true → primary, false → secondary, null → no pattern.
 * Tied to canvas coordinates so overlapping strokes and fills stay aligned.
 */
export function patternCell(x: number, y: number): boolean | null {
  const mod = (v: number, n: number) => ((v % n) + n) % n;
  switch (state.paintPattern) {
    case 'checker': return ((x + y) & 1) === 0;
    case 'ordered2':
    case 'ordered4': {
      const n = state.paintPattern === 'ordered2' ? 2 : 4;
      const level = Math.round(state.patternDensity / 100 * n * n);
      return MATRICES[n][mod(y, n)][mod(x, n)] < level;
    }
    case 'custom': {
      const p = state.patternBits;
      return p ? p.bits[mod(y, p.h) * p.w + mod(x, p.w)] === 1 : null;
    }
    default: return null;
  }
}

/** Palette ramp used by the shading ink: the selected palette entries, else the whole palette */
function shadeRamp() {
  const pal = state.palette.map(hex => colorValue(Color.fromHex(hex)));
  const sel = state.paletteSelection.filter(i => i < pal.length);
  return sel.length >= 2 ? { colors: sel.map(i => pal[i]), wrap: false } : { colors: pal, wrap: true };
}

type PaintMode =
  /** Each pixel is computed once from the original: overlapping dabs don't build up */
  | 'stroke'
  /** Dabs read previous dabs (spray, scatter) */
  | 'overlap';

/** Paints into the current cel, honoring selection, symmetry and wrap-around */
class Painter {
  sprite = state.sprite;
  maskChannel = this.sprite.editingMask;
  layer = this.sprite.layer;
  frame = this.sprite.frame;
  w = this.sprite.width;
  h = this.sprite.height;
  cel: Uint32Array;
  origin: Uint32Array;
  painted: Uint8Array;
  mask = this.sprite.mask;
  primary: number;
  secondary: number;
  ramp = shadeRamp();
  background: boolean;
  /** Custom brush pattern anchor */
  anchor: Point | null = null;
  /** Opacity follows pen pressure (freehand tools) */
  pressured = false;

  constructor(public kind: 'paint' | 'erase', public alt: boolean, label: string, public mode: PaintMode = 'stroke', public dry = false) {
    if (!dry) this.sprite.checkpoint(label);
    // Strokes work on the canvas window of the cel; putCanvas keeps whatever lies outside it
    const cel = this.maskChannel ? this.sprite.layerMaskPixels() : this.sprite.canvasPixels();
    this.cel = cel;
    this.origin = cel.slice();
    this.painted = new Uint8Array(cel.length);
    const gray = (pixel: number) => (0xff000000 | maskGray(pixel) * 0x10101) >>> 0;
    const a = this.maskChannel ? gray(colorValue(state.colorA)) : colorValue(state.colorA);
    const b = this.maskChannel ? gray(colorValue(state.colorB)) : colorValue(state.colorB);
    [this.primary, this.secondary] = alt ? [b, a] : [a, b];
    this.background = !this.maskChannel && !!this.sprite.current?.background;
  }

  /** Sprite index for (x, y) honoring wrap-around and the selection, or -1 */
  index(x: number, y: number) {
    const { w, h } = this;
    if (state.tiledX) x = ((x % w) + w) % w;
    if (state.tiledY) y = ((y % h) + h) % h;
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const i = y * w + x;
    return this.mask && !this.mask.data[i] ? -1 : i;
  }

  /** (x, y) and its mirrors across the symmetry axes */
  targets(x: number, y: number, out: [number, number, number][] = []) {
    for (const [tx, ty] of symmetryPoints(x, y)) {
      const i = this.index(tx, ty);
      if (i >= 0 && !out.some(t => t[0] === i)) out.push([i, tx, ty]);
    }
    return out;
  }

  src(i: number) {
    return this.mode === 'overlap' ? this.cel[i] : this.origin[i];
  }

  ink(i: number, x: number, y: number) {
    const src = this.src(i);
    const pf = this.pressured ? pressureFactor('opacity') : 1;
    const op = state.opacity / 255 * pf;

    if (this.maskChannel && this.kind === 'erase') return merge(src, 0xff000000, op);
    if (this.kind === 'erase') {
      if (this.alt) {
        // Right button: primary color pixels become the secondary color
        const same = (src >>> 24) === 0 ? (this.primary >>> 24) === 0 : (src & 0xffffff) === (this.primary & 0xffffff);
        return same ? merge(src, this.secondary, op) : src;
      }
      if (this.background) return op >= 1 ? this.secondary : blendOver(src, withAlpha(this.secondary, 255 * op));
      return merge(src, src & 0xffffff, op);
    }

    const brush = state.customBrush;
    if (brush) {
      const a = this.anchor ?? [x, y];
      const bx = ((x - a[0]) % brush.bmp.w + brush.bmp.w) % brush.bmp.w;
      const by = ((y - a[1]) % brush.bmp.h + brush.bmp.h) % brush.bmp.h;
      const v = brush.bmp.data[by * brush.bmp.w + bx];
      return blendOver(src, withAlpha(v, (v >>> 24) * op));
    }

    const cell = state.ink === 'shade' ? null : patternCell(x, y);
    const v = cell === false ? this.secondary : this.primary;
    switch (state.ink) {
      case 'simple':
        // Opaque colors replace, translucent ones blend at their own alpha, transparent erases
        if (!(v >>> 24)) return this.background ? src : 0;
        // A light pen touch blends even with this ink
        if (pf < 1) return blendOver(src, withAlpha(v, (v >>> 24) * pf));
        return (v >>> 24) === 255 ? v : blendOver(src, v);
      case 'copy':
        return this.background ? withAlpha(v, 255) : v;
      case 'lockAlpha': {
        const a = src >>> 24;
        if (!a) return src;
        return withAlpha(blendOver(withAlpha(src, 255), withAlpha(v, (v >>> 24) * op)), a);
      }
      case 'shade': {
        const { colors, wrap } = this.ramp;
        const k = colors.indexOf(src);
        if (k < 0 || src >>> 24 === 0) return src;
        const n = k + (this.alt ? -1 : 1);
        if (wrap) return colors[(n + colors.length) % colors.length];
        return colors[Math.max(0, Math.min(colors.length - 1, n))];
      }
      default:
        return blendOver(src, withAlpha(v, (v >>> 24) * op));
    }
  }

  pixel(x: number, y: number) {
    for (const [i, tx, ty] of this.targets(x, y)) {
      if (this.mode === 'stroke') {
        if (this.painted[i]) continue;
        this.painted[i] = 1;
      }
      const next = this.ink(i, tx, ty);
      this.cel[i] = !this.maskChannel && this.sprite.current?.lockAlpha ? alphaLockedPixel(this.origin[i], next) : next;
    }
  }

  stamp(points: Point[], offsets: Point[] = brushOffsets()) {
    const b = state.customBrush;
    if (b && this.kind === 'paint') {
      const shape: Point[] = [];
      const hx = Math.floor(b.bmp.w / 2), hy = Math.floor(b.bmp.h / 2);
      for (let y = 0; y < b.bmp.h; y++)
        for (let x = 0; x < b.bmp.w; x++)
          if (b.bmp.data[y * b.bmp.w + x] >>> 24) shape.push([x - hx, y - hy]);
      for (const [px, py] of points) {
        // The pattern follows each dab, starts at the stroke start, or stays where it was captured
        if (b.align === 'dab' || !this.anchor)
          this.anchor = b.align === 'source' ? [b.ox, b.oy] : [px - hx, py - hy];
        for (const [ox, oy] of shape) this.pixel(px + ox, py + oy);
      }
    } else {
      for (const [px, py] of points)
        for (const [ox, oy] of offsets)
          this.pixel(px + ox, py + oy);
    }
    // A dry run (brush preview) works on a copy and must not mark the sprite as changed
    if (!this.dry) this.commit();
  }

  commit() {
    if (this.maskChannel) this.sprite.putLayerMaskPixels(this.cel, this.layer);
    else this.sprite.putCanvas(this.cel, this.layer, this.frame);
  }

  reset() {
    this.cel.set(this.origin);
    this.painted.fill(0);
    this.anchor = null;
  }
}

/** Freehand path with optional pixel-perfect cleanup, re-rendered whole when cleanup is on */
function freehand(p: ToolPointer, kind: 'paint' | 'erase', label: string): Session {
  const painter = new Painter(kind, p.secondary, label);
  painter.pressured = true;
  const perfect = state.pixelPerfect && state.brushSize === 1 && !state.customBrush;
  const path: Point[] = [];

  const render = () => {
    painter.reset();
    // Skip "L" corners: a pixel touching both neighbours orthogonally while they touch diagonally
    const keep: Point[] = [];
    for (let i = 0; i < path.length; i++) {
      const a = keep[keep.length - 1], c = path[i], b = path[i + 1];
      if (a && b && (a[0] === c[0] || a[1] === c[1]) && (b[0] === c[0] || b[1] === c[1]) && a[0] !== b[0] && a[1] !== b[1]) {
        // Drop the corner and keep the next pixel unconditionally
        keep.push(b);
        i++;
        continue;
      }
      keep.push(c);
    }
    painter.stamp(keep, [[0, 0]]);
  };

  const add = (to: Point) => {
    const from = path[path.length - 1];
    for (const pt of from ? linePoints(from, to).slice(1) : [to]) {
      const last = path[path.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) path.push(pt);
    }
  };

  if (p.shift && lastPoint) path.push(lastPoint);
  add([p.x, p.y]);
  if (perfect) render();
  else painter.stamp(path, brushOffsets(pressureSize()));

  // Stabilizer: the brush point follows the pointer on a string, covering 1/strength of the gap per move
  let sx = p.x, sy = p.y;
  const follow = (q: ToolPointer): Point => {
    if (!state.stabilizer) return [q.x, q.y];
    sx += (q.x - sx) / Math.max(1, state.stabilizer / 4);
    sy += (q.y - sy) / Math.max(1, state.stabilizer / 4);
    return [Math.round(sx), Math.round(sy)];
  };

  return {
    move(q) {
      const before = path.length;
      add(follow(q));
      if (path.length === before) return;
      if (perfect) render();
      else painter.stamp(path.slice(Math.max(0, before - 1)), brushOffsets(pressureSize()));
    },
    up() {
      lastPoint = path[path.length - 1] ?? null;
      return true;
    },
  };
}

/** End of the previous freehand stroke, for Shift+click straight lines */
let lastPoint: Point | null = null;

/**
 * Two-point shapes: re-rendered from the original on every move so modifiers can change live.
 * Space held while dragging moves the whole shape instead of resizing it.
 */
function twoPoint(p: ToolPointer, painter: Painter, draw: (a: Point, b: Point, p: ToolPointer) => { points: Point[]; offsets?: Point[]; }, info: (a: Point, b: Point) => string): Session {
  let start: Point = [p.x, p.y];
  let end: Point = [p.x, p.y];
  let moving: Point | null = null;
  // Where the press was, so the start corner can snap to the side the drag goes
  let pressed: { f: Point; raw: Point; } | null = { f: [p.fx, p.fy], raw: [p.x, p.y] };
  const session: Session = {
    move(q) {
      const lines: Guide[] = [];
      if (pressed && !q.space) start = snapCorner(pressed.f[0], pressed.f[1], pressed.raw, [q.x, q.y], lines);
      if (q.space) {
        pressed = null;
        if (!moving) moving = [q.x, q.y];
        const dx = q.x - moving[0], dy = q.y - moving[1];
        start = [start[0] + dx, start[1] + dy];
        end = [end[0] + dx, end[1] + dy];
        moving = [q.x, q.y];
      } else {
        moving = null;
        end = snapCorner(q.fx, q.fy, [q.x, q.y], start, lines);
      }
      markSnap(lines);
      painter.reset();
      const { points, offsets } = draw(start, end, q);
      painter.stamp(points, offsets);
      session.info = info(start, end);
    },
    up: () => true,
  };
  session.move(p);
  return session;
}

function curveSession(p: ToolPointer): Session {
  const painter = new Painter('paint', p.secondary, 'Curve');
  const a: Point = [p.x, p.y];
  let b: Point = a, c1: Point = a, c2: Point = a;
  let stage = 0;

  const draw = () => {
    painter.reset();
    painter.stamp(stage === 0 ? linePoints(a, b) : bezierPoints(a, c1, c2, b));
  };
  draw();

  const session: Session = {
    move(q) {
      const pt: Point = [q.x, q.y];
      if (stage === 0) b = pt;
      if (stage === 1) c1 = c2 = pt;
      if (stage === 2) c2 = pt;
      session.preview = stage ? [a, c1, c2, b] : null;
      draw();
    },
    down(q) { session.move(q); },
    up() {
      if (stage === 0) { c1 = a; c2 = b; }
      stage++;
      state.hint = stage === 1 ? 'Drag to bend the curve' : stage === 2 ? 'Drag to adjust the second bend' : '';
      return stage > 2;
    },
    finish() { stage = 3; state.hint = ''; },
  };
  return session;
}

/**
 * Polygon-style input: press–drag–release adds an edge; clicking without moving,
 * double clicking, clicking the first point or Enter closes the shape.
 */
function multiClick(p: ToolPointer, onUpdate: (points: Point[], done: boolean) => void): Session {
  const points: Point[] = [[p.x, p.y], [p.x, p.y]];
  let pressAt: Point = [p.x, p.y];
  let done = false;

  const close = () => {
    done = true;
    session.preview = null;
    const clean = points.filter((pt, i) => i === 0 || pt[0] !== points[i - 1][0] || pt[1] !== points[i - 1][1]);
    onUpdate(clean, true);
    state.hint = '';
  };

  const session: Session = {
    preview: points,
    previewClosed: false,
    hover(q) {
      if (done) return;
      points[points.length - 1] = [q.x, q.y];
      onUpdate(points, false);
    },
    move(q) { session.hover!(q); },
    down(q) {
      pressAt = [q.x, q.y];
      const first = points[0];
      if (points.length > 3 && Math.abs(q.x - first[0]) <= 1 && Math.abs(q.y - first[1]) <= 1) return close();
      points.push([q.x, q.y]);
    },
    up(q) {
      if (done) return true;
      // Releasing where the edge started (no drag) finishes the shape
      const prev = points[points.length - 2];
      if (points.length > 2 && q.x === pressAt[0] && q.y === pressAt[1] && prev[0] === q.x && prev[1] === q.y) {
        points.pop();
        close();
        return true;
      }
      state.hint = 'Drag the next edge; click without moving or press Enter to close';
      return false;
    },
    finish() { if (!done) close(); },
  };
  return session;
}

function fillPolygon(painter: Painter, points: Point[]) {
  painter.reset();
  const { sprite } = state;
  const m = Mask.polygon(sprite.width, sprite.height, points);
  const pts: Point[] = [];
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) pts.push([i % sprite.width, (i / sprite.width) | 0]);
  painter.stamp(pts, [[0, 0]]);
}

/** Every channel within ±tolerance; two fully transparent pixels always match */
function similar(a: number, b: number, tol: number) {
  if (a === b) return true;
  const aa = a >>> 24, ba = b >>> 24;
  if (!aa && !ba) return true;
  if (!tol) return false;
  const [ar, ag, ab] = unpackRgba(a), [br, bg, bb] = unpackRgba(b);
  return Math.abs(ar - br) <= tol && Math.abs(ag - bg) <= tol && Math.abs(ab - bb) <= tol && Math.abs(aa - ba) <= tol;
}

/** Grid cell containing (x, y), when fills should stop at grid lines */
function gridCell(x: number, y: number) {
  if (!state.stopAtGrid || !state.showGrid) return null;
  const { gridW, gridH, gridX, gridY } = state.prefs;
  const cx = Math.floor((x - gridX) / gridW) * gridW + gridX;
  const cy = Math.floor((y - gridY) / gridH) * gridH + gridY;
  return { x0: cx, y0: cy, x1: cx + gridW, y1: cy + gridH };
}

/** Pixels similar to the one at (x, y); contiguous fills also stop at the selection edge */
function regionMask(x: number, y: number, ref: Uint32Array, respectSelection: boolean) {
  const { sprite } = state;
  const { width: w, height: h } = sprite;
  const target = ref[y * w + x];
  const tol = state.tolerance;
  const cell = gridCell(x, y);
  const sel = respectSelection ? sprite.mask : null;
  const allowed = (i: number) => {
    const px = i % w, py = (i / w) | 0;
    if (cell && (px < cell.x0 || py < cell.y0 || px >= cell.x1 || py >= cell.y1)) return false;
    return !sel || sel.data[i] === 1;
  };
  const data = new Uint8Array(w * h);
  if (!state.contiguous) {
    for (let i = 0; i < data.length; i++) if (allowed(i) && similar(ref[i], target, tol)) data[i] = 1;
    return new Mask(w, h, data);
  }
  const stack = [y * w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (data[i] || !allowed(i) || !similar(ref[i], target, tol)) continue;
    data[i] = 1;
    const cx = i % w, cy = (i / w) | 0;
    if (cx > 0) stack.push(i - 1);
    if (cx < w - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - w);
    if (cy < h - 1) stack.push(i + w);
    if (state.fillDiagonal) {
      if (cx > 0 && cy > 0) stack.push(i - w - 1);
      if (cx < w - 1 && cy > 0) stack.push(i - w + 1);
      if (cx > 0 && cy < h - 1) stack.push(i + w - 1);
      if (cx < w - 1 && cy < h - 1) stack.push(i + w + 1);
    }
  }
  return new Mask(w, h, data);
}

function referencePixels() {
  const { sprite } = state;
  if (sprite.editingMask) return sprite.layerMaskPixels();
  if (!state.sampleAll) return sprite.getBitmap().data;
  const ctx = sprite.render().getContext('2d')!;
  return new Uint32Array(ctx.getImageData(0, 0, sprite.width, sprite.height).data.buffer);
}

// Selection

function selectMode(p: ToolPointer): SelectMode {
  if (p.secondary) return 'subtract';
  if (p.shift && p.alt) return 'subtract';
  if (p.shift) return 'add';
  return state.selectMode;
}

function applySelection(mask: Mask, mode: SelectMode) {
  const { sprite } = state;
  const base = sprite.mask ?? new Mask(sprite.width, sprite.height);
  sprite.setMask(mode === 'replace' ? mask : base.combine(mask, mode));
}

/** Select the grid cell under the pointer (double click with a selection tool) */
export function selectGridCell(p: ToolPointer) {
  const { sprite } = state;
  const { gridW, gridH, gridX, gridY } = state.prefs;
  const x = Math.floor((p.x - gridX) / gridW) * gridW + gridX;
  const y = Math.floor((p.y - gridY) / gridH) * gridH + gridY;
  applySelection(Mask.rect(sprite.width, sprite.height, { x, y, w: gridW, h: gridH }), selectMode(p));
}

function marqueeSession(p: ToolPointer, kind: 'rect' | 'ellipse'): Session {
  const { sprite } = state;
  const mode = selectMode(p);
  let start = snapGrid([p.x, p.y]);
  let last: Point = start;
  let moving: Point | null = null;
  let moved = false;
  const pressed: Point = start, pressedF: Point = [p.fx, p.fy];
  let spaced = false;
  const build = (q: ToolPointer) => {
    const lines: Guide[] = [];
    const grid = state.snapToGrid;
    let end = snapGrid([q.x, q.y]);
    if (!q.space) {
      if (!spaced) start = snapCorner(pressedF[0], pressedF[1], pressed, end, lines, grid);
      end = snapCorner(q.fx, q.fy, end, start, lines, grid);
    }
    markSnap(lines);
    if (q.space) {
      spaced = true;
      // Space moves the whole box instead of resizing it
      if (!moving) moving = end;
      const dx = end[0] - moving[0], dy = end[1] - moving[1];
      moving = end;
      start = [start[0] + dx, start[1] + dy];
      end = [last[0] + dx, last[1] + dy];
    } else moving = null;
    last = end;
    // Shift picks "add" at press time; later it squares the box
    const [a, b] = boxFrom(start, end, q.shift && mode === state.selectMode, q.ctrl);
    const snapped = state.snapToGrid;
    const r = {
      x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
      // Without snapping both pressed pixels are included; snapped boxes cover whole cells
      w: Math.abs(b[0] - a[0]) + (snapped ? 0 : 1), h: Math.abs(b[1] - a[1]) + (snapped ? 0 : 1),
    };
    session.info = `${r.x}, ${r.y} · ${r.w}×${r.h}`;
    if (kind === 'rect' && state.cornerRadius > 0 && r.w > 0 && r.h > 0) {
      const rad = Math.min(state.cornerRadius, Math.floor((r.w - 1) / 2), Math.floor((r.h - 1) / 2));
      return Mask.fromFn(sprite.width, sprite.height, (x, y) => inRoundRect(x, y, r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, rad));
    }
    return kind === 'rect' ? Mask.rect(sprite.width, sprite.height, r) : Mask.ellipse(sprite.width, sprite.height, r);
  };
  const session: Session = {
    previewMask: null,
    move(q) {
      moved ||= q.x !== start[0] || q.y !== start[1];
      if (moved) session.previewMask = build(q);
    },
    up(q) {
      session.previewMask = null;
      if (!moved) {
        if (mode === 'replace') sprite.deselect();
        return true;
      }
      applySelection(build(q), mode);
      return true;
    },
  };
  return session;
}

function lassoSession(p: ToolPointer): Session {
  const { sprite } = state;
  const mode = selectMode(p);
  const points: Point[] = [[p.x, p.y]];
  const session: Session = {
    preview: points,
    previewClosed: true,
    move(q) {
      const last = points[points.length - 1];
      if (last[0] !== q.x || last[1] !== q.y) points.push([q.x, q.y]);
    },
    up() {
      session.preview = null;
      if (points.length < 3) { if (mode === 'replace') sprite.deselect(); return true; }
      applySelection(Mask.polygon(sprite.width, sprite.height, points), mode);
      return true;
    },
  };
  return session;
}

// Transformation (handles)

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type Handle = 'move' | 'pivot' | `scale-${Dir}` | `rotate-${Dir}` | 'skew-n' | 'skew-s';

/** Placement shown with handles: the floating pixels, or the selection bounds before anything is lifted */
export function currentPlacement(): Placement | null {
  const { sprite } = state;
  if (sprite.floating) return sprite.floating.place;
  const b = sprite.mask?.bounds;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h, angle: 0, ...pivotFor(b.x, b.y, b.w, b.h) };
}

function pivotFor(x: number, y: number, w: number, h: number) {
  const a = state.pivotAnchor;
  const fx = a.endsWith('w') ? 0 : a.endsWith('e') ? 1 : 0.5;
  const fy = a.startsWith('n') ? 0 : a.startsWith('s') ? 1 : 0.5;
  return { px: x + w * fx, py: y + h * fy };
}

function rot([x, y]: Point, [cx, cy]: Point, deg: number): Point {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** Angles where rotated pixel art stays clean: multiples of 45° and the 2:1 slopes */
/** Nearest 15° step or pixel-friendly isometric angle */
function snapAngle(deg: number) {
  const base = [0, 15, 30, 45, 60, 75, Math.atan(0.5) * 180 / Math.PI, Math.atan(2) * 180 / Math.PI];
  const all: number[] = [];
  for (let q = -180; q <= 180; q += 90) for (const b of base) all.push(q + b);
  return all.reduce((best, a) => Math.abs(a - deg) < Math.abs(best - deg) ? a : best, all[0]);
}

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
/** Aspect ratio reduced to whole numbers, e.g. 16:9 */
const ratio = (w: number, h: number) => {
  w = Math.round(w); h = Math.round(h);
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
};
const norm = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;

/** Drag a transform handle. Lifts the selected pixels if they aren't floating yet */
export function beginTransform(handle: Handle, p: ToolPointer): Session | null {
  const { sprite } = state;
  if (!sprite.floating) {
    const lifted = sprite.liftSelection(p.ctrl);
    if (!lifted) {
      state.showTip(sprite.current?.locked ? 'Layer is locked' : sprite.current?.visible === false ? 'Layer is hidden' : 'Nothing to transform');
      return null;
    }
    const b = lifted.place;
    sprite.placeFloating({ ...b, ...pivotFor(b.x, b.y, b.w, b.h) });
  } else if (p.ctrl && handle === 'move') {
    // Ctrl-drag while floating leaves a copy behind
    sprite.stampFloating();
  }
  const start = sprite.floating!.place;
  const grab: Point = [p.fx, p.fy];
  const pivot: Point = [start.px, start.py];

  const session: Session = {
    hideAnts: true,
    move(q) {
      const m: Point = [q.fx, q.fy];
      let next: Placement = start;

      if (handle === 'move') {
        let dx = Math.round(m[0] - grab[0]), dy = Math.round(m[1] - grab[1]);
        if (q.shift) {
          // Lock to the dominant axis of the box's own frame
          const [lx, ly] = rot([dx, dy], [0, 0], -start.angle);
          [dx, dy] = (Math.abs(lx) > Math.abs(ly) ? rot([lx, 0], [0, 0], start.angle) : rot([0, ly], [0, 0], start.angle)).map(Math.round) as Point;
        }
        let x = start.x + dx, y = start.y + dy;
        if (q.alt || state.snapToGrid) {
          const { gridW, gridH, gridX, gridY } = state.prefs;
          x = Math.round((x - gridX) / gridW) * gridW + gridX;
          y = Math.round((y - gridY) / gridH) * gridH + gridY;
        } else if (!start.angle) {
          const lines: Guide[] = [];
          x += snapShift('x', x, x + start.w, lines);
          y += snapShift('y', y, y + start.h, lines);
          markSnap(lines);
        }
        next = { ...start, x, y, px: start.px + x - start.x, py: start.py + y - start.y };
      } else if (handle === 'pivot') {
        // Moving the pivot keeps the image where it is
        const [cx, cy] = placementCorners(start)[0];
        const [tx, ty] = rot([cx, cy], m, -start.angle);
        next = { ...start, px: m[0], py: m[1], x: tx, y: ty };
      } else if (handle.startsWith('skew')) {
        // Slide the grabbed edge sideways (in the box's own frame); the pivot stays put
        const lm = rot(m, pivot, -start.angle), lg = rot(grab, pivot, -start.angle);
        const edgeY = (handle === 'skew-n' ? start.y : start.y + start.h) - pivot[1];
        const t0 = Math.tan((start.skew ?? 0) * Math.PI / 180);
        const t = edgeY ? t0 + (lm[0] - lg[0]) / edgeY : t0;
        let skew = Math.max(-85, Math.min(85, Math.atan(t) * 180 / Math.PI));
        if (q.shift) skew = Math.round(skew / 15) * 15;
        next = { ...start, skew };
      } else if (handle.startsWith('rotate')) {
        const a0 = Math.atan2(grab[1] - pivot[1], grab[0] - pivot[0]);
        const a1 = Math.atan2(m[1] - pivot[1], m[0] - pivot[0]);
        let angle = norm(start.angle + (a1 - a0) * 180 / Math.PI);
        if (q.shift) angle = snapAngle(angle);
        next = { ...start, angle };
      } else {
        const dir = handle.slice(6);
        // Work in the box's unrotated frame around the (fixed) pivot
        const lm = rot(m, pivot, -start.angle), lg = rot(grab, pivot, -start.angle);
        const x0 = start.x, x1 = start.x + start.w, y0 = start.y, y1 = start.y + start.h;
        const horiz = dir.includes('w') || dir.includes('e'), vert = dir.includes('n') || dir.includes('s');
        // Grabbed side in source terms, so mirrored boxes still scale from the right edge
        const gx = dir.includes('w') ? x0 : x1, gy = dir.includes('n') ? y0 : y1;
        const ax = q.alt ? pivot[0] : dir.includes('w') ? x1 : x0;
        const ay = q.alt ? pivot[1] : dir.includes('n') ? y1 : y0;
        let sx = horiz ? (lm[0] - ax) / ((gx - ax) || 1) : 1;
        let sy = vert ? (lm[1] - ay) / ((gy - ay) || 1) : 1;
        void lg;
        if (q.shift) {
          const vx = gx - ax, vy = gy - ay;
          const len = (horiz ? vx * vx : 0) + (vert ? vy * vy : 0) || 1;
          const k = ((horiz ? (lm[0] - ax) * vx : 0) + (vert ? (lm[1] - ay) * vy : 0)) / len;
          sx = sy = k;
        }
        const nx0 = ax + (x0 - ax) * sx, nx1 = ax + (x1 - ax) * sx;
        const ny0 = ay + (y0 - ay) * sy, ny1 = ay + (y1 - ay) * sy;
        let w = Math.round(nx1) - Math.round(nx0), h = Math.round(ny1) - Math.round(ny0);
        // Dragging past the opposite edge mirrors instead of collapsing
        if (!w) w = Math.sign(start.w * sx) || 1;
        if (!h) h = Math.sign(start.h * sy) || 1;
        next = { ...start, x: Math.round(nx0), y: Math.round(ny0), w, h };
      }

      sprite.placeFloating(next);
      const f = sprite.floating!;
      const pw = Math.round(Math.abs(f.place.w) / f.src.w * 100), ph = Math.round(Math.abs(f.place.h) / f.src.h * 100);
      session.info = `${Math.round(f.place.x)}, ${Math.round(f.place.y)} · ${f.src.w}×${f.src.h} → ${Math.abs(f.place.w)}×${Math.abs(f.place.h)} (${pw}% × ${ph}%) · ${ratio(Math.abs(f.place.w), Math.abs(f.place.h))} · ${f.place.angle.toFixed(1)}°${f.place.skew ? ` · slant ${f.place.skew.toFixed(1)}°` : ''}`;
    },
    up: () => true,
    // Undo of a transform drag goes back to the start of the drag, not the lift
    cancel() { sprite.placeFloating(start); },
  };
  return session;
}

/** Screen positions of the 8 handles (pushed slightly outside the box) and the pivot */
export function handlePoints(pl: Placement, toScreen: (x: number, y: number) => Point, size: number) {
  const [tl, tr, br, bl] = placementCorners(pl).map(([x, y]) => toScreen(x, y));
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = mid(tl, br);
  const out = (pt: Point) => {
    const dx = pt[0] - c[0], dy = pt[1] - c[1], len = Math.hypot(dx, dy) || 1;
    return { x: pt[0] + dx / len * size * 0.7, y: pt[1] + dy / len * size * 0.7 };
  };
  // Names refer to the source orientation, so mirrored boxes still map handles to the right sides
  const named: [Dir, Point][] = [
    ['nw', tl], ['n', mid(tl, tr)], ['ne', tr], ['e', mid(tr, br)],
    ['se', br], ['s', mid(br, bl)], ['sw', bl], ['w', mid(bl, tl)],
  ];
  const piv = toScreen(pl.px, pl.py);
  return {
    handles: named.map(([name, pt]) => ({ name, ...out(pt) })),
    pivot: { x: piv[0], y: piv[1] },
  };
}

function insideQuad(q: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which handle sits under the viewport point; the inner zone scales, a wider ring rotates */
export function hitHandle(sx: number, sy: number, toScreen: (x: number, y: number) => Point, size: number): Handle | null {
  const pl = currentPlacement();
  if (!pl) return null;
  const { handles, pivot } = handlePoints(pl, toScreen, size);
  if ((pl.angle || state.showPivot || state.sprite.floating) && Math.hypot(pivot.x - sx, pivot.y - sy) <= size * 0.8) return 'pivot';
  let best: { name: Dir; d: number; } | null = null;
  for (const h of handles) {
    const d = Math.hypot(h.x - sx, h.y - sy);
    if (!best || d < best.d) best = { name: h.name, d };
  }
  if (!best) return null;
  if (best.d <= size * 1.2) return `scale-${best.name}`;
  // Rotation grabs a wider ring around each handle, but only outside the box
  const corners = placementCorners(pl).map(([x, y]) => toScreen(x, y));
  // The ring around the top and bottom middle handles slants instead of turning
  if (best.d <= size * 4 && !insideQuad(corners, sx, sy))
    return best.name === 'n' || best.name === 's' ? `skew-${best.name}` : `rotate-${best.name}`;
  return null;
}

function blurAt(src: Uint32Array, w: number, h: number, x: number, y: number) {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      let nx = x + dx, ny = y + dy;
      nx = state.tiledX ? (nx + w) % w : Math.max(0, Math.min(w - 1, nx));
      ny = state.tiledY ? (ny + h) % h : Math.max(0, Math.min(h - 1, ny));
      const [cr, cg, cb, ca] = unpackRgba(src[ny * w + nx]);
      a += ca;
      if (!ca) continue;
      r += cr; g += cg; b += cb; n++;
    }
  if (!n) return src[y * w + x];
  // Color averages opaque neighbours; alpha averages all nine so edges fade out
  return packRgba(Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / 9));
}

function blurSession(p: ToolPointer): Session {
  const painter = new Painter('paint', false, 'Blur');
  const { w, h } = painter;
  const offsets = brushOffsets();
  const op = state.opacity / 255;
  const done = new Uint8Array(w * h);
  // Computed from the original only: scrubbing doesn't keep blurring, a new stroke does
  const dab = (x: number, y: number) => {
    for (const [ox, oy] of offsets)
      for (const [i, tx, ty] of painter.targets(x + ox, y + oy)) {
        if (done[i]) continue;
        done[i] = 1;
        const v = blurAt(painter.origin, w, h, tx, ty);
        painter.cel[i] = op >= 1 ? v : merge(painter.origin[i], v, op);
      }
    painter.commit();
  };
  let last: Point = [p.x, p.y];
  dab(p.x, p.y);
  return {
    move(q) {
      for (const [x, y] of linePoints(last, [q.x, q.y])) dab(x, y);
      last = [q.x, q.y];
    },
    up: () => true,
  };
}

function jumbleSession(p: ToolPointer): Session {
  const painter = new Painter('paint', false, 'Scatter', 'overlap');
  const { w, h, cel } = painter;
  const offsets = brushOffsets();
  const op = state.opacity / 255;
  let last: Point = [p.x, p.y];
  const dab = (x: number, y: number, vx: number, vy: number) => {
    const src = cel.slice();
    for (const [ox, oy] of offsets)
      for (const [i, tx, ty] of painter.targets(x + ox, y + oy)) {
        // Random neighbour, dragged along the stroke direction
        let sx = tx + Math.round(Math.random() * 2 - 1 - vx / 4);
        let sy = ty + Math.round(Math.random() * 2 - 1 - vy / 4);
        sx = state.tiledX ? ((sx % w) + w) % w : Math.max(0, Math.min(w - 1, sx));
        sy = state.tiledY ? ((sy % h) + h) % h : Math.max(0, Math.min(h - 1, sy));
        cel[i] = merge(src[i], src[sy * w + sx], op);
      }
    painter.commit();
  };
  dab(p.x, p.y, 0, 0);
  return {
    move(q) {
      const vx = q.x - last[0], vy = q.y - last[1];
      for (const [x, y] of linePoints(last, [q.x, q.y])) dab(x, y, vx, vy);
      last = [q.x, q.y];
    },
    up: () => true,
  };
}

function spraySession(p: ToolPointer): Session {
  const painter = new Painter('paint', p.secondary, 'Spray', 'overlap');
  painter.pressured = true;
  let at: Point = [p.x, p.y];
  let carry = 0;
  const spray = () => {
    const r = state.sprayWidth / 2;
    carry += Math.max(0.2, r * r * Math.PI * state.spraySpeed / 400) * pressureFactor('density');
    const count = Math.floor(carry);
    carry -= count;
    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * r;
      points.push([Math.round(at[0] + Math.cos(angle) * dist), Math.round(at[1] + Math.sin(angle) * dist)]);
    }
    painter.stamp(points, brushOffsets(pressureSize()));
  };
  spray();
  return {
    move(q) { at = [q.x, q.y]; spray(); },
    tick: spray,
    up: () => true,
  };
}

function pickColor(p: ToolPointer, secondary: boolean) {
  const { sprite } = state;
  let { x, y } = p;
  if (state.tiledX) x = ((x % sprite.width) + sprite.width) % sprite.width;
  if (state.tiledY) y = ((y % sprite.height) + sprite.height) % sprite.height;
  if (!sprite.inBounds(x, y)) return;
  const v = sprite.editingMask ? sprite.layerMaskPixels()[y * sprite.width + x] : state.pickMerged ? sprite.pick(x, y) : sprite.celPixel(x, y);
  const [r, g, b, a] = unpackRgba(v);
  const current = secondary ? state.colorB : state.colorA;
  let c: Color;
  if (state.pickChannel === 'color') {
    if (!a) return;
    c = Color.fromRgb(r, g, b, current.rgba[3]);
  } else if (state.pickChannel === 'alpha') {
    const [cr, cg, cb] = current.rgb;
    c = Color.fromRgb(cr, cg, cb, a / 255);
  } else c = Color.fromRgb(r, g, b, a / 255);
  state.customBrush = null;
  if (secondary) state.colorB = c;
  else state.colorA = c;
}

/** The current layer with one dab of the tool at (x, y), for the live brush preview */
export function previewDab(tool: ToolName, x: number, y: number): Uint32Array | null {
  const { sprite } = state;
  if (!sprite.editable || sprite.floating || !PAINT_TOOLS.includes(tool)) return null;
  const painter = new Painter('paint', false, '', 'stroke', true);
  painter.stamp([[x, y]], tool === 'fill' || tool === 'contour' || tool === 'polygon' ? [[0, 0]] : brushOffsets());
  return painter.cel;
}

/** True when the brush preview should be an outline rather than a painted dab */
export function outlinePreview(tool: ToolName) {
  if (EFFECT_TOOLS.includes(tool)) return true;
  return state.colorA.rgba[3] === 0 && state.ink !== 'shade';
}

// Entry point

/** Starts a tool interaction at sprite pixel position p. Returns null for instant actions. */
export function beginSession(tool: ToolName, p: ToolPointer): Session | null {
  const { sprite } = state;
  state.hint = '';
  const guard = sprite.protectHistory();
  const custom = TOOLS.find(t => t.name === tool)?.session;
  let session: Session | null;
  try { session = custom ? custom(p) : start(tool, p); }
  catch (error) { guard.cancel(); throw error; }
  if (!session) { guard.commit(); return null; }
  const cancel = session.cancel, up = session.up, finish = session.finish;
  session.cancel = () => {
    if (cancel) { try { cancel(); } finally { guard.commit(); } }
    else guard.cancel();
  };
  session.up = p => { const done = up(p); if (done) guard.commit(); return done; };
  if (finish) session.finish = () => { try { finish(); } finally { guard.commit(); } };
  else session.finish = () => guard.commit();
  return session;
}

function start(tool: ToolName, p: ToolPointer): Session | null {
  const { sprite } = state;
  if (sprite.maskBoundsNotice && (PAINT_TOOLS.includes(tool) || EFFECT_TOOLS.includes(tool))) { state.showTip(t('mask.bounds')); return null; }
  if (sprite.editingChannel === 'mask' && ['move', 'text', 'blur', 'jumble'].includes(tool)) return null;

  switch (tool) {
    case 'hand':
      return null;

    case 'zoom': {
      const z0 = state.zoomTarget;
      let dragged = false;
      return {
        move(q) {
          const dx = q.sx - p.sx;
          if (!dragged && Math.abs(dx) < 8) return;
          dragged = true;
          state.zoomTo(z0 * Math.pow(2, dx / 60), p.sx, p.sy);
        },
        up() {
          if (!dragged) state.zoomStep(p.secondary || p.alt ? -1 : 1, p.sx, p.sy);
          return true;
        },
        cancel() { },
      };
    }

    case 'picker':
      if (!sprite.editingMask && sprite.tileset && state.tilemapMode === 'tiles') {
        // Picks the tile under the cursor instead of a color
        const pick = (q: ToolPointer) => { const ref = sprite.tileAt(q.x, q.y); if (p.secondary) state.tileB = ref; else state.tileA = ref; };
        pick(p);
        return { move: pick, up: () => true, cancel() { } };
      }
      pickColor(p, p.secondary);
      return { move: q => pickColor(q, p.secondary), up: () => true, cancel() { } };

    case 'marquee':
    case 'ellipseMarquee':
    case 'lasso':
    case 'polyLasso': {
      // Plain left drag inside the selection moves its pixels
      const plain = !p.shift && !p.alt && !p.secondary && state.selectMode === 'replace';
      if (!sprite.editingMask && plain && sprite.mask?.has(p.x, p.y)) return beginTransform('move', p);
      sprite.dropFloating();
      if (tool === 'marquee' || tool === 'ellipseMarquee') return marqueeSession(p, tool === 'marquee' ? 'rect' : 'ellipse');
      if (tool === 'lasso') return lassoSession(p);
      const mode = selectMode(p);
      return multiClick(p, (points, done) => {
        if (done && points.length > 2) applySelection(Mask.polygon(sprite.width, sprite.height, points), mode);
      });
    }

    case 'wand': {
      if (!sprite.inBounds(p.x, p.y)) return null;
      sprite.dropFloating();
      applySelection(regionMask(p.x, p.y, referencePixels(), false), selectMode(p));
      return null;
    }

    case 'move': {
      if (sprite.floating || sprite.mask) return beginTransform('move', p);
      // Ctrl (or the option) picks the topmost layer with a solid pixel under the cursor
      if ((p.ctrl || state.autoSelectLayer) && sprite.inBounds(p.x, p.y)) {
        for (let l = sprite.layers.length - 1; l >= 0; l--) {
          const layer = sprite.layers[l];
          if (layer.visible && (sprite.celPixel(p.x, p.y, l) >>> 24) > 127) { sprite.layer = l; break; }
        }
      }
      const l = sprite.current;
      if (l?.reference) return referenceSession(p);
      const refuse = !l ? 'No layer' : l.background ? 'The background layer can\'t be moved' : !l.visible ? 'Layer is hidden'
        : l.locked ? 'Layer is locked' : !sprite.getCel() ? 'The cel is empty' : '';
      if (refuse) { state.showTip(refuse); return null; }
      sprite.checkpoint('Move cel');
      const start = sprite.getCel()!;
      const origin = sprite.canvasPixels();
      const { width: w, height: h } = sprite;
      const startPt: Point = [p.x, p.y];
      const session: Session = {
        move(q) {
          let dx = q.x - startPt[0], dy = q.y - startPt[1];
          if (q.shift) Math.abs(dx) > Math.abs(dy) ? dy = 0 : dx = 0;
          if (!state.tiledX && !state.tiledY) {
            const lines: Guide[] = [];
            if (!q.shift || dx) dx += snapShift('x', start.x + dx, start.x + dx + start.w, lines);
            if (!q.shift || dy) dy += snapShift('y', start.y + dy, start.y + dy + start.h, lines);
            markSnap(lines);
          }
          if (state.tiledX || state.tiledY) {
            // Wrap-around: pixels leaving one edge come back on the other
            const out = new Uint32Array(w * h);
            for (let y = 0; y < h; y++) {
              const sy = state.tiledY ? (((y - dy) % h) + h) % h : y - dy;
              if (sy < 0 || sy >= h) continue;
              for (let x = 0; x < w; x++) {
                const sx = state.tiledX ? (((x - dx) % w) + w) % w : x - dx;
                if (sx >= 0 && sx < w) out[y * w + x] = origin[sy * w + sx];
              }
            }
            sprite.setCel({ x: 0, y: 0, w, h, data: out });
          } else {
            // Only the position changes: pixels pushed off the canvas are kept and come back
            sprite.setCel({ ...start, x: start.x + dx, y: start.y + dy });
          }
          session.info = `Cel ${start.x + dx}, ${start.y + dy} · ${start.w}×${start.h} · moved ${dx}, ${dy}`;
        },
        up: () => true,
      };
      return session;
    }
  }

  // Tiles mode on a tilemap: tools place, erase and pick whole tiles
  const ts = sprite.tileset;
  if (!sprite.editingMask && ts && state.tilemapMode === 'tiles' && ['pencil', 'eraser', 'fill', 'line'].includes(tool)) {
    const cell = (q: ToolPointer): Point => [Math.floor(q.x / ts.tw), Math.floor(q.y / ts.th)];
    if (!sprite.editable) return null;
    sprite.dropFloating();
    sprite.checkpoint(tool === 'eraser' ? 'Erase tiles' : 'Place tiles');
    const ref = tool === 'eraser' ? 0 : p.secondary ? state.tileB : state.tileA;
    let last = cell(p);
    sprite.setTileAt(last[0], last[1], ref);
    const session: Session = {
      move(q) {
        const c = cell(q);
        if (c[0] === last[0] && c[1] === last[1]) return;
        for (const [gx, gy] of linePoints(last, c).slice(1)) sprite.setTileAt(gx, gy, ref);
        last = c;
        session.info = `tile ${ref} at ${c[0]}, ${c[1]}`;
      },
      up: () => true,
    };
    return session;
  }

  const l = sprite.current;
  if (!sprite.editable) {
    state.showTip(!l ? 'No layer' : l.group ? 'Groups have no pixels of their own: pick a layer inside' : sprite.lockedDeep(sprite.layer) ? 'Layer is locked' : 'Layer is hidden');
    return null;
  }
  sprite.dropFloating();

  // The right button can be set to pick or erase instead of painting with the secondary color
  const right = p.secondary && state.ink !== 'shade' && tool !== 'eraser' ? state.prefs.rightClick : 'secondary';
  if (right === 'pick') { pickColor(p, false); return { move: q => pickColor(q, false), up: () => true, cancel() { } }; }
  if (right === 'erase') return freehand({ ...p, secondary: false }, 'erase', 'Erase');

  switch (tool) {
    case 'pencil':
    case 'eraser':
      return freehand(p, tool === 'eraser' ? 'erase' : 'paint', tool === 'eraser' ? 'Erase' : 'Pencil');

    case 'spray':
      return spraySession(p);

    case 'fill': {
      if (!sprite.inBounds(p.x, p.y)) return null;
      const region = regionMask(p.x, p.y, referencePixels(), true);
      const painter = new Painter('paint', p.secondary, 'Fill');
      const { width: w } = sprite;
      for (let i = 0; i < region.data.length; i++)
        if (region.data[i]) painter.pixel(i % w, (i / w) | 0);
      painter.commit();
      return null;
    }

    case 'gradient':
      return gradientSession(p);

    case 'slice':
      return sliceSession(p);

    case 'text': {
      // Dragging the text being typed moves it; a press elsewhere applies it and starts a new box
      const f = sprite.floating, r = f?.result;
      if (state.textAt && f && r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.bmp.w && p.y < r.y + r.bmp.h) {
        const sx = p.x, sy = p.y, x0 = f.place.x, y0 = f.place.y;
        return { move(q) { sprite.moveFloating(x0 + q.x - sx, y0 + q.y - sy); }, up: () => true };
      }
      state.finishText(true);
      sprite.dropFloating();
      return { move() { }, up(q) { state.textAt = { x: q.x, y: q.y }; return true; } };
    }

    case 'line': {
      const painter = new Painter('paint', p.secondary, 'Line');
      return twoPoint(p, painter, (s, e, q) => {
        let [a, b] = q.ctrl ? boxFrom(s, e, false, true) : [s, e];
        if (q.shift) {
          b = snapLine(a, b);
          if (q.ctrl) a = [2 * s[0] - b[0], 2 * s[1] - b[1]];
        }
        return { points: linePoints(a, b) };
      }, (a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        return `${a[0]}, ${a[1]} → ${b[0]}, ${b[1]} · ${Math.hypot(dx, dy).toFixed(1)}px · ${(-Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}°`;
      });
    }

    case 'curve':
      return curveSession(p);

    case 'rect':
    case 'ellipse': {
      const painter = new Painter('paint', p.secondary, tool === 'rect' ? 'Rectangle' : 'Ellipse');
      // Alt held: the box freezes and further movement turns it around its center
      let box: [Point, Point] = [[p.x, p.y], [p.x, p.y]];
      let turn: { base: number; from: number; } | null = null;
      let angle = 0;
      return twoPoint(p, painter, (s, e, q) => {
        if (q.alt) {
          const cx = (box[0][0] + box[1][0]) / 2, cy = (box[0][1] + box[1][1]) / 2;
          const a = Math.atan2(q.y - cy, q.x - cx) * 180 / Math.PI;
          turn ??= { base: a, from: angle };
          angle = turn.from + a - turn.base;
          if (q.shift) angle = Math.round(angle / 15) * 15;
        } else {
          turn = null;
          box = boxFrom(s, e, q.shift, q.ctrl);
        }
        const [a, b] = box;
        const fn = tool === 'rect' ? (s: Point, e: Point, f: boolean) => rectPoints(s, e, f, state.cornerRadius) : ellipsePoints;
        const points = angle % 360 ? rotatedShape(fn(a, b, true), a, b, angle, state.filled) : fn(a, b, state.filled);
        return state.filled ? { points, offsets: [[0, 0]] } : { points };
      }, () => `${Math.abs(box[1][0] - box[0][0]) + 1}×${Math.abs(box[1][1] - box[0][1]) + 1}${tool === 'rect' && state.cornerRadius ? ` · r${state.cornerRadius}` : ''}${angle % 360 ? ` · ${(((angle % 360) + 360) % 360).toFixed(1)}°` : ''}`);
    }

    case 'contour': {
      const painter = new Painter('paint', p.secondary, 'Shape fill');
      const points: Point[] = [[p.x, p.y]];
      const session: Session = {
        preview: points,
        previewClosed: true,
        move(q) {
          const last = points[points.length - 1];
          if (last[0] !== q.x || last[1] !== q.y) points.push([q.x, q.y]);
          painter.reset();
          painter.stamp(points);
        },
        up() {
          session.preview = null;
          fillPolygon(painter, points);
          painter.stamp(points);
          return true;
        },
      };
      painter.stamp(points);
      return session;
    }

    case 'polygon': {
      const painter = new Painter('paint', p.secondary, 'Polygon');
      return multiClick(p, (points, done) => {
        painter.reset();
        if (done) fillPolygon(painter, points);
        else for (let i = 1; i < points.length; i++) painter.stamp(linePoints(points[i - 1], points[i]));
      });
    }

    case 'blur':
      return blurSession(p);

    case 'jumble':
      return jumbleSession(p);
  }

  return null;
}

export type SliceHit = { index: number; kind: 'move' | 'resize' | 'center'; edges: { l: boolean; r: boolean; t: boolean; b: boolean; }; };

/** What dragging at (fx, fy) would do: a thin band inside the edges resizes, 9-slice lines move, the rest moves */
export function hitSlice(fx: number, fy: number): SliceHit | null {
  const { sprite } = state;
  if (!state.showSlices) return null;
  const e = 5 / state.zoom;
  const order = sprite.slices.map((_, i) => i).reverse();
  // Selected slices win when they overlap others
  order.sort((a, b) => +sprite.selectedSlices.includes(b) - +sprite.selectedSlices.includes(a));
  for (const index of order) {
    const k = sliceKey(sprite.slices[index], sprite.frame);
    if (!k || fx < k.x || fy < k.y || fx > k.x + k.w || fy > k.y + k.h) continue;
    const edges = { l: fx - k.x < e, r: k.x + k.w - fx < e, t: fy - k.y < e, b: k.y + k.h - fy < e };
    if (edges.l || edges.r || edges.t || edges.b) return { index, kind: 'resize', edges };
    const c = k.center;
    if (c) {
      const ce = {
        l: Math.abs(fx - (k.x + c.x)) < e, r: Math.abs(fx - (k.x + c.x + c.w)) < e,
        t: Math.abs(fy - (k.y + c.y)) < e, b: Math.abs(fy - (k.y + c.y + c.h)) < e,
      };
      if (ce.l || ce.r || ce.t || ce.b) return { index, kind: 'center', edges: ce };
    }
    return { index, kind: 'move', edges };
  }
  return null;
}

export function sliceCursor(h: SliceHit | null) {
  if (!h) return 'crosshair';
  if (h.kind === 'move') return 'move';
  const { l, r, t, b } = h.edges;
  if ((l && t) || (r && b)) return 'nwse-resize';
  if ((r && t) || (l && b)) return 'nesw-resize';
  return l || r ? 'ew-resize' : 'ns-resize';
}

function sliceSession(p: ToolPointer): Session {
  const { sprite } = state;
  const hit = hitSlice(p.fx, p.fy);
  const sx = p.fx, sy = p.fy;
  if (hit) {
    if (!sprite.selectedSlices.includes(hit.index)) sprite.selectedSlices = [hit.index];
    const picked = hit.kind === 'center' ? [hit.index] : sprite.selectedSlices.slice();
    const start = new Map(picked.map(i => [i, sliceKey(sprite.slices[i], sprite.frame)!] as const));
    // Resizing several slices scales them within their union
    const keys = [...start.values()];
    const U = {
      x0: Math.min(...keys.map(k => k.x)), y0: Math.min(...keys.map(k => k.y)),
      x1: Math.max(...keys.map(k => k.x + k.w)), y1: Math.max(...keys.map(k => k.y + k.h)),
    };
    let changed = false;
    const session: Session = {
      move(q) {
        let dx = Math.round(q.fx - sx), dy = Math.round(q.fy - sy);
        if (hit.kind === 'move') {
          const k = start.get(hit.index)!, lines: Guide[] = [];
          dx += snapShift('x', k.x + dx, k.x + dx + k.w, lines);
          dy += snapShift('y', k.y + dy, k.y + dy + k.h, lines);
          markSnap(lines);
        }
        const patches = new Map<number, Partial<SliceKey>>();
        for (const [i, k] of start) {
          if (hit.kind === 'move') patches.set(i, { x: k.x + dx, y: k.y + dy });
          else if (hit.kind === 'center') {
            const c = k.center!, e = hit.edges;
            let l = c.x, t = c.y, r = c.x + c.w, b = c.y + c.h;
            if (e.l) l = Math.min(r - 1, l + dx);
            if (e.r) r = Math.max(l + 1, r + dx);
            if (e.t) t = Math.min(b - 1, t + dy);
            if (e.b) b = Math.max(t + 1, b + dy);
            patches.set(i, { center: { x: l, y: t, w: r - l, h: b - t } });
          } else {
            const e = hit.edges;
            const nx0 = U.x0 + (e.l ? dx : 0), nx1 = U.x1 + (e.r ? dx : 0);
            const ny0 = U.y0 + (e.t ? dy : 0), ny1 = U.y1 + (e.b ? dy : 0);
            const mx = (v: number) => nx0 + (v - U.x0) * (nx1 - nx0) / Math.max(1, U.x1 - U.x0);
            const my = (v: number) => ny0 + (v - U.y0) * (ny1 - ny0) / Math.max(1, U.y1 - U.y0);
            const x = Math.round(mx(k.x)), y = Math.round(my(k.y));
            // Never turned inside out: at least 1px, pinned instead of flipping
            const w = Math.max(1, Math.round(mx(k.x + k.w)) - x), h = Math.max(1, Math.round(my(k.y + k.h)) - y);
            const patch: Partial<SliceKey> = { x, y, w, h };
            if (k.center) {
              // 9-slice borders keep their thickness
              const left = k.center.x, top = k.center.y, right = k.w - k.center.x - k.center.w, bottom = k.h - k.center.y - k.center.h;
              patch.center = { x: left, y: top, w: Math.max(1, w - left - right), h: Math.max(1, h - top - bottom) };
            }
            patches.set(i, patch);
          }
        }
        if (!changed && !dx && !dy) return;
        if (!changed) sprite.checkpoint(hit.kind === 'move' ? 'Move slice' : 'Resize slice');
        changed = true;
        for (const [i, patch] of patches) sprite.updateSliceKey(i, patch, null);
        const k = sliceKey(sprite.slices[hit.index], sprite.frame);
        if (k) session.info = `${sprite.slices[hit.index].name}: ${k.x}, ${k.y} · ${k.w}×${k.h}`;
      },
      up: () => true,
    };
    return session;
  }
  // Empty space: a band picks slices it touches, or makes a new one
  let end: Point = [p.x, p.y];
  let first: Point = [p.x, p.y];
  const session: Session = {
    preview: null,
    previewClosed: true,
    move(q) {
      const lines: Guide[] = [];
      first = snapCorner(p.fx, p.fy, [p.x, p.y], [q.x, q.y], lines);
      end = snapCorner(q.fx, q.fy, [q.x, q.y], first, lines);
      markSnap(lines);
      const [x0, x1] = [Math.min(first[0], end[0]), Math.max(first[0], end[0])], [y0, y1] = [Math.min(first[1], end[1]), Math.max(first[1], end[1])];
      session.preview = [[x0 - 0.5, y0 - 0.5], [x1 + 0.5, y0 - 0.5], [x1 + 0.5, y1 + 0.5], [x0 - 0.5, y1 + 0.5]];
      session.info = `${x0}, ${y0} · ${x1 - x0 + 1}×${y1 - y0 + 1}`;
    },
    up() {
      session.preview = null;
      const x0 = Math.min(first[0], end[0]), y0 = Math.min(first[1], end[1]);
      const r = { x: x0, y: y0, w: Math.abs(end[0] - first[0]) + 1, h: Math.abs(end[1] - first[1]) + 1 };
      const touched = sprite.slices.map((sl, i) => {
        const k = sliceKey(sl, sprite.frame);
        return k && k.x < r.x + r.w && r.x < k.x + k.w && k.y < r.y + r.h && r.y < k.y + k.h ? i : -1;
      }).filter(i => i >= 0);
      const dragged = r.w > 1 || r.h > 1;
      if (dragged && touched.length) sprite.selectedSlices = touched;
      else if (dragged) {
        // Clipped to the canvas
        const cx = Math.max(0, r.x), cy = Math.max(0, r.y);
        const cw = Math.min(sprite.width, r.x + r.w) - cx, ch = Math.min(sprite.height, r.y + r.h) - cy;
        if (cw > 0 && ch > 0) sprite.addSlice({ x: cx, y: cy, w: cw, h: ch });
      } else sprite.selectedSlices = [];
      return true;
    },
  };
  return session;
}

/** Corners of the current reference image in sprite coordinates (clockwise from top-left), or null */
export function referenceCorners(): Point[] | null {
  const ref = state.sprite.current?.reference;
  const img = ref && referenceImage(ref.src);
  if (!ref || !img) return null;
  const w = img.naturalWidth * ref.scale, h = img.naturalHeight * ref.scale;
  const c: Point = [ref.x + w / 2, ref.y + h / 2], a = ref.angle ?? 0;
  return ([[ref.x, ref.y], [ref.x + w, ref.y], [ref.x + w, ref.y + h], [ref.x, ref.y + h]] as Point[]).map(q => rot(q, c, a));
}

/** What the pointer grabs on the current reference image: a corner scales, just outside one rotates */
export function referenceHit(fx: number, fy: number): 'scale' | 'rotate' | 'move' | null {
  const corners = referenceCorners();
  if (!corners) return null;
  const d = Math.min(...corners.map(([x, y]) => Math.hypot(x - fx, y - fy))) * state.zoom;
  if (d <= 6) return 'scale';
  if (d <= 22 && !insideQuad(corners, fx, fy)) return 'rotate';
  return 'move';
}

/** Moves, scales (about the center) or rotates the reference image of the current layer */
function referenceSession(p: ToolPointer): Session | null {
  const { sprite } = state;
  const li = sprite.layer, l = sprite.layers[li];
  const ref = l.reference!, img = referenceImage(ref.src);
  if (!img) return null;
  if (l.locked) { state.showTip('Layer is locked'); return null; }
  const kind = referenceHit(p.fx, p.fy) ?? 'move';
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const c: Point = [ref.x + w0 * ref.scale / 2, ref.y + h0 * ref.scale / 2];
  const grab: Point = [p.fx, p.fy];
  let changed = false;
  const set = (next: RefImage) => {
    if (!changed) sprite.checkpoint(kind === 'move' ? 'Move reference' : kind === 'scale' ? 'Scale reference' : 'Rotate reference');
    changed = true;
    sprite.layers = sprite.layers.map((x, i) => i === li ? { ...x, reference: next } : x);
    sprite.touch();
  };
  const session: Session = {
    move(q) {
      if (kind === 'move') {
        let dx = Math.round(q.fx - grab[0]), dy = Math.round(q.fy - grab[1]);
        if (q.shift) Math.abs(dx) > Math.abs(dy) ? dy = 0 : dx = 0;
        if (!ref.angle) {
          const lines: Guide[] = [], w = w0 * ref.scale, h = h0 * ref.scale;
          dx += snapShift('x', ref.x + dx, ref.x + dx + w, lines);
          dy += snapShift('y', ref.y + dy, ref.y + dy + h, lines);
          markSnap(lines);
        }
        if (!changed && !dx && !dy) return;
        set({ ...ref, x: ref.x + dx, y: ref.y + dy });
        session.info = `${Math.round(ref.x + dx)}, ${Math.round(ref.y + dy)}`;
      } else if (kind === 'scale') {
        const k = Math.hypot(q.fx - c[0], q.fy - c[1]) / Math.max(1e-6, Math.hypot(grab[0] - c[0], grab[1] - c[1]));
        const scale = Math.max(0.01, ref.scale * k);
        set({ ...ref, scale, x: c[0] - w0 * scale / 2, y: c[1] - h0 * scale / 2 });
        session.info = `${Math.round(scale * 100)}% · ${Math.round(w0 * scale)}×${Math.round(h0 * scale)}`;
      } else {
        const turn = (Math.atan2(q.fy - c[1], q.fx - c[0]) - Math.atan2(grab[1] - c[1], grab[0] - c[0])) * 180 / Math.PI;
        let angle = norm((ref.angle ?? 0) + turn);
        if (q.shift) angle = Math.round(angle / 15) * 15;
        set({ ...ref, angle });
        session.info = `${Math.round(angle * 10) / 10}°`;
      }
    },
    up: () => true,
    cancel() { if (changed) sprite.undo(); },
  };
  return session;
}

/** Bayer threshold matrix of size n (power of two), values 0..n²-1 */
function bayer(n: number): number[] {
  if (n <= 1) return [0];
  const half = bayer(n / 2), h = n / 2, out = new Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const q = (y < h ? 0 : 2) + ((x < h) === (y < h) ? 0 : 1);
      // Quadrant order 0, 2, 3, 1 spreads thresholds evenly
      const base = [0, 2, 3, 1][q];
      out[y * n + x] = 4 * half[(y % h) * h + (x % h)] + base;
    }
  return out;
}

/** Ramp from primary to secondary across a flood-filled area: linear or radial, smooth or dithered */
function gradientSession(p: ToolPointer): Session | null {
  const { sprite } = state;
  if (!sprite.inBounds(p.x, p.y)) return null;
  const painter = new Painter('paint', p.secondary, 'Gradient');
  const w = sprite.width;
  const ref = referencePixels();
  let regionAt = '';
  let region: Mask | null = null;
  const start: Point = [p.x, p.y];
  const session: Session = {
    move(q) {
      let end: Point = q.shift ? snapLine(start, [q.x, q.y]) : [q.x, q.y];
      let a = start;
      if (q.ctrl) a = [2 * start[0] - end[0], 2 * start[1] - end[1]];
      // The area comes from the flood fill at the press point (or the middle of the drag)
      const seed: Point = q.ctrl ? start : a;
      const key = `${seed[0]},${seed[1]}`;
      if (key !== regionAt) {
        region = sprite.inBounds(seed[0], seed[1]) ? regionMask(seed[0], seed[1], ref, true) : null;
        regionAt = key;
      }
      painter.reset();
      if (region && (a[0] !== end[0] || a[1] !== end[1])) paintGradient(painter, region, a, end, w);
      session.info = `${a[0]}, ${a[1]} → ${end[0]}, ${end[1]} · ${state.gradientType}`;
      painter.commit();
    },
    up: () => true,
  };
  session.move(p);
  return session;
}

function paintGradient(painter: Painter, region: Mask, [x0, y0]: Point, [x1, y1]: Point, w: number) {
  let c0 = painter.primary, c1 = painter.secondary;
  // Fading into transparency keeps the color of the opaque end (no dark fringe)
  if (!(c0 >>> 24)) c0 = c1 & 0xffffff;
  if (!(c1 >>> 24)) c1 = c0 & 0xffffff;
  const [r0, g0, b0, a0] = unpackRgba(c0), [r1, g1, b1, a1] = unpackRgba(c1);
  const n = state.gradientDither;
  const matrix = n > 0 ? bayer(n) : null;
  const custom = n < 0 ? customThresholds() : null;
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(dx) / 2, ry = Math.abs(dy) / 2;
  const op = state.opacity / 255;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  for (let i = 0; i < region.data.length; i++) {
    if (!region.data[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let t: number;
    if (state.gradientType === 'radial') {
      // The drag box is the ellipse's bounding box
      t = rx && ry ? Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) : 1;
    } else t = ((x - x0) * dx + (y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    let v: number;
    if (custom) {
      // The user's pattern (or custom brush) supplies the thresholds, ranked so every level is used
      const th = custom.t[(((y % custom.h) + custom.h) % custom.h) * custom.w + (((x % custom.w) + custom.w) % custom.w)];
      v = t >= th ? c1 : c0;
    } else if (matrix) {
      // Only the two end colors, picked by a threshold pattern tied to canvas coordinates
      const th = matrix[(y % n) * n + (x % n)];
      v = t * (n * n + 1) >= th + 1 ? c1 : c0;
    } else v = packRgba(lerp(r0, r1, t), lerp(g0, g1, t), lerp(b0, b1, t), lerp(a0, a1, t));
    painter.cel[i] = blendOver(painter.origin[i], withAlpha(v, (v >>> 24) * op));
  }
}

/** The interaction currently driven by the canvas view, if any */
export const active: { session: Session | null; } = { session: null };

export function brushFromBitmap(bmp: Bitmap, ox: number, oy: number) {
  state.customBrush = { bmp, ox, oy, align: state.customBrush?.align ?? 'stroke' };
}

/**
 * Thresholds 0..1 from the custom brush's brightness, else from the captured paint pattern.
 * Values are ranked so a gradient sweeps through every cell of the pattern.
 */
function customThresholds(): { w: number; h: number; t: Float32Array; } | null {
  let w: number, h: number, levels: number[];
  const b = state.customBrush, p = state.patternBits;
  if (b) {
    ({ w, h } = b.bmp);
    levels = Array.from(b.bmp.data, v => {
      const [r, g, bl, a] = unpackRgba(v);
      return (r * 0.3 + g * 0.59 + bl * 0.11) * a / 255;
    });
  } else if (p) {
    ({ w, h } = p);
    levels = Array.from(p.bits, v => v ? 0 : 1);
  } else return null;
  const order = levels.map((v, i) => [v, i] as const).sort((a, c) => a[0] - c[0]);
  const t = new Float32Array(w * h);
  // Equal levels share a threshold so the pattern's own groups switch together
  for (let k = 0; k < order.length;) {
    let e = k;
    while (e + 1 < order.length && order[e + 1][0] === order[k][0]) e++;
    const th = ((k + e) / 2 + 1) / (order.length + 1);
    for (let j = k; j <= e; j++) t[order[j][1]] = th;
    k = e + 1;
  }
  return { w, h, t };
}

/** Where a selection outline goes relative to the selection edge */
export type StrokePlace = 'inside' | 'center' | 'outside';

/**
 * Paints the selection's outline (or, with width 0, its whole area) with the current colors,
 * ink, paint pattern and custom brush pixels.
 */
export function paintSelection(width: number, place: StrokePlace, label: string) {
  const sprite = state.sprite;
  const mask = sprite.mask;
  if (!mask || !sprite.editable) return false;
  const painter = new Painter('paint', false, label);
  const { w, h } = painter;
  // Stroking outside the selection must reach unselected pixels
  painter.mask = null;
  let hit: (i: number) => boolean;
  if (width <= 0) hit = i => !!mask.data[i];
  else {
    // Steps (8-neighbour) to the nearest pixel on the other side of the edge; the canvas border counts as outside
    const dist = new Int32Array(w * h).fill(-1);
    let queue: number[] = [];
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0, inside = !!mask.data[i];
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++)
        for (let dx = -1; dx <= 1 && !edge; dx++) {
          const nx = x + dx, ny = y + dy;
          const other = nx < 0 || ny < 0 || nx >= w || ny >= h ? false : !!mask.data[ny * w + nx];
          if ((dx || dy) && other !== inside && (inside || (nx >= 0 && ny >= 0 && nx < w && ny < h))) edge = true;
        }
      if (edge) { dist[i] = 1; queue.push(i); }
    }
    const limit = Math.max(width, 1);
    for (let d = 1; d < limit && queue.length; d++) {
      const next: number[] = [];
      for (const i of queue) {
        const x = i % w, y = (i / w) | 0, inside = !!mask.data[i];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (dist[j] < 0 && !!mask.data[j] === inside) { dist[j] = d + 1; next.push(j); }
          }
      }
      queue = next;
    }
    const inW = place === 'inside' ? width : place === 'outside' ? 0 : Math.ceil(width / 2);
    const outW = width - inW;
    hit = i => dist[i] > 0 && (mask.data[i] ? dist[i] <= inW : dist[i] <= outW);
  }
  const b = state.customBrush;
  const anchor: Point = b ? (b.align === 'source' ? [b.ox, b.oy] : [0, 0]) : [0, 0];
  painter.anchor = anchor;
  for (let i = 0; i < w * h; i++) {
    if (!hit(i)) continue;
    const x = i % w, y = (i / w) | 0;
    painter.cel[i] = painter.ink(i, x, y);
  }
  painter.commit();
  return true;
}
