import { bitmapToCanvas, unionRect } from "~/core/Image";
import type { SpriteContext } from "./SpriteContext";
import { celRect, childrenOf, rootsOf, subtreeStart, type Cel } from "./SpriteModel";
import { bakeCel, effectsForFrame, type LayerFX } from './DocumentModel';

/** Drawing is independent of editor state, cache ownership and playback. */
export type DrawingContext = Pick<SpriteContext, 'layers' | 'floating' | 'canvasRect' | 'drawLayer' | 'drawNode' | 'drawSiblings'> & {
  effectsPreview?: { layer: number; effects: readonly LayerFX[] } | null;
};
export type RenderContext = DrawingContext & Pick<SpriteContext,
  'width' | 'height' | 'frame' | 'canvasRect' | 'version' | 'cache' | 'cacheVersion' | 'focusLayer' | 'split' | 'renderSplit'>;

const renderEffects = (context: DrawingContext, layer: number, frame: number) => effectsForFrame(
  context.effectsPreview?.layer === layer ? { ...context.layers[layer], effects: [...context.effectsPreview.effects] } : context.layers[layer], frame);

/** Validate before allocation or document mutation, including pending floating pixels. */
export function groupBounds(this: Pick<DrawingContext, 'layers' | 'floating'>, index: number, frame: number) {
  let rect = null as ReturnType<typeof unionRect>;
  const start = subtreeStart(this.layers, index);
  for (let i = start; i < index; i++) {
    const cel = this.layers[i].cels[frame];
    if (cel) rect = unionRect(rect, celRect(cel));
  }
  const f = this.floating;
  if (f && f.frame === frame && f.layer >= start && f.layer < index)
    rect = unionRect(rect, { x: f.result.x, y: f.result.y, w: f.result.bmp.w, h: f.result.bmp.h });
  if (rect && (rect.w > 4096 || rect.h > 4096 || rect.w * rect.h > 16_777_216)) throw new RangeError('Layer FX bounds exceed 4096 × 4096 pixels');
  return rect;
}

/** Isolated group pixels, retaining off-canvas content. Outer opacity/blend/clip are applied by its parent. */
export function groupCel(this: DrawingContext, index: number, frame: number): Cel {
  const rect = groupBounds.call(this, index, frame);
  if (!rect) return null;
  const canvas = new OffscreenCanvas(rect.w, rect.h), ctx = canvas.getContext('2d')!;
  this.drawSiblings(ctx, childrenOf(this.layers, index), frame, undefined, rect.x, rect.y);
  return bakeCel({ ...rect, data: new Uint32Array(ctx.getImageData(0, 0, rect.w, rect.h).data.buffer) }, renderEffects(this, index, frame));
}

// Rendering

/**
 * Draws a layer at its cels' positions; (ox, oy) is the sprite point at the context's origin.
 * `override` is a canvas-sized buffer shown instead of the cel (previews).
 */
