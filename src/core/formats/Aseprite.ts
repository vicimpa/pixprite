/**
 * Reader/writer for the .aseprite / .ase file format.
 * Keeps layer groups, slices, tilemaps, palettes per frame and RGB / grayscale / indexed pixels.
 * Writes 32-bit RGBA files with compressed, cropped cels.
 */

import type { ColorMode } from "~/core/ColorMode";
import type { BlendMode, Cel, FramePalette, Slice } from "~/core/Sprite";
import { renderTiles, type Tileset, type UserData } from "~/core/Tilemap";

export type AseLayer = {
  name: string;
  visible: boolean;
  locked: boolean;
  background: boolean;
  continuous: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  /** One placed image per frame (may extend past the canvas); the same reference in several frames means linked cels */
  cels: Cel[];
  /** 0..1 per frame */
  celOpacity?: number[];
  /** Group layers hold no cels; their children sit right below them in `layers` */
  group?: boolean;
  depth?: number;
  collapsed?: boolean;
  /** Tilemap layers: index into `tilesets` */
  tileset?: number;
  /** Clipped to the layer below; the format has no such flag, it travels as a user data property */
  clip?: boolean;
  userData?: UserData;
};

/**
 * The file lists layers parent-first (a group, then its children bottom to top),
 * the document lists them bottom to top with children right below their group.
 */
function fileOrder(layers: AseLayer[]) {
  const out: number[] = [];
  const emit = (i: number) => {
    out.push(i);
    const d = layers[i].depth ?? 0;
    if (!layers[i].group) return;
    let s = i;
    while (s > 0 && (layers[s - 1].depth ?? 0) > d) s--;
    for (let k = s; k < i; k++) if ((layers[k].depth ?? 0) === d + 1) emit(k);
  };
  layers.forEach((l, i) => { if (!(l.depth ?? 0)) emit(i); });
  return out;
}

/** Inverse of fileOrder: children first, then their group */
function documentOrder(levels: number[]) {
  const out: number[] = [];
  const visit = (i: number): number => {
    // Children follow the group in the file, at one level deeper
    let k = i + 1;
    while (k < levels.length && levels[k] > levels[i]) {
      if (levels[k] === levels[i] + 1) k = visit(k);
      else k++;
    }
    out.push(i);
    return k;
  };
  for (let i = 0; i < levels.length;) i = levels[i] === 0 ? visit(i) : i + 1;
  return out;
}

export type AseTag = {
  name: string;
  from: number;
  to: number;
  color: string;
  direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse';
  /** 0 or missing = forever */
  repeat?: number;
  userData?: UserData;
};

export type AseDocument = {
  width: number;
  height: number;
  frames: { duration: number; }[];
  /** bottom-to-top */
  layers: AseLayer[];
  tags: AseTag[];
  /** #rrggbb or #rrggbbaa */
  palette: string[];
  slices?: Slice[];
  colorMode?: ColorMode;
  /** Palettes that change from some frame on */
  framePalettes?: FramePalette[];
  tilesets?: Tileset[];
  /** Indexed mode: palette entry that stands for transparency (-1 / missing = none, an extra slot is used) */
  transparentIndex?: number;
};

/** User data property carrying the layer clipping flag */
const CLIP_PROP = 'pixprite.clip';

const ASE_BLENDS: BlendMode[] = [
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

const DIRECTIONS: AseTag['direction'][] = ['forward', 'reverse', 'pingpong', 'pingpong-reverse'];

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'));
const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate'));

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

function parseHex(color: string): [number, number, number, number] {
  let s = color.replace('#', '');
  if (s.length === 3 || s.length === 4) s = [...s].map(c => c + c).join('');
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16) || 0;
  return [n(0), n(2), n(4), s.length >= 8 ? n(6) : 255];
}

