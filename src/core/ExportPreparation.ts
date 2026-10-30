/** Export rendering, trimming, packing and compression run without editor state or DOM access. */
import type { ExportOptions } from './Files';
import type { DocumentCapture } from './SpriteSerialization';
import { documentContext } from './BackgroundDocument';
import { opaqueBounds, type Rect } from './Image';
import { buildSheet, sheetData, type SheetOptions, type SheetContext } from './SpriteSheet';
import { encodeApng } from './formats/Apng';
import { encodeGif } from './Gif';
import { encodeIco } from './formats/Ico';

export type Output = { name: string; blob: Blob };
export type VideoExport = { name: string; width: number; height: number; frames: { data: Uint8ClampedArray; delay: number }[] };
export type PreparedExport = Output[] | VideoExport;
export type ExportRequest = {
  raw: DocumentCapture; opts: ExportOptions; base: string; frames: number[];
  areas: Record<number, Rect | null>; grid: SheetContext['prefs'];
};

function scaled(source: OffscreenCanvas, scale: number) {
  if (scale === 1) return source;
  const out = new OffscreenCanvas(source.width * scale, source.height * scale);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export async function prepareExport(args: ExportRequest): Promise<PreparedExport> {
  const { opts, base, frames, areas } = args;
  const sprite = documentContext(args.raw);
  /** Bounds of the used pixels of the frames inside their areas (canvas coordinates) */
  function contentBounds(opts: ExportOptions, frames: number[]): Rect | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of frames) {
      const r = areas[f] ?? null;
      if (!r || r.w < 1 || r.h < 1) continue;
      const ctx = sprite.render(f, opts.layer).getContext('2d')!;
      const data = new Uint32Array(ctx.getImageData(r.x, r.y, r.w, r.h).data.buffer);
      const b = opaqueBounds({ w: r.w, h: r.h, data });
      if (!b) continue;
      x0 = Math.min(x0, r.x + b.x); y0 = Math.min(y0, r.y + b.y);
      x1 = Math.max(x1, r.x + b.x + b.w); y1 = Math.max(y1, r.y + b.y + b.h);
    }
    return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** Per-frame source rectangles, trimmed when asked; frames without one are left out */
  function exportRects(opts: ExportOptions, frames: number[]) {
    const out = new Map<number, Rect>();
    const box = opts.trim ? contentBounds(opts, frames) : null;
    for (const f of frames) {
      let r = areas[f] ?? null;
      if (!r) continue;
      if (box) {
        const x = Math.max(r.x, box.x), y = Math.max(r.y, box.y);
        const w = Math.min(r.x + r.w, box.x + box.w) - x, h = Math.min(r.y + r.h, box.y + box.h) - y;
        // Nothing of the content inside: a single empty pixel keeps the frame timing
        r = w > 0 && h > 0 ? { x, y, w, h } : { x: r.x, y: r.y, w: 1, h: 1 };
      }
      out.set(f, r);
    }
    return out;
  }

  /** Output size: the largest exported rectangle (frames sit at its top-left) */
  function rectsSize(rects: Map<number, Rect>) {
    const all = [...rects.values()];
    return { w: Math.max(1, ...all.map(r => r.w)), h: Math.max(1, ...all.map(r => r.h)) };
  }

  /** A frame cropped to its export rectangle and scaled */
  function cropCanvas(opts: ExportOptions, f: number, r: Rect, size: { w: number; h: number; }) {
    const out = new OffscreenCanvas(size.w, size.h);
    out.getContext('2d')!.drawImage(sprite.render(f, opts.layer), r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return scaled(out, opts.scale);
  }

  const png = (can: OffscreenCanvas) => can.convertToBlob({ type: 'image/png' });

  if (opts.kind === 'sheet' && opts.sheet) {
    const so: SheetOptions = { ...opts.sheet!, frames: frames.filter(f => !!areas[f]), layer: opts.layer, scale: opts.scale, area: f => areas[f] ?? null };
    if (opts.trim && so.trim === 'none') so.trim = 'sprite';
    const sheet = buildSheet(so, { sprite, prefs: args.grid });
    const image = `${base}-sheet.png`;
    const out = [{ name: image, blob: await png(scaled(sheet.canvas, opts.scale)) }];
    if (opts.json && opts.json !== 'none')
      out.push({ name: `${base}-sheet.json`, blob: new Blob([sheetData(sheet, base, image, opts.json, sprite)], { type: 'application/json' }) });
    return out;
  }

  // Frames where the slice is hidden are left out
  const rects = exportRects(opts, frames);
  const shown = frames.filter(f => rects.has(f));
  if (!shown.length) return [];

  if (opts.kind === 'png') {
    const r = rects.get(shown[0])!;
    return [{ name: `${base}.png`, blob: await png(cropCanvas(opts, shown[0], r, r)) }];
  }

  if (opts.kind === 'ico' || opts.kind === 'cur') {
    const r = rects.get(shown[0])!;
    const src = cropCanvas({ ...opts, scale: 1 }, shown[0], r, r);
    const sizes = [...new Set(opts.icoSizes?.length ? opts.icoSizes : [16, 32, 48])].sort((a, b) => a - b);
    const images = await Promise.all(sizes.map(async s => {
      const can = new OffscreenCanvas(s, s);
      const ctx = can.getContext('2d')!;
      // Whole-number zoom when it fits, otherwise shrink; centered
      const k = Math.min(s / r.w, s / r.h), z = k >= 1 ? Math.floor(k) : k;
      const w = Math.max(1, Math.round(r.w * z)), h = Math.max(1, Math.round(r.h * z));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, (s - w) >> 1, (s - h) >> 1, w, h);
      return { width: s, height: s, png: new Uint8Array(await (await png(can)).arrayBuffer()) };
    }));
    const bytes = encodeIco(images, opts.kind === 'cur' ? { x: 0, y: 0 } : undefined);
    return [{ name: `${base}.${opts.kind}`, blob: new Blob([bytes as BlobPart], { type: 'image/x-icon' }) }];
  }

  if (opts.kind === 'frames' || opts.kind === 'zip') {
    // Numbered files keep their zero padding
    const pad = Math.max(2, String(sprite.frames.length).length);
    const size = rectsSize(rects);
    const out: Output[] = [];
    for (const f of shown) {
      const r = rects.get(f)!;
      out.push({ name: `${base}${String(f + 1).padStart(pad, '0')}.png`, blob: await png(cropCanvas(opts, f, r, opts.trim ? size : r)) });
    }
    return out;
  }

  const size = rectsSize(rects);
  const w = size.w * opts.scale, h = size.h * opts.scale;
  const canvases = shown.map(f => cropCanvas(opts, f, rects.get(f)!, size));
  const delays = shown.map(f => sprite.frames[f].duration);

  if (opts.kind === 'apng') {
    const bytes = await encodeApng(w, h, canvases.map((c, i) => ({ data: c.getContext('2d')!.getImageData(0, 0, w, h).data, delay: delays[i] })), opts.loop ?? true ? 0 : 1);
    return [{ name: `${base}.png`, blob: new Blob([bytes as BlobPart], { type: 'image/apng' }) }];
  }

  if (opts.kind === 'webm') {
    return { name: `${base}.webm`, frames: canvases.map((canvas, i) => ({ data: canvas.getContext('2d')!.getImageData(0, 0, w, h).data, delay: delays[i] })), width: w, height: h };
  }

  const gifFrames = canvases.map((c, i) => ({ data: c.getContext('2d')!.getImageData(0, 0, w, h).data, delay: delays[i] }));
  return [{ name: `${base}.gif`, blob: new Blob([encodeGif(w, h, gifFrames, opts.loop ?? true) as BlobPart], { type: 'image/gif' }) }];
}
