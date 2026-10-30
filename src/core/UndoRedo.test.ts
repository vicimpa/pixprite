import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage } from '~/core/Sprite';
import { retainedHistoryMemory } from './SpriteHistory';
import type { SpriteContext } from './SpriteContext';
import { Mask } from './Mask';
import { visitCelBuffers } from './DocumentModel';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite, historyLimits, createImage, createCelInstance } = await import('~/core/Sprite');

const A = 0xff000001;
const B = 0xff000002;
const C = 0xff000003;
const D = 0xff000004;

const cel = (value: number): CelImage => ({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([value]) });

const spriteWith = (cels: Cel[]) => {
  const sprite = new Sprite(1, 1);
  sprite.frames = cels.map(() => ({ duration: 100 }));
  sprite.layers[0].cels = cels;
  sprite.layers[0].celOpacity = cels.map(() => 1);
  return sprite;
};

const edit = (sprite: ReturnType<typeof spriteWith>, value: number, label = 'Edit') => {
  sprite.checkpoint(label);
  sprite.setCel(cel(value), 0, sprite.frame);
};

afterEach(() => {
  historyLimits.steps = 256;
  historyLimits.bytes = 0;
  historyLimits.operationBytes = 0;
});

describe('Undo and redo', () => {
  test('empty history is a no-op', () => {
    const sprite = spriteWith([cel(A)]);
    const layers = sprite.layers;
    const version = sprite.version;

    sprite.undo();
    sprite.redo();

    expect(sprite.layers).toBe(layers);
    expect(sprite.version).toBe(version);
    expect(sprite.canUndo).toBe(false);
    expect(sprite.canRedo).toBe(false);
  });

  test('restores pixel edits in both directions with matching labels', () => {
    const original = cel(A);
    const sprite = spriteWith([original]);
    edit(sprite, B, 'Paint');

    expect(sprite.history).toEqual(['Paint']);
    expect(sprite.canUndo).toBe(true);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);

    sprite.undo();
    expect(sprite.layers[0].cels[0]).toBe(original);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(A);
    expect(sprite.history).toEqual([]);
    expect(sprite.future).toEqual(['Paint']);
    expect(sprite.canRedo).toBe(true);

    sprite.redo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    expect(sprite.history).toEqual(['Paint']);
    expect(sprite.future).toEqual([]);
    expect([...original.data]).toEqual([A]);
  });

  test('a new checkpoint clears the redo branch', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    sprite.undo();
    edit(sprite, C, 'Second');

    expect(sprite.future).toEqual([]);
    sprite.redo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(C);
    expect(sprite.history).toEqual(['Second']);
  });

  test('undo and redo preserve linked-cel identity', () => {
    const shared = cel(A);
    const other = cel(B);
    const sprite = spriteWith([shared, shared, other]);
    sprite.frame = 1;
    sprite.unlinkCels();
    const unlinked = sprite.layers[0].cels[1];

    expect(unlinked).not.toBe(shared);
    sprite.undo();
    expect(sprite.layers[0].cels).toEqual([shared, shared, other]);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);

    sprite.redo();
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(unlinked);
    expect(sprite.layers[0].cels[2]).toBe(other);
    expect(sprite.linkedFrames(0, 0)).toEqual([0]);
  });

  test('restores frames, tags, durations and the active frame step by step', () => {
    const original = cel(A);
    const sprite = spriteWith([original]);
    sprite.addFrame('duplicate');
    sprite.frames[1].duration = 250;
    sprite.range = { type: 'frames', layers: [0, 0], frames: [0, 1] };
    sprite.addTag();

    expect(sprite.frames.map(f => f.duration)).toEqual([100, 250]);
    expect(sprite.tags).toHaveLength(1);

    sprite.undo();
    expect(sprite.tags).toEqual([]);
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.frame).toBe(1);

    sprite.undo();
    expect(sprite.frames).toEqual([{ duration: 100 }]);
    expect(sprite.layers[0].cels).toEqual([original]);
    expect(sprite.frame).toBe(0);

    sprite.redo();
    expect(sprite.frames.map(f => f.duration)).toEqual([100, 250]);
    expect(sprite.layers[0].cels[0]).toBe(original);
    expect(sprite.layers[0].cels[1]).toBe(original);

    sprite.redo();
    expect(sprite.tags).toHaveLength(1);
    expect(sprite.tags[0].from).toBe(0);
    expect(sprite.tags[0].to).toBe(1);
  });

  test('restores frame palette keys on undo and redo', () => {
    const sprite = spriteWith([cel(A), cel(A)]);
    sprite.frame = 1;
    sprite.addFramePalette(['#123456']);

    expect(sprite.framePalettes).toHaveLength(2);
    sprite.undo();
    expect(sprite.framePalettes).toEqual([]);
    expect(sprite.frame).toBe(1);

    sprite.redo();
    expect(sprite.framePalettes).toEqual([
      { frame: 0, colors: ['#123456'] },
      { frame: 1, colors: ['#123456'] },
    ]);
  });

  test('paletteStep restores the external palette host in both directions', () => {
    const sprite = spriteWith([cel(A)]);
    const host = { colors: ['#111111'] };
    sprite.paletteHost = {
      get: () => host.colors,
      set: colors => { host.colors = colors; },
    };
    host.colors = ['#222222'];
    sprite.paletteStep(['#111111'], 0);

    sprite.undo();
    expect(host.colors).toEqual(['#111111']);
    sprite.redo();
    expect(host.colors).toEqual(['#222222']);
  });

  test('rollback returns to the requested depth and forgets redo', () => {
    const original = cel(A);
    const sprite = spriteWith([original]);
    edit(sprite, B, 'First');
    edit(sprite, C, 'Second');

    sprite.rollback(0);

    expect(sprite.layers[0].cels[0]).toBe(original);
    expect(sprite.history).toEqual([]);
    expect(sprite.future).toEqual([]);
    sprite.redo();
    expect(sprite.layers[0].cels[0]).toBe(original);
  });

  test('goToStep navigates backward and forward through history', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    edit(sprite, C, 'Second');
    edit(sprite, D, 'Third');

    sprite.goToStep(1);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    expect(sprite.history).toEqual(['First']);
    expect(sprite.future).toEqual(['Second', 'Third']);

    sprite.goToStep(3);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(D);
    expect(sprite.history).toEqual(['First', 'Second', 'Third']);

    sprite.goToStep(2);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(C);
    expect(sprite.future).toEqual(['Third']);
  });

  test('step limit drops the oldest snapshots', () => {
    historyLimits.steps = 2;
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    edit(sprite, C, 'Second');
    edit(sprite, D, 'Third');

    expect(sprite.undoDepth).toBe(2);
    expect(sprite.history).toEqual(['Second', 'Third']);
    sprite.undo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(C);
    sprite.undo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    sprite.undo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
  });

  test('historyBytes counts metadata and each non-live backing allocation only once', () => {
    const shared = cel(A);
    const sprite = spriteWith([shared, shared]);
    sprite.checkpoint('Edit');
    const memory = () => retainedHistoryMemory.call(sprite as unknown as SpriteContext);
    expect(memory().uniqueBufferBytes).toBe(0);
    expect(sprite.historyBytes()).toBe(memory().metadataPayloadBytes);
    expect(sprite.historyBytes()).toBeGreaterThan(0);

    sprite.setCel(cel(B), 0, 0);
    expect(memory().uniqueBufferBytes).toBe(shared.data.byteLength);
    expect(sprite.historyBytes()).toBe(memory().metadataPayloadBytes + shared.data.byteLength);
    sprite.undo();
    expect(memory().uniqueBufferBytes).toBe(shared.data.byteLength);
    expect(sprite.historyBytes()).toBe(memory().metadataPayloadBytes + shared.data.byteLength);
  });

  test('byte limit retains only the newest affordable snapshots', () => {
    const probe = spriteWith([cel(B)]);
    edit(probe, C, 'Second');
    const budget = probe.historyBytes();
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    edit(sprite, C, 'Second');
    historyLimits.bytes = budget;
    sprite.trimHistory();

    expect(sprite.historyBytes()).toBeLessThanOrEqual(budget);
    expect(sprite.history).toEqual(['Second']);
    sprite.undo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    expect(sprite.canUndo).toBe(false);
  });
});