class Writer {
  buf = new Uint8Array(1024);
  view = new DataView(this.buf.buffer);
  pos = 0;

  ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  byte(v: number) { this.ensure(1); this.buf[this.pos++] = v & 255; }
  word(v: number) { this.ensure(2); this.view.setUint16(this.pos, v & 0xFFFF, true); this.pos += 2; }
  short(v: number) { this.ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  dword(v: number) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  int(v: number) { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }
  zeros(n: number) { this.ensure(n); this.buf.fill(0, this.pos, this.pos + n); this.pos += n; }
  bytes(data: Uint8Array) { this.ensure(data.length); this.buf.set(data, this.pos); this.pos += data.length; }
  string(s: string) {
    const data = new TextEncoder().encode(s);
    this.word(data.length);
    this.bytes(data);
  }
  patchDword(at: number, v: number) { this.view.setUint32(at, v >>> 0, true); }
  patchWord(at: number, v: number) { this.view.setUint16(at, v & 0xFFFF, true); }
  result() { return this.buf.slice(0, this.pos); }
}

class Reader {
  view: DataView;
  pos = 0;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  byte() { return this.buf[this.pos++]; }
  word() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  short() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  dword() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  int() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  skip(n: number) { this.pos += n; }
  bytes(n: number) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  string() { return new TextDecoder().decode(this.bytes(this.word())); }
}

/** Bounding box of non-transparent pixels, or null if the buffer is empty */
function opaqueBounds(data: Uint32Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] >>> 24 === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function beginChunk(w: Writer, type: number) {
  const start = w.pos;
  w.dword(0);
  w.word(type);
  return start;
}

function endChunk(w: Writer, start: number) {
  w.patchDword(start, w.pos - start);
}

/** User data chunk (text, color, boolean properties); returns the number of chunks written */
function writeUserData(w: Writer, ud: UserData | undefined, props: Record<string, boolean> = {}, color = ud?.color) {
  const names = Object.keys(props);
  if (!ud?.text && !color && !names.length) return 0;
  const c = beginChunk(w, 0x2020);
  w.dword((ud?.text ? 1 : 0) | (color ? 2 : 0) | (names.length ? 4 : 0));
  if (ud?.text) w.string(ud.text);
  if (color) { const [r, g, b, a] = parseHex(color); w.byte(r); w.byte(g); w.byte(b); w.byte(a); }
  if (names.length) {
    const at = w.pos;
    w.dword(0);
    w.dword(1);
    w.dword(0); // user properties map
    w.dword(names.length);
    for (const n of names) { w.string(n); w.word(0x0001); w.byte(props[n] ? 1 : 0); }
    w.patchDword(at, w.pos - at);
  }
  endChunk(w, c);
  return 1;
}

/** Reads the body of a user data chunk; boolean properties of the user map are returned in `props` */
function readUserData(r: Reader, end: number) {
  const uf = r.dword();
  const ud: UserData = {};
  const props: Record<string, boolean> = {};
  if (uf & 1) ud.text = r.string();
  if (uf & 2) { const [cr, cg, cb, ca] = [r.byte(), r.byte(), r.byte(), r.byte()]; ud.color = `#${hex2(cr)}${hex2(cg)}${hex2(cb)}${ca === 255 ? '' : hex2(ca)}`; }
  if (uf & 4) {
    // Fixed-size values are skipped; anything else ends parsing (the chunk is bounded anyway)
    const sizes: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 8, 9: 8, 0xA: 4, 0xB: 4, 0xC: 8, 0xE: 8, 0xF: 8, 0x10: 16, 0x13: 16 };
    r.skip(4);
    const maps = r.dword();
    out: for (let m = 0; m < maps && r.pos < end; m++) {
      const key = r.dword(), count = r.dword();
      for (let k = 0; k < count && r.pos < end; k++) {
        const name = r.string(), type = r.word();
        if (type === 1) { const v = !!r.byte(); if (key === 0) props[name] = v; }
        else if (type === 0xD) r.string();
        else if (sizes[type]) r.skip(sizes[type]);
        else break out;
      }
    }
  }
  return { ud, props };
}

