import { blendOver, crop, rotate, unionRect, type Bitmap, type Rect } from "~/core/Image";
import { Mask } from "~/core/Mask";
import { renderPlacement, type Placement } from "~/core/Transform";
import type { SpriteContext } from "./SpriteContext";
import { celRect, reframeCel, rootsOf, type Cel, type Floating } from "./SpriteModel";

// Selection

export function setMask(this: SpriteContext, mask: Mask | null, label = 'Select'): void {
  this.dropFloating();
  this.checkpoint(label);
  if (this.mask) this.lastMask = this.mask;
  this.mask = mask && !mask.empty ? mask : null;
}

export function selectAll(this: SpriteContext): void {
  this.setMask(Mask.rect(this.width, this.height, { x: 0, y: 0, w: this.width, h: this.height }), 'Select all');
}

export function deselect(this: SpriteContext): void {
  if (!this.mask && !this.floating) return;
  this.setMask(null, 'Deselect');
}

export function reselect(this: SpriteContext): void {
  if (this.lastMask) this.setMask(this.lastMask, 'Reselect');
}

export function invertSelection(this: SpriteContext): void {
  const base = this.mask ?? new Mask(this.width, this.height);
  this.setMask(base.invert(), 'Invert selection');
}

/** Moves only the selection outline, pixels stay */
export function moveMask(this: SpriteContext, dx: number, dy: number): void {
  if (!this.mask || this.floating) return;
  this.checkpoint('Move selection outline');
  this.mask = this.mask.translate(dx, dy);
  this.touch();
}

/** Bitmap under the selection (or the whole layer), cropped to the selection bounds */
export function selectedBitmap(this: SpriteContext, layer = this.layer, frame = this.frame): { bmp: Bitmap; rect: Rect; shape: Uint8Array; } {
  const { mask } = this;
  // Without a selection the whole cel is taken, including pixels outside the canvas
  const cel = this.getCel(layer, frame);
  const rect = mask?.bounds ?? (cel ? celRect(cel) : this.canvasRect);
  const { data } = reframeCel(cel, rect);
  const bmp = { w: rect.w, h: rect.h, data };
  const shape = new Uint8Array(rect.w * rect.h).fill(1);
  if (mask)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++)
        if (!mask.has(rect.x + x, rect.y + y)) {
          bmp.data[y * rect.w + x] = 0;
          shape[y * rect.w + x] = 0;
        }
  return { bmp, rect, shape };
}

export function eraseSelection(this: SpriteContext): void {
  const { mask } = this;
  const l = this.current;
  const fill = l?.background ? this.backgroundFill : 0;
  if (!mask) return this.setCel(l?.background ? this.filledCel() : null);
  if (!this.getCel()) return;
  const out = this.canvasPixels();
  for (let i = 0; i < out.length; i++) if (mask.data[i]) out[i] = fill;
  this.putCanvas(out);
}

export function makeFloating(this: SpriteContext, src: Bitmap, shape: Uint8Array, place: Placement, layer = this.layer, frame = this.frame): Floating {
  const result = renderPlacement(src, shape, place, this.transformAlgo);
  return { src, shape, place, layer, frame, result };
}

/** Renders the floating pixels for a new placement and updates the selection outline to match */
export function setFloating(this: SpriteContext, f: Floating | null): void {
  this.floating = f;
  if (f) {
    const { x, y, bmp, mask } = f.result;
    this.mask = Mask.fromFn(this.width, this.height, (px, py) => {
      const lx = px - x, ly = py - y;
      return lx >= 0 && ly >= 0 && lx < bmp.w && ly < bmp.h && mask[ly * bmp.w + lx] === 1;
    });
  }
  this.touch();
}

/** Lifts the selected pixels into a floating layer so they can be moved/transformed */
export function liftSelection(this: SpriteContext, copy = false): Floating | null {
  if (this.floating) return this.floating;
  if (!this.editable) return null;
  const { bmp, rect, shape } = this.selectedBitmap();
  this.floatingGuard = this.protectHistory();
  this.checkpoint(copy ? 'Duplicate selection' : 'Transform');
  this.floatingStart = this.historyPosition;
  if (!copy) this.eraseSelection();
  this.setFloating(this.makeFloating(bmp, shape, {
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, angle: 0,
    px: rect.x + rect.w / 2, py: rect.y + rect.h / 2,
  }));
  return this.floating;
}

