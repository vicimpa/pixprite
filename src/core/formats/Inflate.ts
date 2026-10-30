/** Inflate exactly the validated pixel payload, cancelling oversized streams. */
export async function inflatePixels(data: Uint8Array, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 4096 * 4096 + 4096)
    throw new Error('Invalid decompressed pixel buffer length');
  const reader = new Blob([data as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate')).getReader();
  const output = new Uint8Array(length);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > length) throw new Error('Invalid decompressed pixel buffer length');
      output.set(value, offset);
      offset += value.length;
    }
    if (offset !== length) throw new Error('Invalid decompressed pixel buffer length');
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