export async function encodeAseprite(doc: AseDocument): Promise<Uint8Array> {
  const { width, height, frames, layers, tags, palette } = doc;
  const mode = doc.colorMode ?? 'rgb';
  const w = new Writer();
  // Indexed files get an extra fully transparent entry after the palette for empty pixels
  const keyAt = (f: number) => {
    let best: FramePalette | null = null;
    for (const k of doc.framePalettes ?? []) if (k.frame <= f && (!best || k.frame > best.frame)) best = k;
    return best?.colors ?? palette;
  };
  const given = mode === 'indexed' && (doc.transparentIndex ?? -1) >= 0 ? Math.min(255, doc.transparentIndex!) : -1;
  const packed = (cols: string[]) => cols.map(c => { const [r, g, b] = parseHex(c); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; });
  const longest = Math.max(palette.length, ...(doc.framePalettes ?? []).map(k => k.colors.length));
  let transparent = given >= 0 ? given : Math.min(255, longest);
  // A full palette has no free slot after it: the transparent index goes to an entry no opaque pixel uses
  if (given < 0 && mode === 'indexed' && longest >= 256) {
    const used = new Set<number>();
    for (const layer of layers) for (const cel of layer.cels) if (cel?.data) for (const v of cel.data) if ((v >>> 24) >= 128) used.add((v | 0xff000000) >>> 0);
    const cols = packed(palette);
    for (let i = 255; i >= 0; i--) if (!used.has(cols[i])) { transparent = i; break; }
  }
  /** Pixels in the file's format */
  const encodePixels = (data: Uint32Array, cols: number[]) => {
    if (mode === 'rgb') {
      const raw = new Uint8Array(data.length * 4);
      data.forEach((v, i) => { raw[i * 4] = v & 255; raw[i * 4 + 1] = (v >>> 8) & 255; raw[i * 4 + 2] = (v >>> 16) & 255; raw[i * 4 + 3] = v >>> 24; });
      return raw;
    }
    if (mode === 'gray') {
      const raw = new Uint8Array(data.length * 2);
      data.forEach((v, i) => { raw[i * 2] = v & 255; raw[i * 2 + 1] = v >>> 24; });
      return raw;
    }
    const index = new Map(cols.map((c, i) => [c, i]));
    const raw = new Uint8Array(data.length);
    data.forEach((v, i) => { raw[i] = (v >>> 24) < 128 ? transparent : index.get((v | 0xff000000) >>> 0) ?? 0; });
    return raw;
  };
  const order = fileOrder(layers);
  const fileIndex: number[] = [];
  order.forEach((li, k) => fileIndex[li] = k);

  // Header
  w.dword(0);
  w.word(0xA5E0);
  w.word(frames.length);
  w.word(width);
  w.word(height);
  w.word(mode === 'indexed' ? 8 : mode === 'gray' ? 16 : 32);
  w.dword(1 | 2); // layer opacity is valid, groups composite on their own
  w.word(frames[0]?.duration ?? 100);
  w.dword(0);
  w.dword(0);
  w.byte(mode === 'indexed' ? transparent : 0);
  w.zeros(3);
  w.word(palette.length >= 256 ? 0 : palette.length);
  w.zeros(128 - w.pos);

  for (let f = 0; f < frames.length; f++) {
    const frameStart = w.pos;
    w.dword(0);
    w.word(0xF1FA);
    const countAt = w.pos;
    w.word(0);
    w.word(frames[f].duration);
    w.zeros(2);
    w.dword(0);
    let chunks = 0;

    // The palette in frame 0, and again in every frame where it changes
    const pal = keyAt(f);
    if (f === 0 ? pal.length > 0 : pal !== keyAt(f - 1)) {
      const list = mode === 'indexed' ? [...pal, ...Array(Math.max(0, transparent + 1 - pal.length)).fill('#00000000')] : pal;
      const c = beginChunk(w, 0x2019);
      w.dword(list.length);
      w.dword(0);
      w.dword(list.length - 1);
      w.zeros(8);
      for (const color of list) {
        const [r, g, b, a] = parseHex(color);
        w.word(0);
        w.byte(r); w.byte(g); w.byte(b); w.byte(a);
      }
      endChunk(w, c);
      chunks++;
    }

    if (f === 0) {
      // Tilesets: tiles stacked vertically, tile 0 first
      for (const [ti, ts] of (doc.tilesets ?? []).entries()) {
        const all = new Uint32Array(ts.tiles.length * ts.tw * ts.th);
        ts.tiles.forEach((tile, i) => all.set(tile, i * ts.tw * ts.th));
        const data = await deflate(encodePixels(all, packed(palette)));
        const c = beginChunk(w, 0x2023);
        w.dword(ti);
        w.dword(2 | 4);
        w.dword(ts.tiles.length);
        w.word(ts.tw); w.word(ts.th);
        w.short(ts.baseIndex);
        w.zeros(14);
        w.string(ts.name);
        w.dword(data.length);
        w.bytes(data);
        endChunk(w, c);
        chunks++;
        chunks += writeUserData(w, ts.userData);
      }

      for (const li of order) {
        const layer = layers[li];
        const c = beginChunk(w, 0x2004);
        let flags = 0;
        if (layer.visible) flags |= 1;
        if (!layer.locked) flags |= 2;
        if (layer.background) flags |= 8 | 4;
        if (layer.continuous) flags |= 16;
        if (layer.collapsed) flags |= 32;
        w.word(flags);
        w.word(layer.group ? 1 : (layer.tileset ?? -1) >= 0 ? 2 : 0);
        w.word(layer.depth ?? 0);
        w.word(0);
        w.word(0);
        w.word(Math.max(0, ASE_BLENDS.indexOf(layer.blend)));
        w.byte(Math.round(Math.min(1, Math.max(0, layer.opacity)) * 255));
        w.zeros(3);
        w.string(layer.name);
        if ((layer.tileset ?? -1) >= 0) w.dword(layer.tileset!);
        endChunk(w, c);
        chunks++;
        chunks += writeUserData(w, layer.userData, layer.clip ? { [CLIP_PROP]: true } : {});
      }

      if (tags.length) {
        const c = beginChunk(w, 0x2018);
        w.word(tags.length);
        w.zeros(8);
        for (const tag of tags) {
          const [r, g, b] = parseHex(tag.color);
          w.word(tag.from);
          w.word(tag.to);
          w.byte(Math.max(0, DIRECTIONS.indexOf(tag.direction)));
          w.word(Math.max(0, Math.min(0xFFFF, Math.round(tag.repeat ?? 0))));
          w.zeros(6);
          w.byte(r); w.byte(g); w.byte(b);
          w.byte(0);
          w.string(tag.name);
        }
        endChunk(w, c);
        chunks++;
        // One user data chunk per tag, in order: the tag color, plus the note
        for (const tag of tags) chunks += writeUserData(w, tag.userData, {}, tag.color);
      }

      // Slices, each followed by user data carrying its color
      for (const sl of doc.slices ?? []) {
        const nine = sl.keys.some(k => k.center), pivot = sl.keys.some(k => k.pivot);
        const c = beginChunk(w, 0x2022);
        w.dword(sl.keys.length);
        w.dword((nine ? 1 : 0) | (pivot ? 2 : 0));
        w.dword(0);
        w.string(sl.name);
        for (const k of sl.keys) {
          w.dword(k.frame); w.int(k.x); w.int(k.y); w.dword(k.w); w.dword(k.h);
          if (nine) { const m = k.center ?? { x: 0, y: 0, w: 0, h: 0 }; w.int(m.x); w.int(m.y); w.dword(m.w); w.dword(m.h); }
          if (pivot) { w.int(k.pivot?.x ?? 0); w.int(k.pivot?.y ?? 0); }
        }
        endChunk(w, c);
        chunks += 1 + writeUserData(w, sl.userData, {}, sl.color);
      }
    }

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const cel = layer.cels[f];
      if (!cel) continue;
      const opacity = Math.round(Math.min(1, Math.max(0, layer.celOpacity?.[f] ?? 1)) * 255);
      const linkTo = layer.cels.indexOf(cel);

      if (linkTo < f) {
        // Only link if the target was actually written (non-empty)
        if (!opaqueBounds(cel.data, cel.w, cel.h)) continue;
        const c = beginChunk(w, 0x2005);
        w.word(fileIndex[l]); w.short(0); w.short(0); w.byte(opacity); w.word(1); w.short(0); w.zeros(5);
        w.word(linkTo);
        endChunk(w, c);
        chunks++;
        continue;
      }

      if (cel.tiles && (layer.tileset ?? -1) >= 0) {
        // Compressed tile references: 32-bit, index in the low bits, no flips
        const refs = new Uint8Array(cel.tiles.refs.slice().buffer);
        const c = beginChunk(w, 0x2005);
        w.word(fileIndex[l]); w.short(cel.x); w.short(cel.y); w.byte(opacity); w.word(3); w.short(0); w.zeros(5);
        w.word(cel.tiles.cols); w.word(cel.tiles.rows); w.word(32);
        w.dword(0x1fffffff); w.dword(0x80000000); w.dword(0x40000000); w.dword(0x20000000);
        w.zeros(10);
        w.bytes(await deflate(refs));
        endChunk(w, c);
        chunks++;
        continue;
      }
      const box = opaqueBounds(cel.data, cel.w, cel.h);
      if (!box) continue;
      const crop = new Uint32Array(box.w * box.h);
      for (let y = 0; y < box.h; y++) crop.set(cel.data.subarray((y + box.y) * cel.w + box.x, (y + box.y) * cel.w + box.x + box.w), y * box.w);
      const raw = encodePixels(crop, packed(keyAt(f)));
      const c = beginChunk(w, 0x2005);
      w.word(fileIndex[l]); w.short(cel.x + box.x); w.short(cel.y + box.y); w.byte(opacity); w.word(2); w.short(0); w.zeros(5);
      w.word(box.w); w.word(box.h);
      w.bytes(await deflate(raw));
      endChunk(w, c);
      chunks++;
    }

    w.patchWord(countAt, Math.min(chunks, 0xFFFF));
    w.patchDword(frameStart + 12, chunks);
    w.patchDword(frameStart, w.pos - frameStart);
  }

  w.patchDword(0, w.pos);
  return w.result();
}

