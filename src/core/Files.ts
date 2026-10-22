import { decodeAseprite, encodeAseprite } from "~/core/formats/Aseprite";
import { decodeGif } from "~/core/formats/GifDecode";
import { parsePalette, serializePalette, type PaletteFormat } from "~/core/formats/Palette";
import { encodeGifInBackground, isCancelled } from "~/core/Work";
import { bitmapToCanvas, opaqueBounds, type Bitmap, type Rect } from "~/core/Image";
import { encodeApng } from "~/core/formats/Apng";
import { encodeZip } from "~/core/formats/Zip";
import { encodeIco } from "~/core/formats/Ico";
import { sliceKey } from "~/core/Sprite";
import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { Sprite } from "~/core/Sprite";
import { loadProjectData } from "~/core/Projects";
import { buildSheet, sheetData, type SheetOptions } from "~/core/SpriteSheet";
import { mapCsv, mapGrid, mapJson, tilesetImage, tilesFromImage, type TileRefs } from "~/core/Tilemap";


export type ExportKind = 'png' | 'sheet' | 'gif' | 'apng' | 'webm' | 'frames' | 'zip' | 'ico' | 'cur';
export type SplitMode = 'none' | 'layers' | 'selectedLayers' | 'tags' | 'slices';

export type ExportOptions = {
  kind: ExportKind;
  scale: number;
  name?: string;
  /** Frames of this tag only; -1 = selected frames, undefined = all */
  tag?: number;
  /** Only the current layer instead of all visible layers */
  currentLayer?: boolean;
  /** Only this layer (set when exporting layers separately) */
  layer?: number;
  /** Export only this part: the selection bounds or a slice (per frame) */
  area?: { kind: 'selection'; } | { kind: 'slice'; index: number; };
  /** Crop to the pixels in use (one box shared by all exported frames) */
  trim?: boolean;
  /** One file per layer / tag / slice, bundled in a ZIP */
  split?: SplitMode;
  /** Sprite sheet settings (frames and layer come from the fields above) */
  sheet?: Omit<SheetOptions, 'frames' | 'layer' | 'scale' | 'area'>;
  json?: 'none' | 'hash' | 'array';
  loop?: boolean;
  /** Icon / cursor image sizes (square, px); the frame is fitted into each */
  icoSizes?: number[];
};

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scaled(source: OffscreenCanvas, scale: number) {
  if (scale === 1) return source;
  const out = new OffscreenCanvas(source.width * scale, source.height * scale);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function exportFrames(tag?: number) {
  const { sprite } = state;
  if (tag === -1) return sprite.selectedFrames;
  const t = tag !== undefined ? sprite.tags[tag] : null;
  return t
    ? Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i)
    : sprite.frames.map((_, i) => i);
}

const exportLayer = (opts: ExportOptions) => opts.layer ?? (opts.currentLayer ? state.sprite.layer : undefined);

export function sheetOptions(opts: ExportOptions, frames = exportFrames(opts.tag)): SheetOptions {
  const shown = frames.filter(f => areaRect(opts, f));
  return {
    ...opts.sheet!, frames: shown, layer: exportLayer(opts), scale: opts.scale,
    area: opts.area ? f => areaRect(opts, f) : undefined,
  };
}

/** Rectangle exported for a frame; null skips the frame (slice hidden there) */
export function areaRect(opts: ExportOptions, f: number): Rect | null {
  const { sprite } = state;
  const a = opts.area;
  if (a?.kind === 'selection' && sprite.mask?.bounds) return sprite.mask.bounds;
  if (a?.kind === 'slice' && sprite.slices[a.index]) {
    const k = sliceKey(sprite.slices[a.index], f);
    return k && { x: k.x, y: k.y, w: k.w, h: k.h };
  }
  return { x: 0, y: 0, w: sprite.width, h: sprite.height };
}

