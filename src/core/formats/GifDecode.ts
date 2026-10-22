/**
 * GIF87a/GIF89a decoder.
 * Produces fully composited RGBA frames (0xAABBGGRR) honoring disposal methods.
 * Truncated input is tolerated: decoding stops and the frames read so far are returned.
 */

export type DecodedGif = {
  width: number;
  height: number;
  frames: { data: Uint32Array; delay: number; }[];
};

class ByteReader {
  pos = 0;
  constructor(public bytes: Uint8Array) { }
  get left() { return this.bytes.length - this.pos; }
  byte() {
    if (this.pos >= this.bytes.length) throw new RangeError('eof');
    return this.bytes[this.pos++];
  }
  word() { const lo = this.byte(); return lo | (this.byte() << 8); }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.byte()); return s; }
  /** Read a palette of n RGB entries as packed opaque colors */
  table(n: number) {
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const r = this.byte(), g = this.byte(), b = this.byte();
      out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return out;
  }
  /** Concatenate data sub-blocks until the terminator (or end of data) */
  blocks() {
    const parts: Uint8Array[] = [];
    let total = 0;
    while (this.pos < this.bytes.length) {
      const size = this.bytes[this.pos++];
      if (size === 0) break;
      const end = Math.min(this.pos + size, this.bytes.length);
      parts.push(this.bytes.subarray(this.pos, end));
      total += end - this.pos;
      this.pos = end;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  skipBlocks() {
    while (this.pos < this.bytes.length) {
      const size = this.bytes[this.pos++];
      if (size === 0) break;
      this.pos += size;
    }
  }
}

/** Variable-width LZW decoder; missing pixels are left as 0 */
function lzwDecode(data: Uint8Array, minCodeSize: number, count: number) {
  const out = new Uint8Array(count);
  if (minCodeSize < 1 || minCodeSize > 11) return out;
  const clear = 1 << minCodeSize, end = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) { suffix[i] = i; first[i] = i; }

  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let prev = -1;
  let acc = 0, bits = 0, pos = 0, o = 0;

  while (o < count) {
    while (bits < codeSize) {
      if (pos >= data.length) return out;
      acc |= data[pos++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;

    if (code === clear) { codeSize = minCodeSize + 1; next = end + 1; prev = -1; continue; }
    if (code === end) break;
    if (prev === -1) {
      if (code >= clear) continue; // invalid start, skip
      out[o++] = code;
      prev = code;
      continue;
    }

    let c = code, sp = 0;
    if (code >= next) {
      if (code > next) break; // corrupt stream
      // KwKwK case: previous string + its first char
      stack[sp++] = first[prev];
      c = prev;
    }
    while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
    stack[sp++] = c;
    const head = c;
    while (sp > 0 && o < count) out[o++] = stack[--sp];

    // Table full (4096): keep decoding without adding entries until a clear (deferred clear)
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = head;
      first[next] = first[prev];
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

/** Row order for 4-pass interlaced images */
function interlaceRows(h: number) {
  const rows: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]])
    for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const r = new ByteReader(bytes);
  const sig = r.str(6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF file');

  const width = r.word(), height = r.word();
  const flags = r.byte();
  r.byte(); // background color index (treated as transparent)
  r.byte(); // pixel aspect ratio
  let global: Uint32Array | null = null;
  if (flags & 0x80) global = r.table(1 << ((flags & 7) + 1));

  const frames: DecodedGif['frames'] = [];
  const canvas = new Uint32Array(width * height);
  let disposal = 0, delay = 0, transparent = -1;

  try {
    while (r.left > 0) {
      const block = r.byte();
      if (block === 0x3b) break;

      if (block === 0x21) {
        const label = r.byte();
        if (label === 0xf9) {
          const ext = r.blocks();
          if (ext.length >= 4) {
            disposal = (ext[0] >> 2) & 7;
            delay = ext[1] | (ext[2] << 8);
            transparent = ext[0] & 1 ? ext[3] : -1;
          }
        } else {
          r.skipBlocks(); // application, comment, plain text
        }
        continue;
      }

      if (block !== 0x2c) break; // unknown block: stop

      const fx = r.word(), fy = r.word(), fw = r.word(), fh = r.word();
      const iflags = r.byte();
      const palette = iflags & 0x80 ? r.table(1 << ((iflags & 7) + 1)) : global;
      const interlaced = (iflags & 0x40) !== 0;
      const minCodeSize = r.byte();
      const indices = lzwDecode(r.blocks(), minCodeSize, fw * fh);

      const backup = disposal === 3 ? canvas.slice() : null;
      const rows = interlaced ? interlaceRows(fh) : null;
      for (let row = 0; row < fh; row++) {
        const y = fy + (rows ? rows[row] : row);
        if (y >= height) continue;
        for (let x = 0; x < fw; x++) {
          const cx = fx + x;
          if (cx >= width) break;
          const idx = indices[row * fw + x];
          if (idx === transparent || !palette || idx >= palette.length) continue;
          canvas[y * width + cx] = palette[idx];
        }
      }

      frames.push({ data: canvas.slice(), delay: (delay || 10) * 10 });

      if (disposal === 2) {
        for (let y = fy; y < Math.min(fy + fh, height); y++)
          canvas.fill(0, y * width + fx, y * width + Math.min(fx + fw, width));
      } else if (backup) {
        canvas.set(backup);
      }
      disposal = 0; delay = 0; transparent = -1;
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
  }

  return { width, height, frames };
}
