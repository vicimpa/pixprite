import * as rendering from './SpriteRenderer';
import type { AseDocument } from "~/core/formats/Aseprite";
import type { SpriteContext } from "./SpriteContext";
import { cleanInfo, lockOwners, subtreeStart, newLayer, TAG_COLORS, tagsByName, trimCel, type Cel, type CelImage, type Frame, type Layer } from "./SpriteModel";
import { isExtData, isLocksRecord, migratePixpriteV3, migratePixpriteV4, migratePixpriteV5, PIXPRITE_VERSION, validateDocumentIntegrity, validatePixpriteShape, type PixpriteData } from "./SpriteValidation";
import { bakeCel, copyEffectScope, effectsForFrame, createCelInstance, createImage, hasCelTransform, imageOf, isCelInstance, hasPixelEffects, hasColorEffects, type Image } from './DocumentModel';

// Serialization

/** Layers with floating pixels merged in, as they would be saved */
export function savedLayers(this: SpriteContext): Layer[] {
  const f = this.floating;
  return this.layers.map((l, li) => ({
    ...l,
    cels: l.cels.map((cel, fi) => f && f.layer === li && f.frame === fi ? this.mergeFloating(f) : cel),
  }));
}

export type DocumentCapture = Omit<PixpriteData, 'images' | 'tilesets'> & {
  images: { id: string; w: number; h: number; d: Uint32Array }[];
  tilesets: (Omit<NonNullable<PixpriteData['tilesets']>[number], 'd'> & { d: Uint32Array[] })[];
};

export type StorageCapture = Omit<DocumentCapture, 'images' | 'tilesets'> & {
  images: { id: string; w: number; h: number; d: Uint32Array | string }[];
  tilesets: (Omit<DocumentCapture['tilesets'][number], 'd'> & { d: Uint32Array[] | Uint32Array | string })[];
};
export type CaptureResource = (owner: object, pixels: () => Uint32Array, immutable?: boolean) => Uint32Array | string;

