/**
 * Animated PNG reader/writer. Every written frame is stored whole (RGBA, filter "none" per row),
 * compressed with the browser's zlib (CompressionStream 'deflate').
 */

import { crc32 } from "~/core/formats/Crc32";
import { inflatePixels } from "~/core/formats/Inflate";

export type ApngFrame = { data: Uint8ClampedArray | Uint8Array; delay: number; };

async function zlib(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Scanlines with a leading filter byte (0 = none) */
function raw(w: number, h: number, data: Uint8ClampedArray | Uint8Array) {
  const out = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) out.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  return out;
}

/** `loops` = 0 plays forever */
export async function encodeApng(w: number, h: number, frames: ApngFrame[], loops = 0): Promise<Uint8Array> {
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  parts.push(chunk('IHDR', ihdr));

  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, loops);
  parts.push(chunk('acTL', actl));

  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const fctl = new Uint8Array(26);
    const fv = new DataView(fctl.buffer);
    fv.setUint32(0, seq++);
    fv.setUint32(4, w);
    fv.setUint32(8, h);
    // Offsets stay 0; delay in milliseconds (numerator / 1000)
    fv.setUint16(20, Math.max(0, Math.min(65535, Math.round(f.delay))));
    fv.setUint16(22, 1000);
    fctl[24] = 1; // dispose to background: frames are whole, so each one replaces the last
    fctl[25] = 0; // source (no blending)
    parts.push(chunk('fcTL', fctl));
    const z = await zlib(raw(w, h, f.data));
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const body = new Uint8Array(4 + z.length);
      new DataView(body.buffer).setUint32(0, seq++);
      body.set(z, 4);
      parts.push(chunk('fdAT', body));
    }
  }
  parts.push(chunk('IEND', new Uint8Array(0)));

  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

export type DecodedApng = {
  width: number;
  height: number;
  frames: { data: Uint32Array; delay: number; }[];
  loops: number;
};

function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(bytes: Uint8Array, w: number, h: number) {
  const stride = w * 4;
  if (bytes.length !== h * (stride + 1)) throw new Error('Invalid PNG pixel buffer length');
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = bytes[y * (stride + 1)];
    if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const raw = bytes[y * (stride + 1) + x + 1];
      const a = x >= 4 ? out[at - 4] : 0;
      const b = y ? out[at - stride] : 0;
      const c = x >= 4 && y ? out[at - stride - 4] : 0;
      const delta = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      out[at] = raw + delta;
    }
  }
  return out;
}

const joinBytes = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

export async function decodeApng(bytes: Uint8Array): Promise<DecodedApng> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((v, i) => bytes[i] !== v)) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0, loops = 1;
  let current: { delay: number; parts: Uint8Array[]; } | null = null;
  const frames: { delay: number; parts: Uint8Array[]; }[] = [];
  let ended = false;

  for (let pos = 8; pos + 12 <= bytes.length && !ended;) {
    const length = view.getUint32(pos);
    const body = pos + 8, end = body + length;
    if (end + 4 > bytes.length) throw new Error('Truncated PNG chunk');
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('Invalid PNG header');
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      depth = bytes[body + 8];
      color = bytes[body + 9];
      interlace = bytes[body + 12];
      if (!width || !height || width * height > 4096 * 4096) throw new Error('Invalid PNG dimensions');
    } else if (type === 'acTL' && length >= 8) {
      loops = view.getUint32(body + 4);
    } else if (type === 'fcTL') {
      if (length !== 26) throw new Error('Invalid APNG frame control');
      const w = view.getUint32(body + 4), h = view.getUint32(body + 8);
      const x = view.getUint32(body + 12), y = view.getUint32(body + 16);
      if (x || y || (width && (w !== width || h !== height))) throw new Error('Partial APNG frames are not supported');
      const numerator = view.getUint16(body + 20), denominator = view.getUint16(body + 22);
      current = { delay: numerator * 1000 / (denominator || 100), parts: [] };
      frames.push(current);
    } else if (type === 'IDAT') {
      if (!current) {
        current = { delay: 100, parts: [] };
        frames.push(current);
      }
      current.parts.push(bytes.subarray(body, end));
    } else if (type === 'fdAT') {
      if (!current || length < 4) throw new Error('Invalid APNG frame data');
      current.parts.push(bytes.subarray(body + 4, end));
    } else if (type === 'IEND') ended = true;
    pos = end + 4;
  }

  if (!ended) throw new Error('PNG has no IEND chunk');
  if (!width || !height || width * height > 4096 * 4096) throw new Error('Invalid PNG dimensions');
  if (depth !== 8 || color !== 6 || interlace) throw new Error('Only non-interlaced RGBA8 PNG is supported');
  if (!frames.length) throw new Error('PNG has no image data');
  if (width * height * frames.length > 4 * 4096 * 4096) throw new Error('PNG animation is too large');
  const decoded: DecodedApng['frames'] = [];
  for (const frame of frames) {
    const raw = unfilter(await inflatePixels(joinBytes(frame.parts), height * (width * 4 + 1)), width, height);
    decoded.push({ data: new Uint32Array(raw.buffer), delay: frame.delay });
  }
  return { width, height, frames: decoded, loops };
}
