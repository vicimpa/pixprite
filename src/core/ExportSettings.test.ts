import { expect, test } from 'bun:test';
import { captureLastExport, lastExportOptions, readLastExport } from './ExportSettings';

const target = () => ({ tags: [{ name: 'Walk' }], layers: [{ name: 'Body' }], slices: [{ name: 'Head' }],
  range: null, mask: null }) as unknown as Parameters<typeof captureLastExport>[0];

test('saved export preferences are independent, serializable and exclude output names', () => {
  const a = target(), b = target();
  const first = captureLastExport(a, { kind: 'png', scale: 2, name: 'do-not-reuse' });
  const second = captureLastExport(b, { kind: 'gif', scale: 3 });
  const restored = readLastExport(JSON.parse(JSON.stringify(first)));
  expect(lastExportOptions(a, restored)).toEqual({ kind: 'png', scale: 2 });
  expect(lastExportOptions(b, second)).toEqual({ kind: 'gif', scale: 3 });
  const copy = lastExportOptions(a, restored)!; copy.scale = 8;
  expect(lastExportOptions(a, restored)?.scale).toBe(2);
});

test('a deleted or replaced tag/layer/slice requires choosing the target again', () => {
  for (const option of [{ tag: 0 }, { layer: 0 }, { area: { kind: 'slice' as const, index: 0 } }]) {
    const doc = target();
    const last = captureLastExport(doc, { kind: 'gif', scale: 1, ...option });
    expect(lastExportOptions(doc, last)).not.toBeNull();
    doc.tags[0].name = 'Different tag'; doc.layers[0].name = 'Different layer'; doc.slices[0].name = 'Different slice';
    expect(lastExportOptions(doc, last)).toBeNull();
    doc.tags = []; doc.layers = []; doc.slices = [];
    expect(lastExportOptions(doc, last)).toBeNull();
  }
  const doc = target();
  expect(lastExportOptions(doc, captureLastExport(doc, { kind: 'gif', scale: 1, tag: -1 }))).toBeNull();
  expect(lastExportOptions(doc, captureLastExport(doc, { kind: 'png', scale: 1, area: { kind: 'selection' } }))).toBeNull();
});

test('corrupt or incomplete persisted export records are ignored', () => {
  for (const value of [null, {}, { options: { kind: 'png', scale: -1 } }, { options: { kind: 'sheet', scale: 1 } },
    { options: { kind: 'png', scale: 1, area: { kind: 'slice', index: -1 } } },
    { options: { kind: 'png', scale: 1, icoSizes: [10000000] } }, { options: { kind: 'exec', scale: 1 } }]) {
    expect(readLastExport(value)).toBeNull();
  }
});
