import { projectBackup, recordBackup } from "~/core/Backups";
import type { PaletteFormat } from "~/core/formats/Palette";
import { runTask, withProgress, isCancelled } from "~/core/Work";
import { bitmapToCanvas, type Bitmap, type Rect } from "~/core/Image";
import { sliceKey } from "~/core/Sprite";
import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { Sprite } from "~/core/Sprite";
import { loadProjectData } from "~/core/Projects";
import { type SheetOptions } from "~/core/SpriteSheet";
import { tilesFromImage } from "~/core/Tilemap";


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

type Output = { name: string; blob: Blob };

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
  download(new Blob([await runTask('zip', { entries }) as BlobPart], { type: 'application/zip' }), name);
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
    const raw = state.sprite.captureDocument();
    const grid = { gridX: state.prefs.gridX, gridY: state.prefs.gridY, gridW: state.prefs.gridW, gridH: state.prefs.gridH };
    const requests = parts.map(([o, name]) => {
      const frames = o.kind === 'png' ? [state.sprite.frame] : exportFrames(o.tag);
      return { raw, opts: { ...o, layer: exportLayer(o) }, base: name, frames, grid,
        areas: Object.fromEntries(frames.map(f => [f, areaRect(o, f)])) };
    });
    const outs: Output[] = [];
    for (const request of requests) {
      const prepared = request.opts.kind === 'gif'
        ? await withProgress(t('progress.encodingGif'), (onProgress, signal) => runTask('export', request, { onProgress, signal }))
        : await runTask('export', request);
      if (Array.isArray(prepared)) outs.push(...prepared);
      else {
        state.showNotice(t('msg.recordingVideo'), 3000);
        const canvases = prepared.frames.map(frame => {
          const canvas = new OffscreenCanvas(prepared.width, prepared.height);
          canvas.getContext('2d')!.putImageData(new ImageData(frame.data as Uint8ClampedArray<ArrayBuffer>, prepared.width, prepared.height), 0, 0);
          return canvas;
        });
        outs.push({ name: prepared.name, blob: await (await import('./formats/Webm')).encodeWebm(canvases, prepared.frames.map(frame => frame.delay), 1) });
      }
    }
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
  return runTask('projectFile', { raw: doc.captureDocument(), format, palette: state.palette.slice() });
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
  if (format === 'pixprite') {
    try {
      const backup = await projectBackup(id);
      download(backup.blob, backup.name);
      recordBackup(id, backup.savedAt);
    } catch (e) { state.showTip(`${t('storage.failed')}: ${(e as Error).message}`, 4000); }
    return;
  }
  const data = await loadProjectData(id);
  if (!data) return state.showTip(t('msg.theProjectCouldNot'));
  const doc = new Sprite(32, 32);
  await doc.loadAsync(data);
  download(await projectBlob(doc, format), `${doc.name}.${format}`);
  const lost = format === 'aseprite' ? asepriteLosses(doc) : [];
  if (lost.length) state.showTip(`${t('dialog.saveAs.notSavedInThis')}: ${lost.join(', ')}`, 4000);
}

export async function saveProject(name = state.sprite.name, format: ProjectFormat = 'pixprite') {
  state.sprite.name = name;
  download(await projectBlob(state.sprite, format), `${name}.${format}`);
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
    const ase = await (await import('./formats/Aseprite')).decodeAseprite(new Uint8Array(await file.arrayBuffer()));
    doc.fromDocument(ase, name);
    // The file's palette travels with the document (it becomes the palette when the tab is shown)
    if (ase.palette.length) doc.editor = { palette: ase.palette.map(c => c.slice(0, 7)) };
  } else if (e === 'gif') {
    const gif = (await import('./formats/GifDecode')).decodeGif(new Uint8Array(await file.arrayBuffer()));
    doc.loadFrames(gif.width, gif.height, gif.frames, name);
  } else if (file.type.startsWith('image/')) {
    doc.loadImage(await createImageBitmap(file), name);
  } else {
    await doc.loadAsync(await file.text());
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
export async function loadFiles(files: File[], assertActive = () => {}) {
  if (!files.length) return;
  const failed: string[] = [];
  const docs: Sprite[] = [];

  // Palettes replace the palette, whatever else comes along
  for (const file of files.filter(f => PALETTE_EXTS.includes(ext(f.name)))) {
    try {
      const palette = (await import('./formats/Palette')).parsePalette(file.name, new Uint8Array(await file.arrayBuffer()));
      assertActive();
      state.palette = palette;
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
    catch (err) {
      console.error('Failed to open file', err);
      failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  assertActive();
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
      const gif = (await import('./formats/GifDecode')).decodeGif(new Uint8Array(await f.arrayBuffer()));
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

export async function loadFile(file: File, assertActive?: () => void) {
  return loadFiles([file], assertActive);
}

export async function openFile() {
  const files = await pickFiles('.pixprite,.json,.aseprite,.ase,.gif,.gpl,.pal,.hex,.act,image/png,image/webp,image/jpeg', true);
  await loadFiles(files);
}

export async function savePalette(format: Exclude<PaletteFormat, 'png'>) {
  const palette = state.palette.slice(), name = state.sprite.name;
  try {
    const { serializePalette } = await import('./formats/Palette');
    const bytes = serializePalette(format, palette, name);
    download(new Blob([bytes as BlobPart]), `${name}.${format}`);
  } catch (error) {
    state.showTip(`${t('msg.exportFailed')}: ${error instanceof Error ? error.message : error}`, 4000);
  }
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
  const name = `${safeName(ts.name)}.png`;
  const prepared = await runTask('tileExport', { ts, cols });
  download(prepared.png, name);
}

/** The active tilemap layer (current frame) as JSON or CSV, plus the tileset image with JSON */
export async function exportTilemap(format: 'json' | 'csv') {
  const { sprite } = state;
  const ts = sprite.tileset, l = sprite.current;
  if (!ts || !l) return;
  const base = `${safeName(sprite.name)}-${safeName(l.name)}`;
  const image = `${safeName(ts.name)}.png`;
  const cel = sprite.getCel();
  const prepared = await runTask('tileExport', { ts, map: {
    cel: cel ? { x: cel.x, y: cel.y, tiles: cel.tiles } : null,
    width: sprite.width, height: sprite.height, layer: l.name, image, format,
  } });
  download(prepared.map!, `${base}.${format}`);
  if (format === 'json') download(prepared.png, image);
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
