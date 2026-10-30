import { beforeAll, expect, mock, test } from 'bun:test';
import { installSoftwareCanvas, canvasPixels } from './Canvas.test-helper';
import { createCelInstance, createImage, createLayerMask, imageOf } from './DocumentModel';
import { columnOf, columnPosition, frameAtColumn, frameColumns, remapHiddenRanges } from './TimelineFolding';
import type { Tag } from './SpriteModel';
import { decodeCapture, documentContext, encodeCapture } from './BackgroundDocument';
import { IncrementalDocument } from './IncrementalDocument';
import { retainedHistoryMemory } from './SpriteHistory';
import type { SpriteContext } from './SpriteContext';
mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { Sprite } = await import('./Sprite');
beforeAll(installSoftwareCanvas);
const tag = (from: number, to: number, name = 'Tag'): Tag => ({ name, from, to, color: '#ff0000', direction: 'forward', collapsed: true });
function fixture(count = 8) {
  const sprite = new Sprite(1, 1);
  sprite.frames = Array.from({ length: count }, (_, i) => ({ duration: 100 + i }));
  const image = createImage(1, 1, new Uint32Array([0xff0000ff]));
  const cel = createCelInstance(image);
  sprite.layers[0].cels = Array(count).fill(cel);
  sprite.layers[0].celOpacity = Array(count).fill(1);
  return sprite;
}
const hidden = (s: InstanceType<typeof Sprite>) => frameColumns(s.frames.length, s.tags, s.hiddenFrameRanges).filter(c => c.folded).map(c => [c.from, c.to]);

test('overlapping tags, adjacent ranges and disjoint ranges partition original indices exactly once with compressed widths', () => {
  const columns = frameColumns(12, [tag(1, 4), tag(3, 6)], [[5, 7], [9, 10]]);
  expect(columns).toEqual([
    { from: 0, to: 0, folded: false }, { from: 1, to: 7, folded: true },
    { from: 8, to: 8, folded: false }, { from: 9, to: 10, folded: true }, { from: 11, to: 11, folded: false },
  ]);
  expect(columns.flatMap(c => Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i))).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(columnOf(columns, 6)).toBe(1); expect(columnOf(columns, 8)).toBe(2);
  expect(columnOf(columns, 11)).toBe(4); expect(frameAtColumn(columns, 2)).toBe(8);
  expect(frameAtColumn(columns, 1000)).toBe(1007); expect(frameAtColumn(columns, -10)).toBe(-10);
  expect(frameColumns(1, [], [[0, 0]])).toEqual([{ from: 0, to: 0, folded: true }]);
});

test('tag rename/reorder/move/delete preserves identity and independent hide reasons; explicit same-frame navigation reveals all covering causes only', () => {
  const s = fixture(); s.tags = [tag(1, 4, 'A'), tag(3, 6, 'B')];
  s.hiddenFrameRanges = [[2, 3], [7, 7]]; s.frame = 3;
  expect(hidden(s)).toEqual([[1, 7]]); // Collapse itself leaves the current frame hidden.
  s.updateTag(0, { name: 'Renamed' }); s.tags = [s.tags[1], s.tags[0]];
  expect(s.tags[1].collapsed).toBe(true);
  s.collapseTag(1); expect(hidden(s)).toEqual([[2, 7]]); // B and manual ranges remain.
  s.updateTag(0, { from: 0, to: 3 }); expect(hidden(s)).toEqual([[0, 3], [7, 7]]);
  s.goToFrame(3); expect(hidden(s)).toEqual([[7, 7]]);
  expect(s.tags.every(t => !t.collapsed)).toBe(true); expect(s.hiddenFrameRanges).toEqual([[7, 7]]);
  s.collapseTag(1); s.removeTag(1); expect(hidden(s)).toEqual([[7, 7]]);
  s.foldAll(true); expect(s.tags[0].collapsed).toBe(true);
  s.foldAll(false); expect(hidden(s)).toEqual([]);
});

