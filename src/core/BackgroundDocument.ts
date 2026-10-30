/** DOM-free document preparation shared by workers and the explicit unsupported-worker fallback. */
import { createCelInstance, createImage } from './DocumentModel';
import { cleanInfo, newLayer, parentOf, type Cel } from './SpriteModel';
import type { SpriteContext } from './SpriteContext';
import { captureDocument, load, toDocument, type DocumentCapture } from './SpriteSerialization';
import * as rendering from './SpriteRenderer';
import type { SheetContext } from './SpriteSheet';
import type { DocumentExportContext } from './SpriteSerialization';
import type { PixpriteData } from './SpriteValidation';
import { serializedBytes } from './Storage';

export function base64(data: Uint32Array) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function encodeCapture(raw: DocumentCapture): PixpriteData {
  return {
    ...raw,
    images: raw.images.map(image => ({ ...image, d: base64(image.d) })),
    tilesets: raw.tilesets.map(ts => {
      const all = new Uint32Array(ts.count * ts.tw * ts.th);
      ts.d.forEach((tile, i) => all.set(tile, i * ts.tw * ts.th));
      return { ...ts, d: base64(all) };
    }),
    layers: raw.layers.map(layer => ({ ...layer, cels: layer.cels.map(cel => cel?.t instanceof Uint32Array ? { ...cel, t: base64(cel.t) } : cel) })),
  };
}

/** Hydration copies buffers; it does no base64, JSON, pixel transforms or integrity traversal. */
export function hydrateCapture(raw: DocumentCapture) {
  const images = new Map(raw.images.map(image => [image.id, createImage(image.w, image.h, image.d, image.id)]));
  const layers = raw.layers.map(layer => {
    const cels: Cel[] = [];
    layer.cels.forEach((cel, i) => {
      if (!cel) cels[i] = null;
      else if ('link' in cel) cels[i] = cels[cel.link];
      else {
        const instance = createCelInstance(images.get(cel.image.id)!, cel);
        if (cel.t) instance.tiles = { cols: cel.tc, rows: cel.tr, refs: cel.t };
        cels[i] = instance;
      }
    });
    return { ...newLayer(layer.name, raw.frames.length), ...layer, cels };
  });
  return { ...raw, info: cleanInfo(raw.info), layers, tilesets: raw.tilesets.map(({ d, count: _count, ...ts }) => ({ ...ts, tiles: d })) };
}

export function documentContext(raw: DocumentCapture) {
  return Object.assign(hydrateCapture(raw), rendering, {
    tags: raw.tags ?? [], slices: raw.slices ?? [], framePalettes: raw.framePalettes ?? [],
    colorMode: raw.colorMode ?? 'rgb', transparentIndex: raw.transparentIndex ?? -1,
    visibleDeep(this: Pick<SpriteContext, 'layers'>, i: number) {
      for (let at = i; at >= 0; at = parentOf(this.layers, at)) if (!this.layers[at].visible) return false;
      return true;
    },
    frame: 0, version: 0, cacheVersion: -1, cache: new Map<string, OffscreenCanvas>(),
    focusLayer: null, floating: null, split: null,
    canvasRect: { x: 0, y: 0, w: raw.width, h: raw.height },
    savedLayers(this: Pick<SpriteContext, 'layers'>) { return this.layers; },
  }) satisfies rendering.RenderContext & SheetContext['sprite'] & DocumentExportContext;
}

/** Use the same synchronous decoder as legacy callers, entirely inside the worker. */
export function decodeCapture(data: unknown): DocumentCapture {
  const context = {
    reset(this: SpriteContext, width: number, height: number, name: string) {
      this.width = width; this.height = height; this.name = name;
    },
    touch() {},
    savedLayers(this: SpriteContext) { return this.layers; },
  } as unknown as SpriteContext;
  load.call(context, typeof data === 'string' ? JSON.parse(data) : data);
  return captureDocument.call(context);
}

export function inspectDocument(data: unknown) {
  decodeCapture(data);
  return serializedBytes(data);
}

export async function prepareDocument(raw: DocumentCapture, preview = false) {
  // Match the existing file/autosave JSON semantics (including omitted optional fields).
  const data = JSON.parse(JSON.stringify(encodeCapture(raw))) as PixpriteData;
  const bytes = inspectDocument(data);
  let thumb = '';
  if (preview && typeof OffscreenCanvas !== 'undefined') {
    const ctx = documentContext(raw);
    const size = 96, k = Math.max(1, Math.floor(size / Math.max(raw.width, raw.height)));
    const canvas = new OffscreenCanvas(Math.min(size, raw.width * k) || 1, Math.min(size, raw.height * k) || 1);
    const painter = canvas.getContext('2d')!;
    painter.imageSmoothingEnabled = false;
    const scale = Math.min(canvas.width / raw.width, canvas.height / raw.height);
    painter.drawImage(ctx.render(0), 0, 0, raw.width * scale, raw.height * scale);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    thumb = `data:image/png;base64,${btoa(binary)}`;
  }
  return { data, bytes, thumb };
}

export function asepriteDocument(raw: DocumentCapture) {
  return toDocument.call(documentContext(raw));
}
