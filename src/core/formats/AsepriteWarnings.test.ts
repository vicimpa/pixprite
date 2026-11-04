import { expect, test } from 'bun:test';
import { decodeAseprite } from './Aseprite';
import { decodeCapture, encodeCapture } from '../BackgroundDocument';
import { validAsepriteWarnings } from '../AsepriteWarnings';

/** Small hand-built files, independent of the Pixprite encoder. Numeric fields follow ase-file-specs.md. */
function fixture(chunks: { type: number; body: number[] }[], ratio = [1, 1]) {
  const length = 144 + chunks.reduce((n, c) => n + c.body.length + 6, 0);
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  view.setUint32(0, length, true); view.setUint16(4, 0xa5e0, true); view.setUint16(6, 1, true);
  view.setUint16(8, 2, true); view.setUint16(10, 2, true); view.setUint16(12, 32, true);
  bytes[34] = ratio[0]; bytes[35] = ratio[1];
  view.setUint32(128, length - 128, true); view.setUint16(132, 0xf1fa, true);
  view.setUint16(134, chunks.length, true); view.setUint16(136, 100, true);
  let offset = 144;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.body.length + 6, true); view.setUint16(offset + 4, chunk.type, true);
    bytes.set(chunk.body, offset + 6); offset += chunk.body.length + 6;
  }
  return bytes;
}

test('unknown chunks, wide pixels, ICC and external references produce bounded diagnostics', async () => {
  const doc = await decodeAseprite(fixture([
    { type: 0xbeef, body: [1, 2, 3] }, { type: 0xbeef, body: [] },
    { type: 0x2007, body: [2, 0, 0, 0, ...Array(16).fill(0)] },
    { type: 0x2008, body: [1, 0, 0, 0, ...Array(8).fill(0)] },
  ], [2, 1]));
  expect(doc.warnings).toEqual([
    { kind: 'unknownChunk', detail: '0xbeef' },
    { kind: 'colorProfile' }, { kind: 'externalFiles' },
  ]);
  expect(validAsepriteWarnings(doc.warnings)).toBe(true);
  expect([doc.pixelRatioX, doc.pixelRatioY]).toEqual([2, 1]);
});

test('ordinary sRGB and default/zero aspect ratios do not claim a lossy profile conversion', async () => {
  for (const ratio of [[1, 1], [0, 2]]) {
    const doc = await decodeAseprite(fixture([{ type: 0x2007, body: [1, 0, 0, 0, ...Array(12).fill(0)] }], ratio));
    expect(doc.warnings).toBeUndefined();
  }
});

test('custom user properties are reported even when their value type is unknown', async () => {
  const body = [4, 0, 0, 0, 21, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 120, 255, 127];
  expect((await decodeAseprite(fixture([{ type: 0x2020, body }]))).warnings).toContainEqual({ kind: 'userProperties' });
});

test('diagnostics survive worker preparation and .pixprite round trips; malformed diagnostics fail validation', () => {
  const raw = { format: 'pixprite', version: 5, width: 2, height: 2, frames: [{ duration: 100 }], images: [],
    layers: [{ name: 'Layer', cels: [null] }], asepriteWarnings: [{ kind: 'unknownChunk' as const, detail: '0xbeef' }] };
  expect(encodeCapture(decodeCapture(raw)).asepriteWarnings).toEqual(raw.asepriteWarnings);
  for (const warnings of [[{ kind: 'not-real' }], [{ kind: 'unknownChunk', detail: 42 }], Array(257).fill({ kind: 'colorProfile' })]) {
    expect(() => decodeCapture({ ...raw, asepriteWarnings: warnings })).toThrow('diagnostics');
  }
});

test('an unknown chunk cannot bypass binary length checks', async () => {
  const bytes = fixture([{ type: 0xbeef, body: [] }]);
  new DataView(bytes.buffer).setUint32(144, 99999, true);
  await expect(decodeAseprite(bytes)).rejects.toThrow('chunk length');
});