test('manual folds follow surviving source frames, split around new/copied frames, and keep overlapping reasons separate', () => {
  expect(remapHiddenRanges([[1, 3], [2, 4]], [0, 1, null, 2, 3, 4])).toEqual([[1, 1], [3, 4], [3, 5]]);
  const s = fixture(); s.hiddenFrameRanges = [[1, 3]]; s.frame = 1;
  s.addFrame('empty'); expect(s.hiddenFrameRanges).toEqual([[1, 1], [3, 4]]);
  expect(hidden(s)).toEqual([[1, 1], [3, 4]]);
  s.undo(); expect(s.hiddenFrameRanges).toEqual([[1, 3]]);
  s.range = { type: 'frames', layers: [0, 0], frames: [2, 2] }; s.removeFrames();
  expect(s.hiddenFrameRanges).toEqual([[1, 2]]); expect(s.frames.map(f => f.duration)).toEqual([100, 101, 103, 104, 105, 106, 107]);
  s.undo(); s.moveFrames([1, 2], 7, false);
  expect(s.hiddenFrameRanges).toEqual([[1, 1], [5, 6]]);
  expect(s.frames.map(f => f.duration)).toEqual([100, 103, 104, 105, 106, 101, 102, 107]);
  s.undo(); s.moveFrames([1, 2], 2, true);
  expect(s.hiddenFrameRanges).toEqual([[1, 1], [4, 5]]);
  s.undo(); s.range = { type: 'frames', layers: [0, 0], frames: [0, 7] }; s.reverseFrames();
  expect(s.hiddenFrameRanges).toEqual([[4, 6]]);
  s.undo(); expect(s.hiddenFrameRanges).toEqual([[1, 3]]);
});

test('tag frame intervals stay positional on reorder/reverse, adapt to insert/delete/copy, and never become dangling', () => {
  const s = fixture(); s.tags = [tag(2, 4)]; s.hiddenFrameRanges = [[6, 7]];
  s.moveFrames([0, 0], 8, false); expect(s.tags[0]).toMatchObject({ from: 2, to: 4, collapsed: true });
  s.reverseFrames(); expect(s.tags[0]).toMatchObject({ from: 2, to: 4, collapsed: true });
  s.moveFrames([6, 7], 0, true); expect(s.tags[0]).toMatchObject({ from: 4, to: 6, collapsed: true });
  s.range = { type: 'frames', layers: [0, 0], frames: [4, 6] }; s.removeFrames();
  expect(s.tags).toEqual([]); expect(() => new Sprite().load(s.toJSON())).not.toThrow();
});

test('fold metadata roundtrips sync/worker capture; initial restore and undo retain a hidden current frame without changing render/export/source resources', async () => {
  const s = fixture();
  s.layers[0].mask = createLayerMask(createImage(1, 1, new Uint32Array([0x80000000])));
  s.layers[0].effects = [{ id: 'fx', type: 'opacity', enabled: true, amount: .5 }];
  s.layers[0].bakedEffects = s.frames.map((_, f) => f === 3 ? ['fx'] : []);
  const source = s.getCel()!, image = imageOf(source), mask = s.layers[0].mask;
  const before = s.toJSON(), pixels = s.frames.map((_, f) => [...canvasPixels(s.render(f))]);
  const exported = s.toDocument();
  s.tags = [tag(0, 4)]; s.frame = 3; s.collapseFrames([2, 6]);
  expect(s.getCel()).toBe(source); expect(imageOf(s.getCel()!)).toBe(image); expect(s.layers[0].mask).toBe(mask);
  expect(s.toJSON().images).toEqual(before.images); expect(s.toJSON().layers).toEqual(before.layers);
  expect(s.frames.map((_, f) => [...canvasPixels(s.render(f))])).toEqual(pixels);
  expect(s.toDocument().layers.map(l => l.cels.map(c => c && [...c.data]))).toEqual(exported.layers.map(l => l.cels.map(c => c && [...c.data])));
  const saved = s.toJSON(), loaded = new Sprite(); loaded.load(saved); loaded.frame = 3;
  expect(hidden(loaded)).toEqual([[0, 6]]); expect(loaded.toJSON()).toEqual(saved);
  expect(encodeCapture(decodeCapture(saved))).toEqual(saved);
  expect([...canvasPixels(documentContext(decodeCapture(saved)).render(3))]).toEqual(pixels[3]);
  const asyncLoaded = new Sprite(); await asyncLoaded.loadAsync(saved); expect(asyncLoaded.toJSON()).toEqual(saved);
  s.foldAll(false); s.undo(); expect(s.frame).toBe(3); expect(hidden(s)).toEqual([[0, 6]]);
  s.redo(); expect(hidden(s)).toEqual([]); expect(imageOf(s.getCel()!)).toBe(image);
});

