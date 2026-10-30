import type { LocksRecord } from "@pixprite/api";
import type { ColorMode } from "~/core/ColorMode";
import { tileOf, type Tileset } from "~/core/Tilemap";
import { BLEND_MODES, parentOf, type ExtData, type Frame, type FramePalette, type Guide, type Layer, type Slice, type Tag } from "./SpriteModel";

export function isExtData(v: unknown): v is ExtData {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function isLocksRecord(v: unknown): v is LocksRecord {
  return isExtData(v) && typeof v.owner === 'string';
}

export const PIXPRITE_VERSION = 4;
export const SUPPORTED_PIXPRITE_VERSIONS = [3, 4] as const;

type RawTileset = Omit<Tileset, 'tiles'> & { count: number; d: string; };
type RawLayer = Partial<Omit<Layer, 'name' | 'cels'>> & { name: string; cels: any[]; };
export type PixpriteData = {
  format: 'pixprite';
  version: number;
  width: number;
  height: number;
  name?: string;
  info?: unknown;
  frames: Frame[];
  layers: RawLayer[];
  tags?: Tag[];
  slices?: Slice[];
  guides?: Guide[];
  framePalettes?: FramePalette[];
  tilesets?: RawTileset[];
  loop?: [number, number] | null;
  colorMode?: ColorMode;
  transparentIndex?: number;
  ext?: ExtData;
  locks?: LocksRecord;
};

export function migratePixpriteV3(data: PixpriteData) {
  return {
    ...data,
    version: 4,
    layers: data.layers.map(layer => ({
      ...layer,
      cels: layer.cels.map(cel => typeof cel === 'string'
        ? { x: 0, y: 0, w: data.width, h: data.height, d: cel }
        : cel),
    })),
  };
}

const MAX_DOCUMENT_PIXELS = 4096 * 4096;
const MAX_TOTAL_PIXELS = 4 * MAX_DOCUMENT_PIXELS;
const MAX_DOCUMENT_CELS = 1_000_000;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function validateColor(value: unknown) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new Error('Invalid color');
}

function validateJson(value: unknown, seen = new Set<object>()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw new Error('Invalid extension metadata');
  if (seen.has(value)) throw new Error('Cyclic extension metadata');
  seen.add(value);
  for (const nested of Object.values(value)) validateJson(nested, seen);
  seen.delete(value);
}

function validateExt(value: unknown) {
  if (value === undefined) return;
  if (!isExtData(value)) throw new Error('Invalid extension metadata');
  validateJson(value);
}

function validateUserData(value: any) {
  if (value === undefined) return;
  if (!isExtData(value) || (value.text !== undefined && typeof value.text !== 'string')) throw new Error('Invalid user data');
  if (value.color !== undefined) validateColor(value.color);
}

function validatePixpriteMetadata(data: PixpriteData) {
  validateExt(data.ext);
  for (const frame of data.frames) validateExt(frame?.ext);
  for (const key of data.framePalettes ?? []) {
    if (!Array.isArray(key?.colors) || key.colors.length > 256) throw new Error('Invalid frame palette');
    for (const color of key.colors) validateColor(color);
  }
  for (const tag of data.tags ?? []) {
    validateColor(tag?.color);
    validateUserData(tag?.userData);
    validateExt(tag?.ext);
  }
  for (const slice of data.slices ?? []) {
    validateColor(slice?.color);
    validateUserData(slice?.userData);
    validateExt(slice?.ext);
  }
  for (const ts of data.tilesets ?? []) validateUserData(ts?.userData);
  for (const layer of data.layers) {
    validateUserData(layer?.userData);
    validateExt(layer?.ext);
    for (const cel of layer.cels) if (cel && typeof cel === 'object' && !('link' in cel)) validateExt(cel.ext);
  }
}