/** Bounds of the used pixels of the frames inside their areas (canvas coordinates) */
function contentBounds(opts: ExportOptions, frames: number[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of frames) {
    const r = areaRect(opts, f);
    if (!r || r.w < 1 || r.h < 1) continue;
    const ctx = frameCanvas(f, exportLayer(opts)).getContext('2d')!;
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
    let r = areaRect(opts, f);
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
  out.getContext('2d')!.drawImage(frameCanvas(f, exportLayer(opts)), r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return scaled(out, opts.scale);
}

function frameCanvas(f: number, layer?: number) {
  return state.sprite.render(f, layer);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** WebM video recorded from a canvas in real time (the browser's own encoder) */
async function encodeWebm(frames: OffscreenCanvas[], delays: number[], loops: number) {
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('WebM recording is not supported');
  const can = document.createElement('canvas');
  // Video encoders want even sizes
  can.width = frames[0].width + (frames[0].width & 1);
  can.height = frames[0].height + (frames[0].height & 1);
  const ctx = can.getContext('2d')!;
  const stream = can.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start();
  for (let n = 0; n < loops; n++)
    for (let i = 0; i < frames.length; i++) {
      ctx.clearRect(0, 0, can.width, can.height);
      ctx.drawImage(frames[i], 0, 0);
      track.requestFrame();
      await sleep(Math.max(10, delays[i]));
    }
  rec.stop();
  await stopped;
  stream.getTracks().forEach(t => t.stop());
  return new Blob(chunks, { type: 'video/webm' });
}

const png = (can: OffscreenCanvas) => can.convertToBlob({ type: 'image/png' });

type Output = { name: string; blob: Blob; };

async function renderExport(opts: ExportOptions, base: string): Promise<Output[]> {
  const { sprite } = state;
  const frames = opts.kind === 'png' ? [sprite.frame] : exportFrames(opts.tag);

  if (opts.kind === 'sheet' && opts.sheet) {
    const so = sheetOptions(opts, frames);
    if (opts.trim && so.trim === 'none') so.trim = 'sprite';
    const sheet = buildSheet(so);
    const image = `${base}-sheet.png`;
    const out = [{ name: image, blob: await png(scaled(sheet.canvas, opts.scale)) }];
    if (opts.json && opts.json !== 'none')
      out.push({ name: `${base}-sheet.json`, blob: new Blob([sheetData(sheet, base, image, opts.json)], { type: 'application/json' }) });
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
    state.showNotice(t('msg.recordingVideo'), 3000);
    return [{ name: `${base}.webm`, blob: await encodeWebm(canvases, delays, 1) }];
  }

  const gifFrames = canvases.map((c, i) => ({ data: c.getContext('2d')!.getImageData(0, 0, w, h).data, delay: delays[i] }));
  return [{ name: `${base}.gif`, blob: new Blob([await encodeGifInBackground(w, h, gifFrames, opts.loop ?? true) as BlobPart], { type: 'image/gif' }) }];
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || '_';

/** Parts of the sprite exported one by one */
function splitParts(opts: ExportOptions, base: string): [ExportOptions, string][] {
  const { sprite } = state;
  if (opts.split === 'layers')
    return sprite.layers.flatMap((l, i) => !l.group && sprite.visibleDeep(i)
      ? [[{ ...opts, layer: i, currentLayer: false }, `${base}-${safeName(l.name)}`] as [ExportOptions, string]] : []);
  if (opts.split === 'selectedLayers') {
    const sel = new Set(sprite.selectedLayers);
    return sprite.layers.flatMap((l, i) => !l.group && sel.has(i)
      ? [[{ ...opts, layer: i, currentLayer: false }, `${base}-${safeName(l.name)}`] as [ExportOptions, string]] : []);
  }
  if (opts.split === 'tags')
    return sprite.tags.map((tg, i) => [{ ...opts, tag: i }, `${base}-${safeName(tg.name)}`]);
  if (opts.split === 'slices')
    return sprite.slices.map((sl, i) => [{ ...opts, area: { kind: 'slice', index: i } }, `${base}-${safeName(sl.name)}`]);
  return [[opts, base]];
}

async function zipOutputs(outs: Output[], name: string) {
  const entries = await Promise.all(outs.map(async o => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })));
  download(new Blob([encodeZip(entries) as BlobPart], { type: 'application/zip' }), name);
}

const LAST_EXPORT_KEY = 'pixprite:lastExport';

export async function exportFile(opts: ExportOptions) {
  const base = safeName(opts.name ?? state.sprite.name);
  if (opts.kind !== 'png' || opts.scale !== 1 || opts.area || opts.trim) {
    try { localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify({ ...opts, name: undefined })); } catch { }
  }
  try {
    const split = opts.split && opts.split !== 'none';
    const parts = splitParts(opts, base);
    if (split && !parts.length) return state.showTip(t('msg.nothingToExport'));
    const outs: Output[] = [];
    for (const [o, name] of parts) outs.push(...await renderExport(o, name));
    if (!outs.length) return state.showTip(t('msg.theSliceIsHidden'));
    if (split || opts.kind === 'zip') return zipOutputs(outs, `${base}${split ? `-${opts.split}` : ''}.zip`);
    for (const o of outs) download(o.blob, o.name);
  } catch (err) {
    if (isCancelled(err)) return;
    console.error('Export failed', err);
    state.showTip(`${t('msg.exportFailed')}: ${(err as Error).message ?? err}`, 4000);
  }
}

/** Runs the last export from the dialog again (on the current sprite); false when there was none */
export function repeatLastExport() {
  try {
    const raw = localStorage.getItem(LAST_EXPORT_KEY);
    if (!raw) return false;
    const opts = JSON.parse(raw) as ExportOptions;
    const { sprite } = state;
    // Things that may not exist in this sprite fall back to the whole sprite
    if (opts.tag !== undefined && opts.tag >= 0 && !sprite.tags[opts.tag]) opts.tag = undefined;
    if (opts.area?.kind === 'slice' && !sprite.slices[opts.area.index]) opts.area = undefined;
    if (opts.area?.kind === 'selection' && !sprite.mask) opts.area = undefined;
    if (opts.layer !== undefined && !sprite.layers[opts.layer]) opts.layer = undefined;
    void exportFile(opts);
    return true;
  } catch { return false; }
}

export type ProjectFormat = 'pixprite' | 'aseprite';

async function projectBlob(doc: Sprite, format: ProjectFormat) {
  if (format === 'aseprite') {
    const ase = doc.toDocument();
    if (!ase.palette.length) ase.palette = state.palette.slice();
    return new Blob([await encodeAseprite(ase) as BlobPart], { type: 'application/octet-stream' });
  }
  return new Blob([JSON.stringify(doc)], { type: 'application/json' });
}

/** What a document loses (or keeps only for Pixprite) when saved as .aseprite, translated */
export function asepriteLosses(doc: Sprite): string[] {
  const out: string[] = [];
  const refs = doc.layers.filter(l => l.reference).length;
  if (refs) out.push(`${t('msg.referenceLayers')} (${refs})`);
  if (doc.guides?.length) out.push(`${t('common.guides')} (${doc.guides.length})`);
  if (doc.layers.some(l => l.clip)) out.push(t('msg.layerClippingKeptAs'));
  return out;
}

export async function downloadProject(id: string, format: ProjectFormat = 'pixprite') {
  const data = await loadProjectData(id);
  if (!data) return state.showTip(t('msg.theProjectCouldNot'));
  const doc = new Sprite(32, 32);
  doc.load(data);
  download(await projectBlob(doc, format), `${doc.name}.${format}`);
  const lost = format === 'aseprite' ? asepriteLosses(doc) : [];
  if (lost.length) state.showTip(`${t('dialog.saveAs.notSavedInThis')}: ${lost.join(', ')}`, 4000);
}

export async function saveProject(name = state.sprite.name, format: ProjectFormat = 'pixprite') {
  state.sprite.name = name;
  if (format === 'aseprite') {
    const doc = state.sprite.toDocument();
    if (!doc.palette.length) doc.palette = state.palette.slice();
    const bytes = await encodeAseprite(doc);
    return download(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), `${name}.aseprite`);
  }
  const blob = new Blob([JSON.stringify(state.sprite)], { type: 'application/json' });
  download(blob, `${name}.pixprite`);
}

export function pickFiles(accept: string, multiple = false) {
  return new Promise<File[]>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files ?? []]);
    input.click();
  });
}

