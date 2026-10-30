/**
 * Sprite sheet builder: collects samples (frame × layer × tag), trims them, merges duplicates,
 * lays them out, renders the texture and describes it as JSON.
 */

import { opaqueBounds, type Rect } from "~/core/Image";
import type { SpriteContext } from "./SpriteContext";
import { parentOf, type Tag } from "~/core/SpriteModel";

export type SheetType = 'horizontal' | 'vertical' | 'rows' | 'columns' | 'packed';
export type TrimMode = 'none' | 'sprite' | 'cels';

export type SheetOptions = {
  type: SheetType;
  /** Cells per row ('rows') or per column ('columns'); 0 = automatic */
  count: number;
  frames: number[];
  /** Only this layer; otherwise all visible layers */
  layer?: number;
  splitLayers: boolean;
  splitTags: boolean;
  border: number;
  spacing: number;
  inner: number;
  trim: TrimMode;
  /** Grow trimmed boxes outward to whole grid cells */
  trimByGrid: boolean;
  /** Repeat the edge pixels one pixel outward (avoids seams when textures are filtered) */
  extrude: boolean;
  mergeDuplicates: boolean;
  ignoreEmpty: boolean;
  powerOfTwo: boolean;
  scale: number;
  /** File name template for frame names in the data file */
  template: string;
  /** Exported part of each frame (slice / selection); frames sit at the top-left of the largest one */
  area?: (frame: number) => Rect | null;
};

type Sample = {
  frame: number;
  layer: number | null;
  tag: Tag | null;
  /** Position of the frame inside its tag (or the export) */
  index: number;
  data: Uint32Array;
  src: Rect;
  /** Placement shared by identical samples */
  slot: Slot;
};

type Slot = { w: number; h: number; x: number; y: number; band: string; };

export type Sheet = ReturnType<typeof buildSheet>;

/** Default frame name: title, (layer), #tag, frame number, extension */
export function defaultTemplate(o: Pick<SheetOptions, 'splitLayers' | 'splitTags' | 'frames'>) {
  return `{title}${o.splitLayers ? ' ({layer})' : ''}${o.splitTags ? ' #{tag}' : ''}${o.frames.length > 1 ? ' {frame}' : ''}.{extension}`;
}

/** Fills `{var}` placeholders; frame numbers take a base and zero padding from a suffix: {frame01} */
export function fillTemplate(t: string, vars: Record<string, string>, frame: number, tagFrame: number) {
  return t.replace(/\{(\w+?)(\d*)\}/g, (all, name: string, digits: string) => {
    if (name === 'frame' || name === 'tagframe') {
      const n = (name === 'frame' ? frame : tagFrame) + (digits ? +digits : 0);
      return String(n).padStart(digits.length, '0');
    }
    return vars[name + digits] ?? vars[name] ?? all;
  });
}

function hash(data: Uint32Array, r: Rect, w: number) {
  let h = 2166136261 ^ r.w ^ (r.h << 12);
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) h = Math.imul(h ^ data[y * w + x], 16777619);
  return `${r.w}x${r.h}:${h >>> 0}`;
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Smallest-area shelf packing over a few candidate widths (tallest first) */
function pack(slots: Slot[], spacing: number, border: number) {
  const order = slots.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  const area = slots.reduce((t, s) => t + (s.w + spacing) * (s.h + spacing), 0);
  const widest = Math.max(...slots.map(s => s.w));
  let best: { w: number; h: number; pos: [number, number][]; } | null = null;
  for (let k = 0; k < 24; k++) {
    const limit = Math.max(widest, Math.ceil(Math.sqrt(area) * (0.6 + k * 0.1)));
    const pos: [number, number][] = [];
    let x = 0, y = 0, shelf = 0, w = 0;
    for (const s of order) {
      if (x > 0 && x + s.w > limit) { x = 0; y += shelf + spacing; shelf = 0; }
      pos.push([x, y]);
      x += s.w + spacing;
      shelf = Math.max(shelf, s.h);
      w = Math.max(w, x - spacing);
    }
    const h = y + shelf;
    if (!best || w * h < best.w * best.h || (w * h === best.w * best.h && Math.max(w, h) < Math.max(best.w, best.h)))
      best = { w, h, pos };
  }
  order.forEach((s, i) => { s.x = border + best!.pos[i][0]; s.y = border + best!.pos[i][1]; });
  return { width: best!.w + border * 2, height: best!.h + border * 2 };
}

export type SheetContext = {
  sprite: Pick<SpriteContext, 'width' | 'height' | 'layers' | 'frames' | 'tags' | 'slices' | 'render' | 'visibleDeep'>;
  prefs: { gridX: number; gridY: number; gridW: number; gridH: number };
};

