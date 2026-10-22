/**
 * Minimal animated GIF89a encoder.
 * Uses the exact colors when the animation has at most 255 of them,
 * otherwise falls back to a fixed 6×7×6 color cube.
 */

type Frame = { data: Uint8ClampedArray; delay: number; };

class ByteWriter {
  bytes: number[] = [];
  byte(v: number) { this.bytes.push(v & 255); }
  word(v: number) { this.byte(v); this.byte(v >> 8); }
  str(s: string) { for (const c of s) this.byte(c.charCodeAt(0)); }
  all(arr: ArrayLike<number>) { for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]); }
}

function buildPalette(frames: Frame[]) {
  const colors = new Map<number, number>();
  for (const { data } of frames) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (!colors.has(key)) {
        if (colors.size >= 255) return null;
        colors.set(key, colors.size + 1);
      }
    }
  }
  return colors;
}

function cubeIndex(r: number, g: number, b: number) {
  return 1 + Math.round(r / 255 * 5) * 42 + Math.round(g / 255 * 6) * 6 + Math.round(b / 255 * 5);
}

/** Variable-width LZW as required by the GIF spec */
function lzw(indices: Uint8Array, minCodeSize: number) {
  const out: number[] = [];
  const clear = 1 << minCodeSize, end = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map<string, number>();
  let next = end + 1;
  let bits = 0, acc = 0;

  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
  };

  emit(clear);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix + ',' + k;
    if (dict.has(key)) { prefix = key; continue; }
    emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix));
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = String(k);
  }
  emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix));
  emit(end);
  if (bits > 0) out.push(acc & 255);
  return out;
}

export function encodeGif(width: number, height: number, frames: Frame[], loop = true) {
  const exact = buildPalette(frames);
  const table = new Uint8Array(256 * 3);
  if (exact) {
    for (const [key, i] of exact) {
      table[i * 3] = key >> 16;
      table[i * 3 + 1] = (key >> 8) & 255;
      table[i * 3 + 2] = key & 255;
    }
  } else {
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      const i = 1 + r * 42 + g * 6 + b;
      table[i * 3] = Math.round(r * 255 / 5);
      table[i * 3 + 1] = Math.round(g * 255 / 6);
      table[i * 3 + 2] = Math.round(b * 255 / 5);
    }
  }

  const w = new ByteWriter();
  w.str('GIF89a');
  w.word(width);
  w.word(height);
  w.byte(0xf7); // global color table, 8 bits per channel, 256 entries
  w.byte(0);
  w.byte(0);
  w.all(table);

  if (loop) {
    w.byte(0x21); w.byte(0xff); w.byte(11);
    w.str('NETSCAPE2.0');
    w.byte(3); w.byte(1); w.word(0); w.byte(0);
  }

  for (const { data, delay } of frames) {
    // Graphic control: restore to background, transparent index 0
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte(0b00001001);
    w.word(Math.max(2, Math.round(delay / 10)));
    w.byte(0);
    w.byte(0);

    w.byte(0x2c);
    w.word(0); w.word(0);
    w.word(width); w.word(height);
    w.byte(0);

    const indices = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      if (data[i + 3] < 128) continue;
      indices[p] = exact
        ? exact.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])!
        : cubeIndex(data[i], data[i + 1], data[i + 2]);
    }

    w.byte(8);
    const packed = lzw(indices, 8);
    for (let i = 0; i < packed.length; i += 255) {
      const chunk = packed.slice(i, i + 255);
      w.byte(chunk.length);
      w.all(chunk);
    }
    w.byte(0);
  }

  w.byte(0x3b);
  return new Uint8Array(w.bytes);
}