describe('History memory boundaries', () => {
  const memory = (sprite: InstanceType<typeof Sprite>) => retainedHistoryMemory.call(sprite as unknown as SpriteContext);

  test('counts full backing stores across subarrays, masks, tile refs, tilesets and floating pixels', () => {
    const sprite = spriteWith([cel(A)]);
    const allocation = new ArrayBuffer(128);
    sprite.layers[0].cels[0]!.data = new Uint32Array(allocation, 0, 1);
    sprite.layers[0].cels[0]!.tiles = { cols: 1, rows: 1, refs: new Uint32Array(allocation, 4, 1) };
    sprite.tilesets = [{ name: 'shared', tw: 1, th: 1, baseIndex: 1, tiles: [new Uint32Array(allocation, 8, 1)] }];
    sprite.mask = new Mask(1, 1, new Uint8Array(allocation, 12, 1));
    const bmp = { w: 1, h: 1, data: new Uint32Array(allocation, 16, 1) };
    const shape = new Uint8Array(allocation, 20, 1);
    sprite.floating = { src: bmp, shape, layer: 0, frame: 0,
      place: { x: 0, y: 0, w: 1, h: 1, angle: 0, px: 0, py: 0 },
      result: { x: 0, y: 0, bmp, mask: shape } };
    sprite.checkpoint('All buffers');
    sprite.layers[0].cels = [cel(B)]; sprite.tilesets = []; sprite.mask = null; sprite.floating = null;
    sprite.touch();
    expect(memory(sprite).uniqueBufferBytes).toBe(128);
    sprite.checkpoint('Share prior allocation');
    sprite.touch();
    expect(memory(sprite).uniqueBufferBytes).toBe(128);
    sprite.tilesets = [{ name: 'live', tw: 1, th: 1, baseIndex: 1, tiles: [new Uint32Array(allocation, 24, 1)] }];
    expect(memory(sprite).uniqueBufferBytes).toBe(0);
  });

  test('shared immutable source survives metadata/FX edits without materializing bitmap copies', () => {
    historyLimits.operationBytes = 3000;
    const source = createImage(128, 128, new Uint32Array(128 * 128));
    const a = createCelInstance(source), b = createCelInstance(source, { flipX: true });
    const sprite = spriteWith([a, b, a]);
    for (let i = 0; i < 3; i++) {
      sprite.checkpoint('FX');
      sprite.layers[0].effects = [{ id: 'opacity', type: 'opacity', enabled: true, amount: (i + 1) / 4 }];
      sprite.ext = { fixture: { text: 'данные', index: i } };
      sprite.touch();
    }
    expect(sprite.history).toHaveLength(3);
    expect(memory(sprite).uniqueBufferBytes).toBe(0);
    let bytes = 0;
    visitCelBuffers(a, (_, size) => { bytes += size; });
    expect(bytes).toBe(128 * 128 * 4);
    sprite.undo();
    expect(sprite.layers[0].effects![0]).toMatchObject({ type: 'opacity', amount: .5 });
    expect(sprite.layers[0].cels[0]).toBe(sprite.layers[0].cels[2]);
    sprite.redo();
    expect(sprite.layers[0].effects![0]).toMatchObject({ type: 'opacity', amount: .75 });
  });

  test('metadata payload, including UTF-8 extension strings, participates in total and operation budgets', () => {
    const sprite = spriteWith([cel(A)]);
    sprite.ext = { fixture: { large: 'я'.repeat(1000) } };
    sprite.checkpoint('Remove metadata'); sprite.ext = {}; sprite.touch();
    expect(memory(sprite).metadataPayloadBytes).toBeGreaterThan(2000);
    historyLimits.operationBytes = 1000;
    sprite.trimHistory();
    expect(sprite.history).toEqual([]);
    expect(sprite.ext).toEqual({});
    expect(sprite.historyLimitNotice).toBe('operation');
  });

  test('an oversized new allocation is a barrier; later undo cannot skip it and destroy new work', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'Earlier');
    historyLimits.operationBytes = 2000;
    const large = { x: 0, y: 0, w: 1024, h: 1, data: new Uint32Array(1024).fill(C) };
    sprite.checkpoint('Large edit'); sprite.setCel(large);
    expect(sprite.history).toEqual([]);
    expect(sprite.future).toEqual([]);
    expect(sprite.historyBoundary).toBe(true);
    expect(sprite.historyLimitNotice).toBe('operation');
    sprite.undo();
    expect(sprite.layers[0].cels[0]).toBe(large);
    sprite.checkpoint('Metadata'); sprite.tags = [{ name: 'Later', from: 0, to: 0, color: '#ffffff', direction: 'forward', repeat: 0 }]; sprite.touch();
    sprite.undo();
    expect(sprite.tags).toEqual([]);
    expect(sprite.layers[0].cels[0]).toBe(large);
    sprite.undo();
    expect(sprite.layers[0].cels[0]).toBe(large);
    sprite.redo();
    expect(sprite.tags[0].name).toBe('Later');
  });

  test('total budget has no minimum-one exception and preserves current pixels', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B);
    historyLimits.bytes = 1;
    sprite.trimHistory();
    expect(sprite.historyBytes()).toBe(0);
    expect(sprite.canUndo).toBe(false);
    expect(sprite.historyLimitNotice).toBe('memory');
    sprite.undo(); expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
  });

  test('total and step limits include redo and remove the farthest redo before breaking reachability', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First'); edit(sprite, C, 'Second'); edit(sprite, D, 'Third');
    sprite.undo(); sprite.undo(); sprite.undo();
    historyLimits.steps = 2;
    sprite.trimHistory();
    expect(sprite.future).toEqual(['First', 'Second']);
    const probe = spriteWith([cel(A)]); edit(probe, B, 'First'); probe.undo();
    historyLimits.bytes = probe.historyBytes();
    sprite.trimHistory();
    expect(sprite.future).toEqual(['First']);
    expect(sprite.historyBytes()).toBeLessThanOrEqual(historyLimits.bytes);
    sprite.redo(); expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    sprite.redo(); expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
  });

  test('operation budget applies to existing redo without jumping across an oversized boundary', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    sprite.checkpoint('Large'); sprite.setCel({ x: 0, y: 0, w: 1024, h: 1, data: new Uint32Array(1024).fill(C) });
    sprite.checkpoint('Small metadata'); sprite.ext = { fixture: { value: 'later' } }; sprite.touch();
    sprite.undo(); sprite.undo(); sprite.undo();
    historyLimits.operationBytes = 2000;
    sprite.trimHistory();
    expect(sprite.future).toEqual(['First']);
    sprite.redo(); expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    sprite.redo(); expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
  });

  test('rollback markers stay valid when a stroke evicts older steps', () => {
    historyLimits.steps = 2;
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B); edit(sprite, C);
    const beforeStroke = sprite.historyPosition;
    edit(sprite, D);
    expect(sprite.undoDepth).toBe(2);
    sprite.rollback(beforeStroke);
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(C);
    expect(sprite.canRedo).toBe(false);
  });

  test('closing editor ownership releases snapshots, renderer caches and palette closures', () => {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B); sprite.undo();
    sprite.paletteHost = { get: () => ['#ffffff'], set: () => {} };
    sprite.releaseEditorMemory();
    expect(sprite.history).toEqual([]); expect(sprite.future).toEqual([]);
    expect(sprite.historyBytes()).toBe(0);
    expect(sprite.paletteHost).toBeNull(); expect(sprite.palette).toBeNull();
    expect((sprite as unknown as SpriteContext).cache.size).toBe(0);
    expect((sprite as unknown as SpriteContext).split).toBeNull();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(A);
  });
});