function serialize(this: SpriteContext, binary = false, resource?: CaptureResource) {
  const images: any[] = [];
  const resources = new Map<string, Image>();
  const b64 = (data: Uint32Array): any => {
    if (binary) return resource ? resource(data, () => data) : data;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const encode = (cel: Cel) => {
    if (!cel) return null;
    const t = cel.tiles;
    const image = imageOf(cel);
    const known = resources.get(image.id);
    if (known && known !== image) throw new Error('Conflicting image resource ID');
    if (!known) {
      resources.set(image.id, image);
      images.push({ id: image.id, w: image.w, h: image.h, d: resource ? resource(image, () => image.data, true) : b64(image.data) });
    }
    const transform = isCelInstance(cel) ? cel.transform : null;
    return { x: cel.x, y: cel.y, image: { kind: 'image' as const, id: image.id },
      ...(transform?.flipX ? { flipX: true } : {}), ...(transform?.flipY ? { flipY: true } : {}),
      ...(transform?.rotation ? { rotation: transform.rotation } : {}), ...(transform && transform.opacity !== 1 ? { opacity: transform.opacity } : {}),
      ...(t ? { tc: t.cols, tr: t.rows, t: b64(t.refs) } : {}), ...(cel.ext ? { ext: cel.ext } : {}) };
  };
  return {
    format: 'pixprite',
    version: PIXPRITE_VERSION,
    images,
    colorMode: this.colorMode,
    transparentIndex: this.transparentIndex,
    name: this.name,
    ...(Object.keys(this.info).length ? { info: this.info } : {}),
    width: this.width,
    height: this.height,
    frames: this.frames,
    tags: this.tags,
    slices: this.slices,
    guides: this.guides,
    framePalettes: this.framePalettes,
    tilesets: this.tilesets.map(ts => {
      if (binary && !resource) return { name: ts.name, tw: ts.tw, th: ts.th, baseIndex: ts.baseIndex, count: ts.tiles.length, d: ts.tiles, ...(ts.userData ? { userData: ts.userData } : {}) };
      const all = new Uint32Array(ts.tiles.length * ts.tw * ts.th);
      ts.tiles.forEach((tile, i) => all.set(tile, i * ts.tw * ts.th));
      return { name: ts.name, tw: ts.tw, th: ts.th, baseIndex: ts.baseIndex, count: ts.tiles.length, d: resource ? resource(ts, () => all) : b64(all), ...(ts.userData ? { userData: ts.userData } : {}) };
    }),
    loop: this.loop,
    ...(Object.keys(this.ext).length ? { ext: this.ext } : {}),
    ...(this.locks ?? this.orphanLocks ? { locks: this.locks ?? this.orphanLocks } : {}),
    // Linked cels are stored once, later frames reference the first one
    layers: this.savedLayers().map(l => ({
      ...l,
      cels: l.cels.map((cel, fi) => {
        const first = cel ? l.cels.indexOf(cel) : -1;
        return first >= 0 && first < fi ? { link: first } : encode(cel);
      }),
    })),
  };
}

export function toJSON(this: SpriteContext): PixpriteData & { images: NonNullable<PixpriteData['images']> } {
  return serialize.call(this) as PixpriteData & { images: NonNullable<PixpriteData['images']> };
}

/** Capture raw pixels and metadata together, before any asynchronous work or encoding. */
export function captureDocument(this: SpriteContext): DocumentCapture {
  return structuredClone(serialize.call(this, true)) as DocumentCapture;
}

/** Reconciles legacy mutable bitmaps, then omits raw buffers for clean cached resources. */
export function captureStorageDocument(this: SpriteContext, resource: CaptureResource): StorageCapture {
  return serialize.call(this, true, resource) as StorageCapture;
}

export function load(this: SpriteContext, data: unknown): void {
  validatePixpriteShape(data);
  if (data.version === 3) {
    data = migratePixpriteV3(data);
    validatePixpriteShape(data);
  }
  if (data.version === 4) {
    data = migratePixpriteV4(data);
    validatePixpriteShape(data);
  }
  if (data.version === 5) {
    data = migratePixpriteV5(data);
    validatePixpriteShape(data);
  }
  const bytes = (s: string) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Uint32Array(out.buffer);
  };
  const images = new Map((data.images ?? []).map(image => [image.id, createImage(image.w, image.h, bytes(image.d), image.id)]));
  const decode = (c: any): Cel => {
    if (!c) return null;
    const image = images.get(c.image.id)!;
    const cel: CelImage = createCelInstance(image, { x: c.x, y: c.y, flipX: c.flipX, flipY: c.flipY, rotation: c.rotation, opacity: c.opacity });
    const t = (c as { t?: string; tc?: number; tr?: number; });
    if (t.t) {
      const refs = bytes(t.t);
      if (refs.length !== t.tc! * t.tr!) throw new Error('Invalid tile reference buffer length');
      cel.tiles = { cols: t.tc!, rows: t.tr!, refs };
    }
    const ext = (c as { ext?: unknown; }).ext;
    if (isExtData(ext)) cel.ext = ext;
    return cel;
  };
  const count = data.frames.length;
  const frames = data.frames.map((f: Frame) => ({ ...f }));
  const tilesets = (data.tilesets ?? []).map(t => {
    const all = bytes(t.d), n = t.tw * t.th;
    if (all.length !== t.count * n) throw new Error('Invalid tileset pixel buffer length');
    return { name: t.name, tw: t.tw, th: t.th, baseIndex: t.baseIndex ?? 1, ...(t.userData ? { userData: t.userData } : {}), tiles: Array.from({ length: t.count }, (_, i) => all.slice(i * n, (i + 1) * n)) };
  });
  const layers = data.layers.map(l => {
    const cels: Cel[] = [];
    l.cels.forEach((c: any, i: number) => cels[i] = c && typeof c === 'object' && 'link' in c ? cels[c.link] ?? null : decode(c));
    return { ...newLayer(l.name, count), ...l, cels, ...(l.effects ? { effects: l.effects.map(effect => ({ ...effect })) } : {}), ...(l.bakedEffects ? { bakedEffects: copyEffectScope(l) } : {}), celOpacity: l.celOpacity ?? Array(count).fill(1) };
  });
  const tags = data.tags ?? [], loop = data.loop ?? null;
  validateDocumentIntegrity({ layers, frames, tags, loop, tilesets });
  // Commit the decoded model only after all buffers and resource references are valid.
  const info = cleanInfo(data.info);
  const locks = isLocksRecord(data.locks) ? data.locks : null;
  const installed = locks ? lockOwners.installed(locks.owner) : false;
  this.reset(data.width, data.height, data.name ?? 'untitled');
  this.info = info;
  this.frames = frames;
  this.layers = layers;
  this.tags = tags;
  this.loop = loop;
  this.tilesets = tilesets;
  this.slices = data.slices ?? [];
  this.guides = data.guides ?? [];
  this.framePalettes = data.framePalettes ?? [];
  this.colorMode = data.colorMode ?? 'rgb';
  this.transparentIndex = data.transparentIndex ?? -1;
  this.ext = data.ext ?? {};
  // Keep locks for absent extensions until installation or an explicit unlock.
  if (installed) this.locks = locks;
  else this.orphanLocks = locks;
  this.touch();
}

