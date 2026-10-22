/**
 * Heavy pure computations that may run in a worker (see Work.ts). Same code runs on the
 * main thread when workers aren't available. Nothing here touches the DOM or app state.
 */

import { convertPixels, PaletteMap, type ColorMode, type Dither } from "~/core/ColorMode";
import { encodeGif } from "~/core/Gif";
import { paletteFromPixels, remapToPalette } from "~/core/Quantize";

export type CelPixels = { data: Uint32Array; w: number; h: number; x: number; y: number; };

export type Ops = {
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
  switch (op) {
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
  const walk = (v: unknown) => {
    if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer) out.add(v.buffer); }
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(value);
  return [...out];
}