export function drawLayer(this: DrawingContext, ctx: OffscreenCanvasRenderingContext2D, index: number, frame: number, force = false, override?: Uint32Array, ox = 0, oy = 0): void {
  const layer = this.layers[index];
  if (!layer || (!force && !layer.visible)) return;
  const cel: Cel = override ? { ...this.canvasRect, data: override } : layer.cels[frame];
  const effects = renderEffects(this, index, frame);
  const f = this.floating;
  const hasFloating = f && f.layer === index && f.frame === frame;
  if (!cel && !hasFloating) return;

  let src: OffscreenCanvas;
  let sx = cel?.x ?? 0, sy = cel?.y ?? 0;
  if (hasFloating) {
    // Drawn inside the layer so its opacity and blend apply: dropping causes no visual jump
    const r = unionRect(cel && celRect(cel), { x: f.result.x, y: f.result.y, w: f.result.bmp.w, h: f.result.bmp.h })!;
    src = new OffscreenCanvas(r.w, r.h);
    const c = src.getContext('2d')!;
    if (cel) c.drawImage(bitmapToCanvas(cel), cel.x - r.x, cel.y - r.y);
    c.drawImage(bitmapToCanvas(f.result.bmp), f.result.x - r.x, f.result.y - r.y);
    sx = r.x;
    sy = r.y;
    if (effects.length) {
      const data = new Uint32Array(c.getImageData(0, 0, r.w, r.h).data.buffer);
      src = bitmapToCanvas(bakeCel({ x: 0, y: 0, w: r.w, h: r.h, data }, effects)!);
    }
  } else src = bitmapToCanvas(bakeCel(cel, effects)!);
  ctx.globalAlpha = layer.opacity * (layer.celOpacity[frame] ?? 1);
  ctx.globalCompositeOperation = layer.blend;
  ctx.drawImage(src, sx - ox, sy - oy);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Draws a layer, or a group composited from its children with the group's opacity and blend */
export function drawNode(this: DrawingContext, ctx: OffscreenCanvasRenderingContext2D, i: number, frame: number, force: boolean, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0): void {
  const l = this.layers[i];
  if (!l || (!force && !l.visible)) return;
  if (!l.group) return this.drawLayer(ctx, i, frame, true, override?.(i), ox, oy);
  const can = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
  const c = can.getContext('2d')!;
  this.drawSiblings(c, childrenOf(this.layers, i), frame, override, ox, oy);
  const effects = renderEffects(this, i, frame);
  const pixels = effects.some(effect => effect.enabled && effect.amount !== 1)
    ? bitmapToCanvas(bakeCel({ x: 0, y: 0, w: can.width, h: can.height, data: new Uint32Array(c.getImageData(0, 0, can.width, can.height).data.buffer) }, effects)!) : can;
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = l.blend;
  ctx.drawImage(pixels, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draws sibling nodes bottom to top. A run of clipping layers is drawn on a copy of the
 * layer under it, masked by that layer's alpha, then the result goes down with its blend.
 */
export function drawSiblings(this: DrawingContext, ctx: OffscreenCanvasRenderingContext2D, list: number[], frame: number, override?: (i: number) => Uint32Array | undefined, ox = 0, oy = 0, vis = (i: number) => this.layers[i].visible): void {
  const L = this.layers;
  for (let n = 0; n < list.length; n++) {
    const i = list[n];
    let m = n + 1;
    while (m < list.length && L[list[m]].clip) m++;
    if (m === n + 1 || !vis(i)) {
      // Clipping layers over a hidden base are hidden too
      if (vis(i)) this.drawNode(ctx, i, frame, true, override, ox, oy);
      n = m - 1;
      continue;
    }
    const { width, height } = ctx.canvas;
    const base = new OffscreenCanvas(width, height);
    this.drawNode(base.getContext('2d')!, i, frame, true, override, ox, oy);
    const out = new OffscreenCanvas(width, height);
    const oc = out.getContext('2d')!;
    oc.drawImage(base, 0, 0);
    for (let k = n + 1; k < m; k++) {
      const j = list[k];
      if (!vis(j)) continue;
      const layer = new OffscreenCanvas(width, height);
      const lc = layer.getContext('2d')!;
      this.drawNode(lc, j, frame, true, override, ox, oy);
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(base, 0, 0);
      oc.globalCompositeOperation = L[j].blend;
      oc.drawImage(layer, 0, 0);
    }
    ctx.globalCompositeOperation = L[i].blend;
    ctx.drawImage(out, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    n = m - 1;
  }
}

/** Composite as below + layer + above, reusing the cached parts; null when the layer stack doesn't allow it */
export function renderSplit(this: RenderContext, frame: number, at: number, override?: (i: number) => Uint32Array | undefined): OffscreenCanvas | null {
  const L = this.layers;
  const roots = rootsOf(L);
  const n = roots.indexOf(at);
  const l = L[at];
  if (n < 0 || !l || l.group || l.clip || L[roots[n + 1]]?.clip) return null;
  const above = roots.slice(n + 1);
  // Blending above the layer depends on what is under it
  if (above.some(i => L[i].blend !== 'source-over')) return null;
  const sig: unknown[] = [frame, at, this.width, this.height, this.floating];
  L.forEach((x, i) => { if (i !== at) sig.push(x, x.cels[frame]); });
  const old = this.split;
  if (!old || old.sig.length !== sig.length || old.sig.some((v, k) => v !== sig[k])) {
    const below = new OffscreenCanvas(this.width, this.height);
    this.drawSiblings(below.getContext('2d')!, roots.slice(0, n), frame, override);
    const top = new OffscreenCanvas(this.width, this.height);
    this.drawSiblings(top.getContext('2d')!, above, frame, override);
    this.split = { sig, below, above: top };
  }
  const out = new OffscreenCanvas(this.width, this.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(this.split!.below, 0, 0);
  this.drawNode(ctx, at, frame, false, override);
  ctx.drawImage(this.split!.above, 0, 0);
  return out;
}

/**
 * Flattened image of a frame, cached until the next change.
 * `only` renders a single layer; `override` swaps one layer's pixels (brush preview) and skips the cache.
 */
export function render(this: RenderContext, frame = this.frame, only?: number, override?: { layer: number; data: Uint32Array; }): OffscreenCanvas {
  if (this.cacheVersion !== this.version) {
    this.cache.clear();
    this.cacheVersion = this.version;
  }
  const key = `${frame}:${only ?? ''}`;
  const cached = !override && this.cache.get(key);
  if (cached) return cached;

  const out = new OffscreenCanvas(this.width, this.height);
  const ctx = out.getContext('2d')!;
  const data = (i: number) => override?.layer === i ? override.data : undefined;
  if (only !== undefined) this.drawNode(ctx, only, frame, true, data);
  else {
    const fast = this.focusLayer !== null && !override ? this.renderSplit(frame, this.focusLayer) : null;
    if (fast) ctx.drawImage(fast, 0, 0);
    else {
      if (this.focusLayer === null) this.split = null;
      this.drawSiblings(ctx, rootsOf(this.layers), frame, data);
    }
  }
  if (!override) this.cache.set(key, out);
  return out;
}