export type DocumentExportContext = Pick<SpriteContext,
  'width' | 'height' | 'frames' | 'tags' | 'framePalettes' | 'slices' | 'colorMode' | 'tilesets' | 'transparentIndex' | 'savedLayers'>;

export function toDocument(this: DocumentExportContext): AseDocument {
  const saved = this.savedLayers().filter(layer => !layer.reference);
  // Aseprite cannot encode arbitrary per-frame group FX. Export isolated pixels with
  // the group's outer blend/opacity/clip still attached; the editable source stays intact.
  const layers: Layer[] = [];
  const flattened = new Map<number, Layer>();
  const context = { ...this, ...rendering, layers: saved, floating: null, effectsPreview: null, canvasRect: { x: 0, y: 0, w: this.width, h: this.height } } satisfies rendering.DrawingContext;
  rendering.validateEffectBounds(context, this.frames.map((_, f) => f));
  for (let i = saved.length - 1; i >= 0; i--) {
    const layer = saved[i];
    if (layer.group && hasPixelEffects(layer.effects)) {
      const start = subtreeStart(saved, i);
      flattened.set(start, { ...layer, group: false, collapsed: false, tileset: -1, effects: [], bakedEffects: undefined,
        celOpacity: this.frames.map(() => 1), cels: this.frames.map((_, f) => rendering.groupCel.call(context, i, f)) });
      i = start;
    } else flattened.set(i, layer);
  }
  for (const [, layer] of [...flattened].sort(([a], [b]) => a - b)) layers.push(layer);
  // Indexed pixel payloads cannot retain arbitrary baked alpha through palette lookup.
  const customColor = saved.some(layer => layer.cels.some((_, f) => hasColorEffects(effectsForFrame(layer, f))));
  const trueColor = (this.colorMode === 'gray' && customColor) || (this.colorMode === 'indexed' && (saved.some(layer => layer.group && hasPixelEffects(layer.effects)) || layers.some(layer => !layer.group && (
    layer.cels.some((_, f) => hasPixelEffects(effectsForFrame(layer, f))) || layer.cels.some(cel => cel && isCelInstance(cel) && cel.transform.opacity !== 1)
  ))));
  return {
    width: this.width,
    height: this.height,
    frames: this.frames.map(f => ({ ...f })),
    tags: this.tags.map(t => ({ ...t })),
    palette: this.framePalettes[0]?.colors ?? [],
    slices: this.slices,
    colorMode: trueColor ? 'rgb' : this.colorMode,
    framePalettes: this.framePalettes,
    tilesets: this.tilesets,
    transparentIndex: this.colorMode === 'indexed' && !trueColor ? this.transparentIndex : -1,
    // Reference layers belong to the editor only
    layers: layers.map(l => {
      const baked = new Map<CelImage, Map<string, Cel>>();
      const cels = l.cels.map((cel, frame) => {
        if (!cel) return null;
        const effects = effectsForFrame(l, frame);
        const key = JSON.stringify(effects.map(effect => effect.id));
        const variants = baked.get(cel) ?? new Map<string, Cel>();
        baked.set(cel, variants);
        if (!variants.has(key)) variants.set(key, bakeCel(cel, effects));
        return variants.get(key)!;
      });
      const flattenTiles = l.tileset >= 0 && (l.cels.some((_, f) => hasPixelEffects(effectsForFrame(l, f))) || l.cels.some(cel => cel && hasCelTransform(cel)));
      return {
        name: l.name, visible: l.visible, locked: l.locked, background: l.background, continuous: l.continuous,
        opacity: l.opacity, blend: l.blend,
        cels: flattenTiles ? cels.map(cel => cel && ({ x: cel.x, y: cel.y, w: cel.w, h: cel.h, data: cel.data, ...(cel.ext ? { ext: cel.ext } : {}) })) : cels,
        celOpacity: l.celOpacity,
        group: l.group, depth: l.depth, collapsed: l.collapsed, tileset: flattenTiles ? -1 : l.tileset,
        clip: l.clip, userData: l.userData,
      };
    }),
  };
}