test('active guards preserve oversized cancellation, defer limits until commit and release all ownership', () => {
  for (const budget of ['bytes', 'operationBytes'] as const) {
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'Earlier');
    const guard = sprite.protectHistory();
    historyLimits[budget] = 1;
    edit(sprite, C, 'Oversized stroke');
    expect(sprite.history).toEqual(['Earlier', 'Oversized stroke']);
    expect(sprite.historyGuardCount).toBe(1);
    guard.cancel();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    expect(sprite.historyGuardCount).toBe(0);
    expect(sprite.historyBytes()).toBe(0);
    guard.cancel(); // Released guard cannot restore obsolete work.
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    const committed = sprite.protectHistory();
    edit(sprite, D); committed.commit();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(D);
    expect(sprite.history).toEqual([]);
    expect(sprite.historyGuardCount).toBe(0);
    historyLimits[budget] = 0;
  }
});

test('floating transforms remain cancellable across gesture completion with tiny budgets', () => {
  const sprite = spriteWith([cel(A)]);
  historyLimits.operationBytes = 1;
  sprite.mask = Mask.rect(1, 1, { x: 0, y: 0, w: 1, h: 1 });
  sprite.liftSelection();
  expect(sprite.historyGuardCount).toBe(1);
  sprite.moveFloating(2, 0);
  sprite.cancelFloating();
  expect(sprite.layers[0].cels[0]!.data[0]).toBe(A);
  expect(sprite.floating).toBeNull();
  expect(sprite.historyGuardCount).toBe(0);
  sprite.liftSelection(); sprite.dropFloating();
  expect(sprite.historyGuardCount).toBe(0);
  expect(sprite.history).toEqual([]);
});