/** New placement for the floating pixels; re-rendered from the original every time */
export function placeFloating(this: SpriteContext, place: Placement): void {
  const f = this.floating;
  if (!f) return;
  this.setFloating(this.makeFloating(f.src, f.shape, place, f.layer, f.frame));
}

export function moveFloating(this: SpriteContext, x: number, y: number): void {
  const f = this.floating;
  if (!f) return;
  const dx = x - f.place.x, dy = y - f.place.y;
  this.placeFloating({ ...f.place, x, y, px: f.place.px + dx, py: f.place.py + dy });
}

/** Swaps the floating pixels for a new image at the same spot (live text while typing) */
export function replaceFloating(this: SpriteContext, bmp: Bitmap): void {
  const f = this.floating;
  if (!f) return;
  const shape = Uint8Array.from(bmp.data, v => v >>> 24 ? 1 : 0);
  this.setFloating(this.makeFloating(bmp, shape, { ...f.place, w: bmp.w, h: bmp.h, px: f.place.x + bmp.w / 2, py: f.place.y + bmp.h / 2 }, f.layer, f.frame));
}

/** Re-render with the current algorithm (after the user switches it) */
export function rerenderFloating(this: SpriteContext): void {
  if (this.floating) this.placeFloating(this.floating.place);
}

/**
 * The floating pixels composited over a copy of their cel.
 * The cel grows to hold them, so nothing dropped outside the canvas is lost.
 */
export function mergeFloating(this: SpriteContext, f: Floating): Cel {
  const { x, y, bmp } = f.result;
  const cel = this.getCel(f.layer, f.frame);
  const background = this.layers[f.layer]?.background;
  const rect = background ? this.canvasRect : unionRect(cel && celRect(cel), { x, y, w: bmp.w, h: bmp.h })!;
  const out = reframeCel(cel, rect);
  for (let ly = 0; ly < bmp.h; ly++) {
    const ty = y + ly - rect.y;
    if (ty < 0 || ty >= rect.h) continue;
    for (let lx = 0; lx < bmp.w; lx++) {
      const tx = x + lx - rect.x;
      const v = bmp.data[ly * bmp.w + lx];
      if (tx < 0 || tx >= rect.w || !(v >>> 24)) continue;
      const i = ty * rect.w + tx;
      out.data[i] = blendOver(out.data[i], v);
    }
  }
  return out;
}

/** Writes floating pixels into their cel (alpha composited) */
export function dropFloating(this: SpriteContext): void {
  const f = this.floating;
  if (!f) return;
  const guard = this.floatingGuard; this.floatingGuard = null;
  this.floating = null;
  this.floatingStart = -1;
  if (this.layers[f.layer]) this.setCel(this.mergeFloating(f), f.layer, f.frame);
  this.touch();
  guard?.commit();
}

/** Throws away the transformation and restores the pixels from before the lift */
export function cancelFloating(this: SpriteContext): void {
  if (!this.floating || this.floatingStart < 0) return;
  const target = this.floatingStart - 1;
  this.floatingStart = -1;
  const guard = this.floatingGuard; this.floatingGuard = null;
  if (guard) guard.cancel(); else this.rollback(target);
  this.redoStack = [];
  this.syncHistory();
}

/** Stamp a copy of the floating pixels and keep moving the original (Ctrl+drag while floating) */
export function stampFloating(this: SpriteContext): void {
  const f = this.floating;
  if (!f || !this.layers[f.layer]) return;
  this.setCel(this.mergeFloating(f), f.layer, f.frame);
}

/** Replace the selected pixels (or the whole cel) through `fn` */
export function transformSelection(this: SpriteContext, label: string, fn: (bmp: Bitmap) => Bitmap): void {
  const f = this.floating ?? (this.mask ? this.liftSelection() : null);
  if (f) {
    // Part of the floating session: one undo step for the whole transformation
    const bmp = fn(f.src);
    const shapeBmp = fn({ w: f.src.w, h: f.src.h, data: Uint32Array.from(f.shape) });
    const shape = Uint8Array.from(shapeBmp.data);
    const p = f.place;
    // Keep the block centered where it was
    const w = Math.sign(p.w || 1) * bmp.w, h = Math.sign(p.h || 1) * bmp.h;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    this.setFloating(this.makeFloating(bmp, shape, {
      ...p, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2),
    }, f.layer, f.frame));
    return;
  }
  if (!this.editable) return;
  const cel = this.getCel();
  if (!cel) return;
  this.checkpoint(label);
  // The whole cel turns around its own center
  const bmp = fn(cel);
  this.setCel({
    x: cel.x + Math.round((cel.w - bmp.w) / 2), y: cel.y + Math.round((cel.h - bmp.h) / 2),
    w: bmp.w, h: bmp.h, data: bmp.data,
  });
}