export function fromDocument(this: SpriteContext, doc: AseDocument, name = 'untitled'): void {
  this.reset(doc.width, doc.height, name);
  const count = doc.frames.length;
  this.frames = doc.frames.map(f => ({ ...f }));
  this.tags = doc.tags.map(t => ({ ...t }));
  this.slices = doc.slices ?? [];
  this.colorMode = doc.colorMode ?? 'rgb';
  this.framePalettes = doc.framePalettes ?? [];
  this.tilesets = doc.tilesets ?? [];
  this.transparentIndex = this.colorMode === 'indexed' ? doc.transparentIndex ?? -1 : -1;
  this.layers = doc.layers.map(l => ({
    ...newLayer(l.name, count),
    ...l,
    cels: l.cels.slice(0, count),
    celOpacity: l.celOpacity ?? Array(count).fill(1),
  }));
  if (!this.layers.length) this.layers = [newLayer('Layer 1', count)];
  this.refitBackgrounds();
  this.touch();
}

export function loadImage(this: SpriteContext, image: ImageBitmap | HTMLImageElement, name = 'image'): void {
  const { width, height } = image;
  const tmp = new OffscreenCanvas(width, height);
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  this.reset(width, height, name);
  this.layers = [{ ...newLayer('Layer 1', 1) }];
  this.setCel({ x: 0, y: 0, w: width, h: height, data: new Uint32Array(data.slice().buffer) });
}

/** One frame per buffer (animated GIF, image sequence) */
export function loadFrames(this: SpriteContext, width: number, height: number, frames: { data: Uint32Array; delay: number; }[], name = 'animation'): void {
  this.reset(width, height, name);
  this.frames = frames.map(f => ({ duration: f.delay || 100 }));
  this.layers = [{ ...newLayer('Layer 1', frames.length), cels: frames.map(f => trimCel({ x: 0, y: 0, w: width, h: height, data: f.data })) }];
  this.touch();
}

/**
 * Splits a sheet into frames: cells of cw×ch starting at (x0, y0), read by rows or columns.
 * `partial` keeps cells cut by the sheet edge.
 */
export function loadSheet(this: SpriteContext, image: ImageBitmap, cw: number, ch: number, name = 'sheet', opts: { x0?: number; y0?: number; byColumns?: boolean; partial?: boolean; } = {}): boolean {
  const { x0 = 0, y0 = 0, byColumns = false, partial = false } = opts;
  const fit = (size: number, start: number, cell: number) =>
    Math.max(0, partial ? Math.ceil((size - start) / cell) : Math.floor((size - start) / cell));
  const cols = fit(image.width, x0, cw), rows = fit(image.height, y0, ch);
  const can = new OffscreenCanvas(image.width, image.height);
  const ctx = can.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const cell = (c: number, r: number) => {
    const out = new OffscreenCanvas(cw, ch);
    out.getContext('2d')!.drawImage(can, x0 + c * cw, y0 + r * ch, cw, ch, 0, 0, cw, ch);
    return trimCel({ x: 0, y: 0, w: cw, h: ch, data: new Uint32Array(out.getContext('2d')!.getImageData(0, 0, cw, ch).data.buffer) });
  };
  const cels: Cel[] = [];
  if (byColumns) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cels.push(cell(c, r));
  else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cels.push(cell(c, r));
  if (!cels.length) return false;
  this.reset(cw, ch, name);
  this.frames = cels.map(() => ({ duration: 100 }));
  this.layers = [{ ...newLayer('Sheet', cels.length), cels }];
  this.touch();
  return true;
}