test('cached accounting refreshes mask edge allocations and keeps shared live storage excluded', () => {
  const sprite = spriteWith([cel(A)]);
  const mask = Mask.rect(1, 1, { x: 0, y: 0, w: 1, h: 1 });
  sprite.mask = mask; sprite.checkpoint('Mask'); sprite.mask = null; sprite.touch();
  const memory = () => retainedHistoryMemory.call(sprite as unknown as SpriteContext);
  expect(memory().uniqueBufferBytes).toBe(1);
  const edges = mask.edges;
  expect(memory().uniqueBufferBytes).toBe(1 + edges.byteLength);
  sprite.mask = mask;
  expect(memory().uniqueBufferBytes).toBe(0);
});

test('undo restores a cancelled floating lifetime and its rollback guard without retaining it after cancel', () => {
  const sprite = spriteWith([cel(A)]);
  sprite.liftSelection(); sprite.clearSelection();
  expect(sprite.historyGuardCount).toBe(0);
  sprite.undo();
  expect(sprite.floating).not.toBeNull(); expect(sprite.historyGuardCount).toBe(1);
  historyLimits.bytes = 1;
  sprite.cancelFloating();
  expect(sprite.layers[0].cels[0]!.data[0]).toBe(A);
  expect(sprite.floating).toBeNull(); expect(sprite.historyGuardCount).toBe(0);
});
