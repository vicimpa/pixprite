/**
 * Heavy pure computations that may run in a worker (see Work.ts). Same code runs on the
 * main thread when workers aren't available. Nothing here touches the DOM or app state.
 */

import { convertPixels, PaletteMap, type ColorMode, type Dither } from "~/core/ColorMode";
import { encodeGif } from "~/core/Gif";
import { paletteFromPixels, remapToPalette } from "~/core/Quantize";

import { hydrateDocument, splitDocument, type Resource, type StoredDocument } from './DocumentResources';
import { asepriteDocument, decodeCapture, inspectDocument, prepareDocument } from './BackgroundDocument';
import type { DocumentCapture, StorageCapture } from './SpriteSerialization';
import { encodeAseprite } from './formats/Aseprite';
import { encodeZip } from './formats/Zip';
import { prepareExport, type ExportRequest, type PreparedExport } from './ExportPreparation';
import { bitmapToCanvas } from './Image';
import { tilesetImage, mapGrid, mapJson, mapCsv, type Tileset, type TileRefs } from './Tilemap';

export type CelPixels = { data: Uint32Array; w: number; h: number; x: number; y: number; };

export type Ops = {
  tileExport: {
    args: { ts: Tileset; cols?: number; map?: { cel: { x: number; y: number; tiles?: TileRefs } | null; width: number; height: number; layer: string; image: string; format: 'json' | 'csv' } };
    result: { png: Blob; map?: Blob };
  };
  export: { args: ExportRequest; result: PreparedExport };
  splitStorageDocument: { args: { data: unknown }; result: Awaited<ReturnType<typeof splitDocument>> };
  hydrateStorageDocument: { args: { data: StoredDocument; resources: [string, Resource][] }; result: Awaited<ReturnType<typeof hydrateDocument>> };
  prepareDocument: { args: { raw: DocumentCapture | StorageCapture; preview?: boolean }; result: Awaited<ReturnType<typeof prepareDocument>> };
  decodeDocument: { args: { data: unknown }; result: DocumentCapture };
  inspectDocument: { args: { data: unknown }; result: number };
  stringify: { args: { data: unknown }; result: string };
  jsonBytes: { args: { data: unknown }; result: Uint8Array };
  projectFile: { args: { raw: DocumentCapture; format: 'pixprite' | 'aseprite'; palette: string[] }; result: Blob };
  zip: { args: { entries: { name: string; data: Uint8Array }[] }; result: Uint8Array };

  /** Color mode conversion of many cels (results in the same order) */
  convert: {
    args: { cels: CelPixels[]; mode: ColorMode; palette: number[] | null; dither: Dither; amount: number; };
    result: Uint32Array[];
  };
  /** Palette extraction from frames */
  palette: {
    args: { buffers: Uint32Array[]; count: number; includeAlpha: boolean; };
    result: string[];
  };
  /** Remapping one image to a palette */
  remap: {
    args: { data: Uint32Array; w: number; h: number; palette: string[]; dither: boolean; };
    result: Uint32Array;
  };
  /** GIF file bytes */
  gif: {
    args: { width: number; height: number; frames: { data: Uint8ClampedArray; delay: number; }[]; loop: boolean; };
    result: Uint8Array;
  };
};

export type OpName = keyof Ops;

/** One unit of work; `progress` gets 0..1. `step` lets a long loop pause (yield) or stop between items. */
export async function compute<K extends OpName>(
  op: K, args: Ops[K]['args'], progress: (p: number) => void, step: () => Promise<void> | void = () => { },
): Promise<Ops[K]['result']> {
  await step();
  switch (op) {
    case 'tileExport': {
      const a = args as Ops['tileExport']['args'];
      const png = await bitmapToCanvas(tilesetImage(a.ts, a.cols ?? 0)).convertToBlob({ type: 'image/png' });
      const m = a.map;
      if (!m) return { png } as Ops[K]['result'];
      const grid = mapGrid(a.ts, m.cel, m.width, m.height);
      const map = m.format === 'csv' ? new Blob([mapCsv(grid)], { type: 'text/csv' }) : new Blob([mapJson(a.ts, grid, m.layer, m.image)], { type: 'application/json' });
      return { png, map } as Ops[K]['result'];
    }
    case 'export': return await prepareExport(args as ExportRequest) as Ops[K]['result'];
    case 'splitStorageDocument': return await splitDocument((args as Ops['splitStorageDocument']['args']).data) as Ops[K]['result'];
    case 'hydrateStorageDocument': {
      const a = args as Ops['hydrateStorageDocument']['args'];
      return await hydrateDocument(a.data, a.resources) as Ops[K]['result'];
    }
    case 'prepareDocument': {
      const a = args as Ops['prepareDocument']['args'];
      return await prepareDocument(a.raw, a.preview) as Ops[K]['result'];
    }
    case 'decodeDocument': return decodeCapture((args as Ops['decodeDocument']['args']).data) as Ops[K]['result'];
    case 'inspectDocument': return inspectDocument((args as Ops['inspectDocument']['args']).data) as Ops[K]['result'];
    case 'jsonBytes': return new TextEncoder().encode(JSON.stringify((args as Ops['jsonBytes']['args']).data)) as Ops[K]['result'];
    case 'stringify': return JSON.stringify((args as Ops['stringify']['args']).data) as Ops[K]['result'];
    case 'zip': return encodeZip((args as Ops['zip']['args']).entries) as Ops[K]['result'];
    case 'projectFile': {
      const a = args as Ops['projectFile']['args'];
      if (a.format === 'pixprite') {
        const prepared = await prepareDocument(a.raw);
        return new Blob([JSON.stringify(prepared.data)], { type: 'application/json' }) as Ops[K]['result'];
      }
      const doc = asepriteDocument(a.raw);
      if (!doc.palette.length) doc.palette = a.palette;
      return new Blob([await encodeAseprite(doc) as BlobPart], { type: 'application/octet-stream' }) as Ops[K]['result'];
    }

    case 'convert': {
      const a = args as Ops['convert']['args'];
      const pal = a.palette ? new PaletteMap(a.palette) : null;
      const out: Uint32Array[] = [];
      for (let i = 0; i < a.cels.length; i++) {
        await step();
        const c = a.cels[i];
        const data = c.data.slice();
        convertPixels(data, c.w, c.h, a.mode, pal, a.dither, a.amount, c.x, c.y);
        out.push(data);
        progress((i + 1) / a.cels.length);
      }
      return out as Ops[K]['result'];
    }
    case 'palette': {
      const a = args as Ops['palette']['args'];
      return paletteFromPixels(a.buffers, a.count, a.includeAlpha) as Ops[K]['result'];
    }
    case 'remap': {
      const a = args as Ops['remap']['args'];
      return remapToPalette(a.data, a.w, a.h, a.palette, a.dither) as Ops[K]['result'];
    }
    case 'gif': {
      const a = args as Ops['gif']['args'];
      return encodeGif(a.width, a.height, a.frames, a.loop) as Ops[K]['result'];
    }
  }
  throw new Error(`Unknown operation: ${String(op)}`);
}

/** Buffers in a result that can be moved instead of copied */
export function transferables(value: unknown): Transferable[] {
  const out = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer) out.add(v.buffer); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach(walk);
  };
  walk(value);
  return [...out];
}