/** Rotate the selection by quarter turns as a live transform (the user can still move it) */
export function rotateSelection(this: SpriteContext, turns: number): void {
  const f = this.floating ?? (this.mask ? this.liftSelection() : null);
  if (!f) return this.transformSelection('Turn', b => rotate(b, turns));
  this.placeFloating({ ...f.place, angle: ((f.place.angle + turns * 90) % 360 + 360) % 360 });
}

/** Apply a per-pixel color function to the selection (or the whole cel) */
export function mapPixels(this: SpriteContext, label: string, fn: (v: number) => number): void {
  const f = this.floating;
  if (f) {
    this.setFloating(this.makeFloating({ ...f.src, data: f.src.data.map(fn) }, f.shape, f.place, f.layer, f.frame));
    return;
  }
  const cel = this.getCel();
  if (!this.editable || !cel) return;
  this.checkpoint(label);
  if (!this.mask) return this.setCel({ ...cel, data: cel.data.map(fn) });
  const out = this.canvasPixels();
  for (let i = 0; i < out.length; i++)
    if (this.mask.data[i]) out[i] = fn(out[i]);
  this.putCanvas(out);
}

/** Replace the selection's pixels with a whole-buffer filter result */
export function applyFilter(this: SpriteContext, label: string, fn: (data: Uint32Array, mask: Mask | null, layer: number) => Uint32Array, cels: [number, number][] = [[this.layer, this.frame]]): void {
  this.dropFloating();
  this.checkpoint(label);
  const done = new Set<Cel>();
  for (const [li, fi] of cels) {
    const l = this.layers[li];
    const cel = l?.cels[fi];
    if (!l || this.lockedDeep(li) || l.reference || !cel || done.has(cel)) continue;
    // Filters see the canvas; linked cels share the result through putCanvas
    this.putCanvas(fn(this.canvasPixels(li, fi), this.mask, li), li, fi);
    done.add(l.cels[fi]);
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function clearSelection(this: SpriteContext): void {
  if (this.floating) {
    const guard = this.floatingGuard; this.floatingGuard = null;
    this.checkpoint('Clear');
    this.floating = null;
    this.floatingStart = -1;
    this.mask = null;
    this.touch();
    guard?.commit();
    return;
  }
  if (!this.editable) return;
  this.checkpoint('Clear');
  this.eraseSelection();
}

export function copySelection(this: SpriteContext, merged = false): Bitmap | null {
  const f = this.floating;
  if (f) return { ...f.result.bmp, data: f.result.bmp.data.slice() };
  if (!merged) return this.selectedBitmap().bmp;
  const rect = this.mask?.bounds ?? { x: 0, y: 0, w: this.width, h: this.height };
  const data = this.flatten(this.frame, rootsOf(this.layers).filter(i => this.layers[i].visible))!.data;
  const bmp = crop({ w: this.width, h: this.height, data }, rect);
  if (this.mask)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++)
        if (!this.mask.has(rect.x + x, rect.y + y)) bmp.data[y * rect.w + x] = 0;
  return bmp;
}

/** Where copied pixels came from, used to paste them back in place */
export function getSelectionOrigin(this: SpriteContext): { x: number; y: number; } | null {
  const b = this.floating ? { x: this.floating.result.x, y: this.floating.result.y } : this.mask?.bounds;
  return b ? { x: b.x, y: b.y } : null;
}

export function paste(this: SpriteContext, bmp: Bitmap, at?: { x: number; y: number; }, label = 'Paste'): void {
  if (!this.editable) return;
  this.dropFloating();
  this.floatingGuard = this.protectHistory();
  this.checkpoint(label);
  this.floatingStart = this.historyPosition;
  // At least one pixel stays over the canvas; the rest may hang outside (the cel grows to keep it)
  const x = Math.max(1 - bmp.w, Math.min(this.width - 1, at?.x ?? Math.round((this.width - bmp.w) / 2)));
  const y = Math.max(1 - bmp.h, Math.min(this.height - 1, at?.y ?? Math.round((this.height - bmp.h) / 2)));
  const shape = Uint8Array.from(bmp.data, v => v >>> 24 ? 1 : 0);
  this.setFloating(this.makeFloating(bmp, shape, {
    x, y, w: bmp.w, h: bmp.h, angle: 0, px: x + bmp.w / 2, py: y + bmp.h / 2,
  }));
}