export function validatePixpriteShape(value: unknown): asserts value is PixpriteData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid document structure');
  const candidate = value as Record<string, unknown>;
  if (candidate.format !== 'pixprite') throw new Error('Unknown file format');
  if (typeof candidate.version !== 'number' || !Number.isInteger(candidate.version)) throw new Error('Unsupported pixprite version');
  if (candidate.version > PIXPRITE_VERSION) throw new Error(`Newer pixprite version: ${candidate.version}; supported up to ${PIXPRITE_VERSION}`);
  if (!SUPPORTED_PIXPRITE_VERSIONS.includes(candidate.version as 3 | 4)) throw new Error(`Unsupported pixprite version: ${candidate.version}`);
  if (!Array.isArray(candidate.frames) || !candidate.frames.length) throw new Error('Document has no frames');
  if (!Array.isArray(candidate.layers) || !candidate.layers.length) throw new Error('Document has no layers');
  for (const key of ['tags', 'slices', 'guides', 'framePalettes', 'tilesets'] as const)
    if (candidate[key] !== undefined && !Array.isArray(candidate[key])) throw new Error(`Invalid ${key}`);
  const data = value as PixpriteData;
  const size = (w: unknown, h: unknown, kind: string) => {
    if (!Number.isInteger(w) || !Number.isInteger(h) || (w as number) <= 0 || (h as number) <= 0
      || (w as number) > 4096 || (h as number) > 4096) throw new Error(`Invalid ${kind} dimensions`);
    return (w as number) * (h as number);
  };
  size(data.width, data.height, 'document');
  if (data.name !== undefined && typeof data.name !== 'string') throw new Error('Invalid document name');
  if (data.frames.length * data.layers.length > MAX_DOCUMENT_CELS) throw new Error('Document has too many cels');
  if (data.colorMode !== undefined && !['rgb', 'gray', 'indexed'].includes(data.colorMode)) throw new Error('Invalid color mode');
  if (data.transparentIndex !== undefined && (!Number.isInteger(data.transparentIndex) || data.transparentIndex < -1 || data.transparentIndex > 255))
    throw new Error('Invalid transparent index');
  for (const frame of data.frames) {
    if (!frame || !Number.isFinite(frame.duration) || frame.duration <= 0) throw new Error('Invalid frame duration');
  }
  if (data.loop !== undefined && data.loop !== null && (!Array.isArray(data.loop) || data.loop.length !== 2
    || !data.loop.every(Number.isInteger) || data.loop[0] < 0 || data.loop[1] < data.loop[0] || data.loop[1] >= data.frames.length))
    throw new Error('Invalid loop range');
  for (const tag of data.tags ?? []) {
    if (!Number.isInteger(tag.from) || !Number.isInteger(tag.to) || tag.from < 0 || tag.to < tag.from || tag.to >= data.frames.length)
      throw new Error('Invalid tag range');
    if (!['forward', 'reverse', 'pingpong', 'pingpong-reverse'].includes(tag.direction)) throw new Error('Invalid tag direction');
    if (tag.repeat !== undefined && (!Number.isInteger(tag.repeat) || tag.repeat < 0)) throw new Error('Invalid tag repeat');
  }
  for (const slice of data.slices ?? []) {
    if (!Array.isArray(slice.keys)) throw new Error('Invalid slice keys');
    for (const key of slice.keys) {
      if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame >= data.frames.length) throw new Error('Invalid slice frame');
      for (const n of [key.x, key.y, key.w, key.h]) if (!Number.isFinite(n)) throw new Error('Invalid slice coordinates');
      if (key.w <= 0 || key.h <= 0) throw new Error('Invalid slice dimensions');
    }
  }
  for (const guide of data.guides ?? [])
    if ((guide.axis !== 'x' && guide.axis !== 'y') || !Number.isFinite(guide.pos)) throw new Error('Invalid guide');
  const paletteFrames = new Set<number>();
  for (const key of data.framePalettes ?? []) {
    if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame >= data.frames.length || paletteFrames.has(key.frame))
      throw new Error('Invalid frame palette key');
    paletteFrames.add(key.frame);
  }
  let pixelsLeft = MAX_TOTAL_PIXELS;
  const buffer = (encoded: unknown, pixels: number, kind: string) => {
    if (typeof encoded !== 'string' || encoded.length !== Math.ceil(pixels * 4 / 3) * 4)
      throw new Error(`Invalid ${kind} buffer length`);
  };
  const tilesets = data.tilesets ?? [];
  for (const ts of tilesets) {
    const tilePixels = size(ts?.tw, ts?.th, 'tileset');
    if (typeof ts.name !== 'string' || typeof ts.d !== 'string') throw new Error('Invalid tileset');
    if (!Number.isInteger(ts.count) || ts.count < 1 || ts.count * tilePixels > pixelsLeft) throw new Error('Tileset is too large');
    buffer(ts.d, ts.count * tilePixels, 'tileset pixel');
    pixelsLeft -= ts.count * tilePixels;
  }

  for (const layer of data.layers) {
    if (!layer || typeof layer.name !== 'string' || !Array.isArray(layer.cels) || layer.cels.length !== data.frames.length)
      throw new Error('Layer cel count does not match frame count');
    if (layer.depth !== undefined && (!Number.isInteger(layer.depth) || layer.depth < 0)) throw new Error('Invalid layer depth');
    if (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) throw new Error('Invalid layer opacity');
    if (layer.blend !== undefined && !BLEND_MODES.includes(layer.blend)) throw new Error('Invalid layer blend mode');
    if (layer.celOpacity !== undefined && (!Array.isArray(layer.celOpacity) || layer.celOpacity.length !== data.frames.length
      || layer.celOpacity.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Invalid cel opacity');
    for (const key of ['visible', 'locked', 'background', 'continuous', 'group', 'collapsed', 'clip'] as const)
      if (layer[key] !== undefined && typeof layer[key] !== 'boolean') throw new Error(`Invalid layer ${key}`);
    const tileset = layer.tileset ?? -1;
    if (!Number.isInteger(tileset) || tileset < -1 || tileset >= tilesets.length) throw new Error('Invalid layer tileset reference');
    layer.cels.forEach((cel: any, i: number) => {
      if (cel === null) return;
      if (typeof cel === 'string') {
        const pixels = data.width * data.height;
        if (pixels > pixelsLeft) throw new Error('Document pixel data is too large');
        pixelsLeft -= pixels;
        buffer(cel, pixels, 'cel pixel');
        return;
      }
      if (!cel || typeof cel !== 'object' || Array.isArray(cel)) throw new Error('Invalid cel structure');
      if (typeof cel === 'object' && 'link' in cel) {
        if (!Number.isInteger(cel.link) || cel.link < 0 || cel.link >= i || !layer.cels[cel.link])
          throw new Error('Invalid linked cel reference');
        return;
      }
      if (!Number.isInteger(cel.x) || !Number.isInteger(cel.y)) throw new Error('Invalid cel coordinates');
      if (typeof cel.d !== 'string') throw new Error('Invalid cel pixel data');
      const pixels = size(cel.w, cel.h, 'cel');
      if (pixels > pixelsLeft) throw new Error('Document pixel data is too large');
      pixelsLeft -= pixels;
      buffer(cel.d, pixels, 'cel pixel');
      if (cel.t !== undefined) buffer(cel.t, size(cel.tc, cel.tr, 'tilemap'), 'tile reference');
    });
  }
  validatePixpriteMetadata(data);
}

export function validateDocumentIntegrity(doc: { layers: Layer[]; frames: Frame[]; tags: Tag[]; loop: [number, number] | null; tilesets: Tileset[]; }) {
  doc.layers.forEach((layer, i) => {
    if (layer.cels.length !== doc.frames.length || layer.celOpacity.length !== doc.frames.length)
      throw new Error('Document integrity: mismatched cel count');
    if (layer.depth > 0 && parentOf(doc.layers, i) < 0) throw new Error('Document integrity: missing layer group');
    if (layer.group && layer.cels.some(Boolean)) throw new Error('Document integrity: group contains cels');
    if (layer.tileset >= 0) {
      const ts = doc.tilesets[layer.tileset];
      if (!ts) throw new Error('Document integrity: missing tileset');
      for (const cel of layer.cels) if (cel?.tiles) for (const ref of cel.tiles.refs)
        if (tileOf(ref) >= ts.tiles.length) throw new Error('Invalid tile reference');
    }
  });
  for (const tag of doc.tags) if (tag.from < 0 || tag.to < tag.from || tag.to >= doc.frames.length)
    throw new Error('Document integrity: invalid tag range');
  if (doc.loop && (doc.loop[0] < 0 || doc.loop[1] < doc.loop[0] || doc.loop[1] >= doc.frames.length))
    throw new Error('Document integrity: invalid loop range');
}

