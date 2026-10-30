import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage } from '~/core/Sprite';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite, historyLimits } = await import('~/core/Sprite');

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

  test('historyBytes counts each non-live pixel buffer only once', () => {
    const shared = cel(A);
    const sprite = spriteWith([shared, shared]);
    sprite.checkpoint('Edit');
    expect(sprite.historyBytes()).toBe(0);

    sprite.setCel(cel(B), 0, 0);
    expect(sprite.historyBytes()).toBe(shared.data.byteLength);
    sprite.undo();
    expect(sprite.historyBytes()).toBe(shared.data.byteLength);
  });

  test('byte limit retains only the newest affordable snapshots', () => {
    historyLimits.bytes = 4;
    const sprite = spriteWith([cel(A)]);
    edit(sprite, B, 'First');
    edit(sprite, C, 'Second');
    sprite.trimHistory();

    expect(sprite.history).toEqual(['Second']);
    sprite.undo();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(B);
    expect(sprite.canUndo).toBe(false);
  });
});