export function buildSheet(o: SheetOptions, { sprite, prefs }: SheetContext) {
  const areas = o.area ? o.frames.map(f => o.area!(f)).filter((r): r is Rect => !!r) : [];
  const W = o.area ? Math.max(1, ...areas.map(r => r.w)) : sprite.width;
  const H = o.area ? Math.max(1, ...areas.map(r => r.h)) : sprite.height;

  // 1. Samples
  const layers = o.splitLayers
    ? sprite.layers.map((l, i) => !l.group && sprite.visibleDeep(i) ? i : -1).filter(i => i >= 0).reverse()
    : [o.layer ?? null];
  const tagged = o.splitTags && sprite.tags.length
    ? sprite.tags.map(t => ({ tag: t as Tag | null, frames: o.frames.filter(f => f >= t.from && f <= t.to) })).filter(g => g.frames.length)
    : [{ tag: null as Tag | null, frames: o.frames }];
  const samples: Omit<Sample, 'slot'>[] = [];
  for (const { tag, frames } of tagged)
    for (const layer of layers)
      frames.forEach((frame, index) => {
        const r = o.area?.(frame) ?? { x: 0, y: 0, w: W, h: H };
        const crop = new OffscreenCanvas(W, H);
        crop.getContext('2d')!.drawImage(sprite.render(frame, layer ?? undefined), r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const data = new Uint32Array(crop.getContext('2d')!.getImageData(0, 0, W, H).data.buffer);
        samples.push({ frame, layer, tag, index, data, src: { x: 0, y: 0, w: W, h: H } });
      });

  // 2. Trim
  const snap = (r: Rect): Rect => {
    if (!o.trimByGrid) return r;
    const { gridX: gx, gridY: gy, gridW: gw, gridH: gh } = prefs;
    const x0 = Math.floor((r.x - gx) / gw) * gw + gx, y0 = Math.floor((r.y - gy) / gh) * gh + gy;
    const x1 = Math.ceil((r.x + r.w - gx) / gw) * gw + gx, y1 = Math.ceil((r.y + r.h - gy) / gh) * gh + gy;
    const x = Math.max(0, x0), y = Math.max(0, y0);
    return { x, y, w: Math.min(W, x1) - x, h: Math.min(H, y1) - y };
  };
  const bounds = samples.map(s => opaqueBounds({ w: W, h: H, data: s.data }));
  let kept = samples.map((s, i) => ({ s, b: bounds[i] }));
  if (o.ignoreEmpty) kept = kept.filter(k => k.b);
  if (o.trim === 'sprite') {
    // One box for every frame: same-sized frames, content aligned
    let u: Rect | null = null;
    for (const { b } of kept) if (b) u = u ? { x: Math.min(u.x, b.x), y: Math.min(u.y, b.y), w: Math.max(u.x + u.w, b.x + b.w) - Math.min(u.x, b.x), h: Math.max(u.y + u.h, b.y + b.h) - Math.min(u.y, b.y) } : b;
    const r = snap(u ?? { x: 0, y: 0, w: 1, h: 1 });
    kept.forEach(k => { k.s.src = r; });
  } else if (o.trim === 'cels') {
    // An empty frame keeps a 1×1 entry so its duration and position in the tag survive
    kept.forEach(k => { k.s.src = k.b ? snap(k.b) : { x: 0, y: 0, w: 1, h: 1 }; });
  }

  // 3. Unique images share one slot
  const pad = o.inner + (o.extrude ? 1 : 0);
  const merge = o.mergeDuplicates || o.type === 'packed';
  const slots = new Map<string, Slot>();
  const all: Sample[] = [];
  let unique = 0;
  for (const { s } of kept) {
    const band = `${o.splitTags ? s.tag?.name ?? '' : ''}|${o.splitLayers ? s.layer : ''}`;
    const key = merge ? hash(s.data, s.src, W) : `#${unique}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = { w: s.src.w + pad * 2, h: s.src.h + pad * 2, x: 0, y: 0, band };
      slots.set(key, slot);
      unique++;
    }
    all.push({ ...s, slot });
  }
  const list = [...slots.values()];

  // 4. Layout
  let width = 0, height = 0;
  if (!list.length) { width = height = 1; } else if (o.type === 'packed') {
    ({ width, height } = pack(list, o.spacing, o.border));
  } else {
    const byRows = o.type !== 'columns' && o.type !== 'vertical';
    const limit = o.type === 'horizontal' || o.type === 'vertical' ? Infinity
      : o.count > 0 ? o.count : Math.ceil(Math.sqrt(list.length));
    let a = o.border, b = o.border, n = 0, cross = 0, prevBand = list[0].band;
    for (const s of list) {
      // A new layer / tag starts a new row (or column)
      if (n > 0 && (n >= limit || s.band !== prevBand)) {
        b += cross + o.spacing;
        a = o.border; n = 0; cross = 0;
      }
      if (byRows) { s.x = a; s.y = b; a += s.w + o.spacing; cross = Math.max(cross, s.h); }
      else { s.x = b; s.y = a; a += s.h + o.spacing; cross = Math.max(cross, s.w); }
      n++;
      prevBand = s.band;
      width = Math.max(width, s.x + s.w);
      height = Math.max(height, s.y + s.h);
    }
    width += o.border;
    height += o.border;
  }
  if (o.powerOfTwo) { width = pow2(width); height = pow2(height); }

  // 5. Render (each unique image once)
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const drawn = new Set<Slot>();
  for (const s of all) {
    if (drawn.has(s.slot)) continue;
    drawn.add(s.slot);
    const img = new ImageData(new Uint8ClampedArray(s.data.slice().buffer), W, H);
    const tmp = new OffscreenCanvas(W, H);
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    const x = s.slot.x + pad, y = s.slot.y + pad, { w, h } = s.src;
    ctx.drawImage(tmp, s.src.x, s.src.y, w, h, x, y, w, h);
    if (o.extrude) {
      // Copy the outermost rows/columns (and corners) one pixel outward
      const e = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, sw, sh);
      e(x, y, w, 1, x, y - 1); e(x, y + h - 1, w, 1, x, y + h);
      e(x - 0, y - 1, 1, h + 2, x - 1, y - 1); e(x + w - 1, y - 1, 1, h + 2, x + w, y - 1);
    }
  }

  return { canvas, width, height, samples: all, pad, extrude: o.extrude ? 1 : 0, options: o };
}

/** The data file (hash or array flavour) describing every frame of a built sheet */
export function sheetData(sheet: Sheet, title: string, image: string, flavour: 'hash' | 'array', sprite: SheetContext['sprite']) {
  const o = sheet.options, k = o.scale, ex = sheet.extrude;
  const entries = sheet.samples.map((s, i) => {
    const vars: Record<string, string> = {
      title, extension: 'png', layer: s.layer !== null ? sprite.layers[s.layer].name : '',
      group: s.layer !== null && parentOf(sprite.layers, s.layer) >= 0 ? sprite.layers[parentOf(sprite.layers, s.layer)].name : '',
      tag: s.tag?.name ?? '', duration: String(sprite.frames[s.frame].duration),
      // User notes: {layerdata}, {tagdata}
      layerdata: s.layer !== null ? sprite.layers[s.layer].userData?.text ?? '' : '', tagdata: s.tag?.userData?.text ?? '',
    };
    const name = fillTemplate(o.template || defaultTemplate(o), vars, i, s.index);
    // The frame rectangle leaves the extruded pixels out
    const frame = { x: (s.slot.x + ex) * k, y: (s.slot.y + ex) * k, w: (s.slot.w - 2 * ex) * k, h: (s.slot.h - 2 * ex) * k };
    return {
      filename: name,
      frame,
      rotated: false,
      trimmed: s.src.x !== 0 || s.src.y !== 0 || s.src.w !== sprite.width || s.src.h !== sprite.height,
      spriteSourceSize: { x: s.src.x * k, y: s.src.y * k, w: s.src.w * k, h: s.src.h * k },
      sourceSize: { w: sprite.width * k, h: sprite.height * k },
      duration: sprite.frames[s.frame].duration,
    };
  });
  const frames = flavour === 'hash' ? Object.fromEntries(entries.map(({ filename, ...rest }) => [filename, rest])) : entries;
  return JSON.stringify({
    frames,
    meta: {
      app: 'Pixprite',
      version: '0.1',
      image,
      format: 'RGBA8888',
      size: { w: sheet.width * k, h: sheet.height * k },
      scale: String(k),
      frameTags: sprite.tags.map(t => ({ name: t.name, from: t.from, to: t.to, direction: t.direction, color: t.color, ...(t.repeat ? { repeat: String(t.repeat) } : {}), ...(t.userData?.text ? { data: t.userData.text } : {}) })),
      slices: sprite.slices.map(sl => ({
        name: sl.name, color: sl.color, ...(sl.userData?.text ? { data: sl.userData.text } : {}),
        keys: sl.keys.map(key => ({
          frame: key.frame, bounds: { x: key.x, y: key.y, w: key.w, h: key.h },
          ...(key.center ? { center: key.center } : {}), ...(key.pivot ? { pivot: key.pivot } : {}),
        })),
      })),
      layers: sprite.layers.map((l, i) => {
        const p = parentOf(sprite.layers, i);
        return { name: l.name, ...(p >= 0 ? { group: sprite.layers[p].name } : {}), ...(l.group ? {} : { opacity: Math.round(l.opacity * 255), blendMode: l.blend }), ...(l.userData?.text ? { data: l.userData.text } : {}), ...(l.userData?.color ? { color: l.userData.color } : {}) };
      }).reverse(),
    },
  }, null, 2);
}
