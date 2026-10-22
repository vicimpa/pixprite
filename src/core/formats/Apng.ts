/**
 * Animated PNG writer. Every frame is stored whole (RGBA, filter "none" per row),
 * compressed with the browser's zlib (CompressionStream 'deflate').
 */

import { crc32 } from "~/core/formats/Crc32";

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