export async function pickFile(accept: string) {
  return (await pickFiles(accept))[0] ?? null;
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

async function imageBuffer(file: Blob) {
  const img = await createImageBitmap(file);
  const can = new OffscreenCanvas(img.width, img.height);
  const ctx = can.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: new Uint32Array(ctx.getImageData(0, 0, img.width, img.height).data.buffer) };
}

/** A smaller frame of an image sequence, placed at the top-left of the shared size */
function resize(img: { w: number; h: number; data: Uint32Array; }, w: number, h: number) {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < Math.min(h, img.h); y++)
    out.set(img.data.subarray(y * img.w, y * img.w + Math.min(w, img.w)), y * w);
  return out;
}

export const PALETTE_EXTS = ['gpl', 'pal', 'hex', 'act'];

/** Reads a document file (project, .aseprite, GIF, image) into a new, detached sprite */
async function readDocument(file: File): Promise<Sprite> {
  const e = ext(file.name), name = stripExt(file.name);
  const doc = new Sprite(32, 32);
  if (e === 'aseprite' || e === 'ase') {
    const ase = await decodeAseprite(new Uint8Array(await file.arrayBuffer()));
    doc.fromDocument(ase, name);
    // The file's palette travels with the document (it becomes the palette when the tab is shown)
    if (ase.palette.length) doc.editor = { palette: ase.palette.map(c => c.slice(0, 7)) };
  } else if (e === 'gif') {
    const gif = decodeGif(new Uint8Array(await file.arrayBuffer()));
    doc.loadFrames(gif.width, gif.height, gif.frames, name);
  } else if (file.type.startsWith('image/')) {
    doc.loadImage(await createImageBitmap(file), name);
  } else {
    doc.load(JSON.parse(await file.text()));
  }
  return doc;
}