test('metadata-only folds reuse cached Image, tileset and tile buffers; history retains the same source memory', () => {
  const s = fixture();
  s.layers[0].mask = createLayerMask(createImage(1, 1, new Uint32Array([0xff000000])));
  s.tilesets = [{ name: 'Tiles', tw: 1, th: 1, baseIndex: 0, tiles: [new Uint32Array([0xff112233])] }];
  s.layers[0].tileset = 0; s.getCel()!.tiles = { cols: 1, rows: 1, refs: new Uint32Array([0]) };
  const tile = s.tilesets[0].tiles[0], refs = s.getCel()!.tiles!.refs;
  const cache = new IncrementalDocument(), first = cache.capture(s, true);
  first.accept(encodeCapture(first.raw), 'preview');
  s.tags = [tag(1, 4)]; s.collapseFrames([4, 6]);
  const next = cache.capture(s, true);
  expect(next.dirtyResources).toBe(0); expect(next.preview).toBe(false);
  expect(next.raw.images.every(i => typeof i.d === 'string')).toBe(true);
  const memory = retainedHistoryMemory.call(s as unknown as SpriteContext);
  expect(memory.uniqueBufferBytes).toBe(0);
  expect(s.tilesets[0].tiles[0]).toBe(tile); expect(s.getCel()!.tiles!.refs).toBe(refs);
  s.goToFrame(3); expect(cache.capture(s, true).dirtyResources).toBe(0);
});

test('bad bool/range metadata is rejected atomically before replacement, including older version migration inputs', () => {
  const s = fixture(), saved = s.toJSON();
  const bad: unknown[] = [null, {}, [[-1, 2]], [[2, 1]], [[0, 8]], [[0, 1.5]], [[0]], [[0, 1, 2]], ['bad']];
  for (const hiddenFrameRanges of bad) {
    expect(() => s.load({ ...saved, hiddenFrameRanges })).toThrow('Invalid hidden frame ranges');
    expect(s.toJSON()).toEqual(saved);
  }
  for (const version of [5, 6, 7]) expect(() => s.load({ ...saved, version, tags: [{ ...tag(0, 1), collapsed: 1 }] })).toThrow('Invalid tag collapsed');
  const empty = new Sprite(); empty.load({ ...saved, hiddenFrameRanges: undefined }); expect(empty.hiddenFrameRanges).toEqual([]);
});

test('duplicate and clipboard insertion add visible frames without inheriting manual folds; cel overwrites preserve existing frame hiding', () => {
  const s = fixture(); s.hiddenFrameRanges = [[1, 3], [6, 7]]; s.frame = 1;
  s.addFrame(); expect(s.hiddenFrameRanges).toEqual([[1, 1], [3, 4], [7, 8]]);
  expect(s.getCel(0, 1)).toBe(s.getCel(0, 2));
  s.undo(); s.range = { type: 'frames', layers: [0, 0], frames: [0, 1] };
  const clip = s.copyRange()!; s.frame = 2; s.pasteRange(clip);
  expect(s.hiddenFrameRanges).toEqual([[1, 1], [4, 5], [8, 9]]);
  expect(s.frames.length).toBe(10);
  s.undo(); s.range = { type: 'cels', layers: [0, 0], frames: [0, 1] };
  const cels = s.copyRange()!; s.frame = 2; s.pasteRange(cels);
  expect(s.hiddenFrameRanges).toEqual([[1, 3], [6, 7]]);
});


test('compressed tag/onion endpoint positions invert exactly, resize one original frame across the boundary and extrapolate past the final cell', () => {
  const columns = frameColumns(30, [tag(0, 10)], []);
  for (let frame = 0; frame < 30; frame++) expect(frameAtColumn(columns, columnPosition(columns, frame))).toBe(frame);
  const end = columnPosition(columns, 10);
  expect(frameAtColumn(columns, end + 1)).toBe(11);
  expect(frameAtColumn(columns, columnPosition(columns, 29) + 2)).toBe(31);
  expect(frameAtColumn(columns, columnPosition(columns, 0) - 1)).toBe(-1);
});


test('tag create/rename/resize/delete independently dirty an already saved document and retain folded identity without copying sources', () => {
  const s = fixture(), source = s.getCel()!;
  s.projectId = 'saved-fixture'; s.markSaved();
  expect(s.modified).toBe(false); s.addTag(); expect(s.modified).toBe(true);
  s.collapseTag(0); s.markSaved();
  s.updateTag(0, { name: 'Renamed' }); expect(s.modified).toBe(true); expect(s.tags[0].collapsed).toBe(true);
  s.markSaved(); const version = s.version;
  s.updateTag(0, { from: 2, to: 4 }, false); expect(s.version).toBeGreaterThan(version); expect(s.modified).toBe(true);
  expect(s.tags[0]).toMatchObject({ name: 'Renamed', from: 2, to: 4, collapsed: true });
  s.markSaved(); s.removeTag(0); expect(s.modified).toBe(true); expect(s.tags).toEqual([]);
  expect(s.getCel()).toBe(source);
});