/**
 * Builds frames from a sheet and its JSON description (the common texture-packer layout:
 * `frames` as a list or a name map, each with `frame`, optional `rotated`, `spriteSourceSize`,
 * `sourceSize`, `duration`; `meta.frameTags` become tags). Without tags in the description,
 * `tagByName` tags runs of frames named alike ("run_0", "run_1" → "run"). Returns false when nothing fits.
 */
export function loadSheetData(this: SpriteContext, image: ImageBitmap, json: unknown, name = 'sheet', tagByName = true): boolean {
  type R = { x: number; y: number; w: number; h: number; };
  type Entry = { filename?: string; frame?: R; rotated?: boolean; trimmed?: boolean; spriteSourceSize?: R; sourceSize?: { w: number; h: number; }; duration?: number; };
  const root = json as { frames?: Entry[] | Record<string, Entry>; meta?: { frameTags?: { name?: string; from?: number; to?: number; direction?: string; color?: string; }[]; }; };
  const raw = root?.frames;
  const entries = (Array.isArray(raw) ? raw : raw && typeof raw === 'object'
    ? Object.entries(raw).map(([filename, e]) => ({ filename, ...e })) : [])
    .filter((e): e is Entry & { frame: R; } => !!e?.frame && e.frame.w > 0 && e.frame.h > 0);
  if (!entries.length) return false;
  const can = new OffscreenCanvas(image.width, image.height);
  can.getContext('2d')!.drawImage(image, 0, 0);
  // The canvas is the largest source size (untrimmed frame), or the largest frame when none is given
  const W = Math.max(...entries.map(e => e.sourceSize?.w ?? e.frame.w)), H = Math.max(...entries.map(e => e.sourceSize?.h ?? e.frame.h));
  const cels: Cel[] = entries.map(e => {
    const f = e.frame, at = e.spriteSourceSize ?? { x: 0, y: 0 };
    // `frame` holds the upright size; a rotated frame sits in the sheet turned 90° clockwise (h×w)
    const { w, h } = f;
    const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d')!;
    if (e.rotated) {
      ctx.translate(0, h);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(can, f.x, f.y, h, w, 0, 0, h, w);
    } else ctx.drawImage(can, f.x, f.y, w, h, 0, 0, w, h);
    return trimCel({ x: at.x, y: at.y, w, h, data: new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer) });
  });
  this.reset(W, H, name);
  this.frames = entries.map(e => ({ duration: e.duration && e.duration > 0 ? e.duration : 100 }));
  this.layers = [{ ...newLayer('Sheet', cels.length), cels }];
  const last = cels.length - 1;
  const given = root.meta?.frameTags ?? [];
  this.tags = (given.length || !tagByName ? given : tagsByName(entries.map(e => e.filename ?? '')))
    .filter(t => Number.isFinite(t.from) && Number.isFinite(t.to) && t.from! <= last)
    .map((t, i) => ({
      name: t.name || `Tag ${i + 1}`,
      from: Math.max(0, t.from!), to: Math.min(last, Math.max(t.from!, t.to!)),
      color: /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color! : TAG_COLORS[i % TAG_COLORS.length],
      direction: t.direction === 'reverse' ? 'reverse' : /^pingpong[-_]reverse$/.test(t.direction ?? '') ? 'pingpong-reverse' : t.direction?.startsWith('pingpong') ? 'pingpong' : 'forward',
    }));
  this.touch();
  return true;
}

/** Image data of a frame for exporters */
export function frameImage(this: SpriteContext, frame: number): ImageData {
  const ctx = this.render(frame).getContext('2d')!;
  return ctx.getImageData(0, 0, this.width, this.height);
}