/** A sprite-sheet description (JSON with `frames`) rather than a project */
async function isSheetData(file: File) {
  if (ext(file.name) !== 'json') return false;
  try {
    const json = JSON.parse(await file.text());
    return 'frames' in json && !('layers' in json);
  } catch { return false; }
}

/**
 * Loaded documents: in the editor each gets its own tab; on the home page
 * they are saved as projects right away and appear in the list.
 */
export async function addDocuments(docs: Sprite[], failed: string[] = []) {
  if (state.home) {
    let added = 0;
    for (const doc of docs) await state.importProject(doc).then(() => added++, () => failed.push(doc.name));
    if (added) state.showNotice(t('msg.nProjectsAdded', { n: added }));
  } else {
    for (const doc of docs) state.openDocument(doc);
    if (docs.length) finish();
  }
  if (failed.length) state.showTip(`${t('msg.couldNotOpen')}: ${failed.join(', ')}`, 4000);
}

/** Opens files. Several plain images together become one animation (an image sequence) */
export async function loadFiles(files: File[]) {
  if (!files.length) return;
  const failed: string[] = [];
  const docs: Sprite[] = [];

  // Palettes replace the palette, whatever else comes along
  for (const file of files.filter(f => PALETTE_EXTS.includes(ext(f.name)))) {
    try {
      state.palette = parsePalette(file.name, new Uint8Array(await file.arrayBuffer()));
      state.showTip(`Palette loaded: ${state.palette.length} colors`);
    } catch { failed.push(file.name); }
  }
  let rest = files.filter(f => !PALETTE_EXTS.includes(ext(f.name)));

  // Sheet descriptions open only through the sprite sheet import
  const sheetData: File[] = [];
  for (const f of rest) if (await isSheetData(f)) sheetData.push(f);
  if (sheetData.length) state.showTip(t('msg.spriteSheetDescriptionsOpen'), 4000);
  rest = rest.filter(f => !sheetData.includes(f));

  const stills = rest.filter(f => f.type.startsWith('image/') && ext(f.name) !== 'gif');
  if (stills.length > 1) {
    // Several still images at once: an image sequence, sorted by their numbers
    try {
      const sorted = stills.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const images = await Promise.all(sorted.map(imageBuffer));
      const w = Math.max(...images.map(i => i.w)), h = Math.max(...images.map(i => i.h));
      const doc = new Sprite(32, 32);
      doc.loadFrames(w, h, images.map(i => ({ data: i.w === w && i.h === h ? i.data : resize(i, w, h), delay: 100 })), stripExt(sorted[0].name).replace(/\d+$/, '') || 'sequence');
      docs.push(doc);
    } catch { failed.push(...stills.map(f => f.name)); }
    rest = rest.filter(f => !stills.includes(f));
  }

  for (const file of rest) {
    try { docs.push(await readDocument(file)); }
    catch (err) { console.error('Failed to open file', err); failed.push(file.name); }
  }
  await addDocuments(docs, failed);
}

function finish() {
  state.fit();
  state.save();
}

/** Image frames of a file (a GIF gives all of them), for placing into the open document */
async function readImages(files: File[]) {
  const out: { w: number; h: number; data: Uint32Array; delay: number; }[] = [];
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of sorted) {
    if (ext(f.name) === 'gif') {
      const gif = decodeGif(new Uint8Array(await f.arrayBuffer()));
      for (const fr of gif.frames) out.push({ w: gif.width, h: gif.height, data: fr.data, delay: fr.delay });
    } else out.push({ ...await imageBuffer(f), delay: 100 });
  }
  return out;
}