type RawCel = { layer: number; x: number; y: number; opacity: number; type: number; link: number; w: number; h: number; pixels: Uint8Array | null; refs?: Uint32Array; idMask?: number; };

export async function decodeAseprite(bytes: Uint8Array): Promise<AseDocument> {
  const r = new Reader(bytes);
  r.skip(4);
  if (r.word() !== 0xA5E0) throw new Error('Not an Aseprite file');
  const frameCount = r.word();
  const width = r.word();
  const height = r.word();
  const depth = r.word();
  const flags = r.dword();
  const speed = r.word();
  r.skip(8);
  const transparentIndex = r.byte();
  r.pos = 128;

  const bpp = depth === 32 ? 4 : depth === 16 ? 2 : 1;
  const frames: { duration: number; }[] = [];
  const layers: AseLayer[] = [];
  /** Layers as listed in the file (parent first) */
  const fileLayers: AseLayer[] = [];
  /** file layer index -> document index */
  const layerMap: number[] = [];
  const tags: AseTag[] = [];
  const slices: Slice[] = [];
  /** Where the next user data chunk goes: the chunk right before it, or the next tag of a tags chunk */
  let udTarget: ((ud: UserData, props: Record<string, boolean>) => void) | null = null;
  let tagQueue: AseTag[] = [];
  let newPalette: string[] | null = null;
  /** Palette as of each frame where a palette chunk appears */
  const paletteAt: string[][] = [];
  const tilesetsRaw: (Tileset & { zeroEmpty: boolean; })[] = [];
  const toPacked = (cols: string[]) => cols.map(c => {
    const [pr, pg, pb, pa] = parseHex(c);
    return ((pa << 24) | (pb << 16) | (pg << 8) | pr) >>> 0;
  });
  /** `n` pixels of raw file data starting at pixel `at`, as RGBA */
  const decodeRun = (px: Uint8Array, at: number, n: number, pal = toPacked(newPalette ?? []), background = false) => {
    const out = new Uint32Array(n);
    for (let k = 0; k < n; k++) {
      const i = (at + k) * bpp;
      if (bpp === 4) out[k] = ((px[i + 3] << 24) | (px[i + 2] << 16) | (px[i + 1] << 8) | px[i]) >>> 0;
      else if (bpp === 2) out[k] = ((px[i + 1] << 24) | (px[i] << 16) | (px[i] << 8) | px[i]) >>> 0;
      else out[k] = px[i] === transparentIndex && !background ? 0 : pal[px[i]] ?? 0;
    }
    return out;
  };
  const oldPalette: string[] = [];
  const celsByFrame: RawCel[][] = [];

  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.pos;
    const frameSize = r.dword();
    if (r.word() !== 0xF1FA) throw new Error(`Bad frame magic in frame ${f}`);
    const oldCount = r.word();
    const duration = r.word();
    r.skip(2);
    const newCount = r.dword();
    const chunkCount = newCount === 0 ? oldCount : newCount;
    frames.push({ duration: duration || speed || 100 });
    const cels: RawCel[] = [];
    celsByFrame.push(cels);

    for (let c = 0; c < chunkCount && r.pos < frameStart + frameSize; c++) {
      const chunkStart = r.pos;
      const chunkSize = r.dword();
      const type = r.word();
      if (type !== 0x2020) { udTarget = null; tagQueue = []; }

      if (type === 0x0004 || type === 0x0011) {
        const scale = type === 0x0011 ? (v: number) => Math.min(255, Math.round(v * 255 / 63)) : (v: number) => v;
        const packets = r.word();
        let index = 0;
        for (let p = 0; p < packets; p++) {
          index += r.byte();
          const count = r.byte() || 256;
          for (let k = 0; k < count; k++, index++) {
            const [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
            oldPalette[index] = `#${hex2(scale(cr))}${hex2(scale(cg))}${hex2(scale(cb))}`;
          }
        }
      } else if (type === 0x2019) {
        const size = r.dword();
        const first = r.dword();
        const last = r.dword();
        r.skip(8);
        newPalette = newPalette ? newPalette.slice() : [];
        paletteAt[f] = newPalette;
        while (newPalette.length < size) newPalette.push('#000000');
        newPalette.length = size;
        for (let i = first; i <= last; i++) {
          const entryFlags = r.word();
          const [cr, cg, cb, ca] = [r.byte(), r.byte(), r.byte(), r.byte()];
          if (entryFlags & 1) r.string();
          newPalette[i] = `#${hex2(cr)}${hex2(cg)}${hex2(cb)}${ca === 255 ? '' : hex2(ca)}`;
        }
      } else if (type === 0x2004) {
        const lf = r.word();
        const lt = r.word();
        const level = r.word();
        r.skip(4);
        const blend = r.word();
        const opacity = r.byte();
        r.skip(3);
        const name = r.string();
        const tileset = lt === 2 ? r.dword() : -1;
        // Image, group and tilemap layers are kept
        fileLayers.push({
          tileset,
          name,
          visible: !!(lf & 1),
          locked: !(lf & 2),
          background: !!(lf & 8),
          continuous: !!(lf & 16),
          collapsed: !!(lf & 32),
          group: lt === 1,
          depth: level,
          opacity: flags & 1 ? opacity / 255 : 1,
          blend: ASE_BLENDS[blend] ?? 'source-over',
          cels: new Array(frameCount).fill(null),
        });
        const layer = fileLayers[fileLayers.length - 1];
        udTarget = (ud, props) => {
          if (ud.text || ud.color) layer.userData = ud;
          if (props[CLIP_PROP]) layer.clip = true;
        };
      } else if (type === 0x2005) {
        const cel: RawCel = {
          layer: r.word(), x: r.short(), y: r.short(), opacity: r.byte(), type: r.word(),
          link: -1, w: 0, h: 0, pixels: null,
        };
        r.skip(7);
        if (cel.type === 1) {
          cel.link = r.word();
        } else if (cel.type === 0 || cel.type === 2) {
          cel.w = r.word();
          cel.h = r.word();
          const data = r.bytes(chunkStart + chunkSize - r.pos);
          cel.pixels = cel.type === 0 ? data : await inflate(data);
        } else if (cel.type === 3) {
          cel.w = r.word();
          cel.h = r.word();
          const bits = r.word();
          cel.idMask = r.dword();
          r.skip(12 + 10);
          const data = await inflate(r.bytes(chunkStart + chunkSize - r.pos));
          if (bits === 32) cel.refs = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + cel.w * cel.h * 4));
        }
        cels.push(cel);
      } else if (type === 0x2023) {
        const id = r.dword(), tf = r.dword(), count = r.dword();
        const tw = r.word(), th = r.word(), base = r.short();
        r.skip(14);
        const name = r.string();
        if (tf & 1) r.skip(8);
        const tiles: Uint32Array[] = [];
        if (tf & 2) {
          const len = r.dword();
          const px = await inflate(r.bytes(len));
          for (let i = 0; i < count; i++) tiles.push(decodeRun(px, i * tw * th, tw * th));
        }
        while (tiles.length < count) tiles.push(new Uint32Array(tw * th));
        const ts = tilesetsRaw[id] = { name, tw, th, baseIndex: base, tiles, zeroEmpty: !!(tf & 4) } as Tileset & { zeroEmpty: boolean; };
        udTarget = ud => { if (ud.text || ud.color) ts.userData = ud; };
      } else if (type === 0x2022) {
        const count = r.dword(), sf = r.dword();
        r.skip(4);
        const name = r.string();
        const keys: Slice['keys'] = [];
        for (let k = 0; k < count; k++) {
          const key: Slice['keys'][number] = { frame: r.dword(), x: r.int(), y: r.int(), w: r.dword(), h: r.dword() };
          if (sf & 1) {
            const m = { x: r.int(), y: r.int(), w: r.dword(), h: r.dword() };
            if (m.w && m.h) key.center = m;
          }
          if (sf & 2) key.pivot = { x: r.int(), y: r.int() };
          keys.push(key);
        }
        const slice: Slice = { name, color: '#5aa9d6', keys };
        slices.push(slice);
        udTarget = ud => {
          if (ud.color) slice.color = ud.color.slice(0, 7);
          if (ud.text) slice.userData = { text: ud.text };
        };
      } else if (type === 0x2020) {
        // User data of the chunk before it (layer, tileset, slice), or of the next tag after a tags chunk
        const { ud, props } = readUserData(r, chunkStart + chunkSize);
        const tag = tagQueue.shift();
        if (tag) {
          if (ud.color) tag.color = ud.color.slice(0, 7);
          if (ud.text) tag.userData = { text: ud.text };
        } else udTarget?.(ud, props);
        udTarget = null;
      } else if (type === 0x2018) {
        const count = r.word();
        r.skip(8);
        for (let t = 0; t < count; t++) {
          const from = r.word();
          const to = r.word();
          const dir = r.byte();
          const repeat = r.word();
          r.skip(6);
          const [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
          r.skip(1);
          tags.push({
            name: r.string(), from, to,
            color: `#${hex2(cr)}${hex2(cg)}${hex2(cb)}`,
            direction: DIRECTIONS[dir] ?? 'forward',
            ...(repeat ? { repeat } : {}),
          });
        }
        tagQueue = count ? tags.slice(-count) : [];
      }

      r.pos = chunkStart + chunkSize;
    }

    r.pos = frameStart + frameSize;
  }

  const firstPalette = paletteAt[0] ?? newPalette ?? oldPalette.map(c => c ?? '#000000');
  // Indexed files carry a transparent slot past the real colors; it isn't part of the palette
  const clean = (cols: string[]) => depth === 8 && transparentIndex >= cols.length - 1 && /^#[0-9a-f]{6}00$/i.test(cols[cols.length - 1] ?? '') ? cols.slice(0, -1) : cols;
  const palette = clean(firstPalette);
  const framePalettes: FramePalette[] = [];
  paletteAt.forEach((cols, f) => { if (f > 0 && cols) framePalettes.push({ frame: f, colors: clean(cols) }); });
  if (framePalettes.length) framePalettes.unshift({ frame: 0, colors: palette });
  /** The packed palette in effect at a frame */
  const palPackedAt = (f: number) => {
    for (let k = f; k >= 0; k--) if (paletteAt[k]) return toPacked(paletteAt[k]);
    return toPacked(firstPalette);
  };
  const tilesets: Tileset[] = tilesetsRaw.map(({ zeroEmpty: _, ...t }) => t);

  // Reorder to the document's bottom-to-top, children-below-group layout
  for (const fi of documentOrder(fileLayers.map(l => l.depth ?? 0))) {
    layerMap[fi] = layers.length;
    layers.push(fileLayers[fi]);
  }

  // Images first, then resolve links
  for (const pass of [0, 1]) {
    for (let f = 0; f < celsByFrame.length; f++) {
      for (const cel of celsByFrame[f]) {
        const li = layerMap[cel.layer] ?? -1;
        if (li < 0) continue;
        const layer = layers[li];
        if (pass === 1) {
          if (cel.type === 1) layer.cels[f] = layer.cels[cel.link] ?? null;
          continue;
        }
        if (cel.refs && (layer.tileset ?? -1) >= 0 && tilesets[layer.tileset!]) {
          const ts = tilesets[layer.tileset!];
          const tiles = { cols: cel.w, rows: cel.h, refs: cel.refs.map(v => { const i = v & (cel.idMask ?? 0x1fffffff); return i < ts.tiles.length ? (i | (v & 0xe0000000)) >>> 0 : 0; }) };
          layer.cels[f] = { x: cel.x, y: cel.y, w: cel.w * ts.tw, h: cel.h * ts.th, tiles, data: renderTiles(ts, tiles) };
          continue;
        }
        if (!cel.pixels) continue;
        // Kept at its own position and size: pixels outside the canvas are preserved
        layer.cels[f] = { x: cel.x, y: cel.y, w: cel.w, h: cel.h, data: decodeRun(cel.pixels, 0, cel.w * cel.h, palPackedAt(f), layer.background) };
      }
      if (pass === 0) {
        for (const cel of celsByFrame[f]) {
          const li = layerMap[cel.layer] ?? -1;
          if (li < 0 || cel.opacity === 255) continue;
          const layer = layers[li];
          layer.celOpacity ??= new Array(frameCount).fill(1);
          layer.celOpacity[f] = cel.opacity / 255;
        }
      }
    }
  }

  const colorMode: ColorMode = depth === 8 ? 'indexed' : depth === 16 ? 'gray' : 'rgb';
  // A transparent entry inside the real palette is a chosen one; the extra slot past it is not
  const docTransparent = depth === 8 && transparentIndex < palette.length ? transparentIndex : -1;
  return { width, height, frames, layers, tags, palette, slices, colorMode, framePalettes, tilesets, transparentIndex: docTransparent };
}