/**
 * Places images (or a GIF, or a numbered PNG sequence) into the current document:
 * as a new layer or as new frames. In indexed mode the pixels are fitted to the palette.
 */
export async function importIntoDocument(mode: 'layer' | 'frames', place: 'center' | 'topleft' | 'selection' = 'center') {
  const files = await pickFiles('.gif,image/png,image/webp,image/jpeg', true);
  if (!files.length) return;
  const { sprite } = state;
  if (mode === 'frames' && !sprite.editable) return state.showTip(t('msg.theLayerIsLocked'));
  try {
    const images = await readImages(files);
    if (!images.length) return;
    const w = Math.max(...images.map(i => i.w)), h = Math.max(...images.map(i => i.h));
    let x = 0, y = 0;
    if (place === 'center') { x = (sprite.width - w) >> 1; y = (sprite.height - h) >> 1; }
    else if (place === 'selection' && sprite.mask?.bounds) ({ x, y } = sprite.mask.bounds);
    sprite.importImages(images, mode, x, y, stripExt(files[0].name).replace(/[_\-\s]*\d+$/, '') || 'Imported');
    state.save();
  } catch (err) {
    console.error('Import failed', err);
    state.showTip(`${t('msg.couldNotOpen')}: ${files.map(f => f.name).join(', ')}`, 4000);
  }
}

export async function loadFile(file: File) {
  return loadFiles([file]);
}

export async function openFile() {
  const files = await pickFiles('.pixprite,.json,.aseprite,.ase,.gif,.gpl,.pal,.hex,.act,image/png,image/webp,image/jpeg', true);
  await loadFiles(files);
}

export async function savePalette(format: Exclude<PaletteFormat, 'png'>) {
  const bytes = serializePalette(format, state.palette, state.sprite.name);
  download(new Blob([bytes as BlobPart]), `${state.sprite.name}.${format}`);
}

export async function copyToSystemClipboard(bmp: Bitmap | null) {
  if (!bmp || !navigator.clipboard?.write) return;
  try {
    const blob = await bitmapToCanvas(bmp).convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* the internal clipboard still works */ }
}

export async function blobToBitmap(blob: Blob): Promise<Bitmap> {
  return imageBuffer(blob);
}

export async function readSystemClipboard(): Promise<Bitmap | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) return blobToBitmap(await item.getType(type));
    }
  } catch { }
  return null;
}

/** The active tileset as a PNG grid image (tile 1 at the top-left) */
export async function exportTileset(cols = 0) {
  const ts = state.sprite.tileset;
  if (!ts) return;
  download(await png(bitmapToCanvas(tilesetImage(ts, cols))), `${safeName(ts.name)}.png`);
}

/** The active tilemap layer (current frame) as JSON or CSV, plus the tileset image with JSON */
export async function exportTilemap(format: 'json' | 'csv') {
  const { sprite } = state;
  const ts = sprite.tileset, l = sprite.current;
  if (!ts || !l) return;
  const grid = mapGrid(ts, sprite.getCel() as { x: number; y: number; tiles?: TileRefs; } | null, sprite.width, sprite.height);
  const base = `${safeName(sprite.name)}-${safeName(l.name)}`;
  if (format === 'csv') return download(new Blob([mapCsv(grid)], { type: 'text/csv' }), `${base}.csv`);
  const image = `${safeName(ts.name)}.png`;
  download(new Blob([mapJson(ts, grid, l.name, image)], { type: 'application/json' }), `${base}.json`);
  await exportTileset();
}

/** Adds the tiles of an image (cut by the active tileset's tile size) to the active tileset */
export async function importTilesetImage(skipEmpty = true, skipDuplicates = true) {
  const ts = state.sprite.tileset;
  if (!ts) return;
  const file = await pickFile('image/png,image/webp,image/gif,image/jpeg');
  if (!file) return;
  try {
    const tiles = tilesFromImage(await imageBuffer(file), ts.tw, ts.th, skipEmpty, skipDuplicates);
    if (!tiles.length) return state.showTip(t('msg.noTilesFoundIn'));
    state.sprite.importTiles(tiles);
    state.save();
    state.showNotice(t('msg.nTilesAdded', { n: tiles.length }));
  } catch { state.showTip(`${t('msg.couldNotOpen')}: ${file.name}`); }
}
