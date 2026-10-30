import { describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage, Layer, RangeClip } from '~/core/Sprite';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite } = await import('~/core/Sprite');

const A = 0xff000001;
const B = 0xff000002;
const C = 0xff000003;
const D = 0xff000004;

const cel = (value: number): CelImage => ({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([value]) });

const layer = (cels: Cel[], continuous = true, depth = 0, group = false): Layer => ({
  name: group ? 'Group' : 'Layer',
  visible: true,
  locked: false,
  background: false,
  continuous,
  opacity: 1,
  blend: 'source-over',
  cels,
  celOpacity: cels.map(() => 1),
  group,
  depth,
  collapsed: false,
  tileset: -1,
});

const spriteWith = (rows: Cel[][], continuous: boolean[] = []) => {
  const sprite = new Sprite(1, 1);
  sprite.frames = rows[0].map(() => ({ duration: 100 }));
  sprite.layers = rows.map((cels, i) => layer(cels, continuous[i] ?? true));
  return sprite;
};

const framesClip = (clip: RangeClip | null) => {
  if (!clip || clip.type !== 'frames') throw new Error('Expected a frames clip');
  return clip;
};

const celsClip = (clip: RangeClip | null) => {
  if (!clip || clip.type !== 'cels') throw new Error('Expected a cels clip');
  return clip;
};

describe('Range clipboard', () => {
  test('copyRange returns null without a timeline range', () => {
    const sprite = spriteWith([[cel(A)]]);
    expect(sprite.copyRange()).toBeNull();
  });

  test('copyRange snapshots frame durations, cels and opacity', () => {
    const a = cel(A), b = cel(B);
    const sprite = spriteWith([[a, b, cel(C)]]);
    sprite.frames[0].duration = 80;
    sprite.frames[1].duration = 120;
    sprite.layers[0].celOpacity = [0.25, 0.75, 1];
    sprite.range = { type: 'frames', layers: [0, 0], frames: [0, 1] };

    const clip = framesClip(sprite.copyRange());

    expect(clip.frames.map(f => f.duration)).toEqual([80, 120]);
    expect(clip.frames[0].cels[0]).toEqual({ cel: a, op: 0.25 });
    expect(clip.frames[1].cels[0]).toEqual({ cel: b, op: 0.75 });
    expect(clip.frames[0].cels[0].cel).toBe(a);
  });

  test('pasteRange inserts frames with timing and preserves links inside independent copies', () => {
    const sharedContinuous = cel(A);
    const sharedPlain = cel(B);
    const originalLast = cel(C);
    const sprite = spriteWith([
      [sharedContinuous, sharedContinuous, originalLast],
      [sharedPlain, sharedPlain, cel(D)],
    ], [true, false]);
    sprite.frames.map((f, i) => { f.duration = 80 + i * 40; });
    sprite.layers[0].celOpacity = [0.2, 0.4, 1];
    sprite.layers[1].celOpacity = [0.3, 0.5, 1];
    sprite.range = { type: 'frames', layers: [0, 1], frames: [0, 1] };
    const clip = framesClip(sprite.copyRange());
    sprite.frame = 1;

    sprite.pasteRange(clip);

    expect(sprite.frames.map(f => f.duration)).toEqual([80, 80, 120, 120, 160]);
    expect(sprite.layers[0].cels[1]).toBe(sharedContinuous);
    expect(sprite.layers[0].cels[2]).toBe(sharedContinuous);
    expect(sprite.layers[0].celOpacity.slice(0, 4)).toEqual([0.2, 0.2, 0.4, 0.4]);

    const copied = sprite.layers[1].cels[1];
    expect(copied).not.toBe(sharedPlain);
    expect(sprite.layers[1].cels[2]).toBe(copied);
    expect(copied!.data).not.toBe(sharedPlain.data);
    expect(copied!.data[0]).toBe(B);
    expect(sprite.layers[1].celOpacity.slice(0, 4)).toEqual([0.3, 0.3, 0.5, 0.5]);

    expect(sprite.layers[0].cels[3]).toBe(sharedContinuous);
    expect(sprite.layers[0].cels[4]).toBe(originalLast);
    expect(sprite.range).toEqual({ type: 'frames', layers: [0, 1], frames: [1, 2] });
  });

  test('copy and paste layers includes group subtrees and detaches only external links', () => {
    const shared = cel(A);
    const child = layer([shared, shared], true, 1);
    const group = layer([null, null], true, 0, true);
    const sprite = spriteWith([[null, null]]);
    sprite.layers = [child, group];
    sprite.layer = 1;
    sprite.range = { type: 'layers', layers: [1, 1], frames: [0, 1] };

    const clip = sprite.copyRange();
    expect(clip?.type).toBe('layers');
    if (!clip || clip.type !== 'layers') throw new Error('Expected a layers clip');
    expect(clip.layers.map(l => [l.name, l.depth, l.group])).toEqual([
      ['Layer', 1, false], ['Group', 0, true],
    ]);

    sprite.pasteRange(clip);

    expect(sprite.layers).toHaveLength(4);
    expect(sprite.layers[2].depth).toBe(1);
    expect(sprite.layers[3].group).toBe(true);
    expect(sprite.layers[2].cels[0]).toBe(sprite.layers[2].cels[1]);
    expect(sprite.layers[2].cels[0]).not.toBe(shared);
    expect(sprite.layers[2].cels[0]!.data).not.toBe(shared.data);
    expect(sprite.layers[0].cels[0]).toBe(shared);
  });

  test('copyRange stores cel rows from top to bottom', () => {
    const a = cel(A), b = cel(B), c = cel(C), d = cel(D);
    const sprite = spriteWith([[a, b], [c, d]]);
    sprite.layers[0].celOpacity = [0.1, 0.2];
    sprite.layers[1].celOpacity = [0.3, 0.4];
    sprite.range = { type: 'cels', layers: [0, 1], frames: [0, 1] };

    const clip = celsClip(sprite.copyRange());

    expect(clip.rows.map(row => row.layer)).toEqual([1, 0]);
    expect(clip.rows[0].cels).toEqual([{ cel: c, op: 0.3 }, { cel: d, op: 0.4 }]);
    expect(clip.rows[1].cels).toEqual([{ cel: a, op: 0.1 }, { cel: b, op: 0.2 }]);
  });

  test('pasteRange extends frames for copied cels and preserves internal copy links', () => {
    const shared = cel(A);
    const other = cel(B);
    const sprite = spriteWith([[null]], [false]);
    const clip: RangeClip = {
      type: 'cels',
      rows: [{ layer: 0, cels: [
        { cel: shared, op: 0.2 },
        { cel: shared, op: 0.4 },
        { cel: other, op: 0.6 },
      ] }],
    };

    sprite.pasteRange(clip);

    expect(sprite.frames).toHaveLength(3);
    expect(sprite.layers[0].cels[0]).toBe(sprite.layers[0].cels[1]);
    expect(sprite.layers[0].cels[0]).not.toBe(shared);
    expect(sprite.layers[0].cels[0]!.data).not.toBe(shared.data);
    expect(sprite.layers[0].cels[2]).not.toBe(other);
    expect(sprite.layers[0].celOpacity).toEqual([0.2, 0.4, 0.6]);
    expect([...shared.data]).toEqual([A]);
  });

  test('pasting cels into the same continuous layer retains original links', () => {
    const shared = cel(A);
    const replaced = cel(B);
    const sprite = spriteWith([[shared, replaced]]);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [0, 0] };
    const clip = celsClip(sprite.copyRange());
    sprite.frame = 1;

    sprite.pasteRange(clip);

    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[0].cels[1]!.data).toBe(shared.data);
  });

  test('pasting cels into another or non-continuous layer makes independent pixels', () => {
    const shared = cel(A);
    const sprite = spriteWith([[shared], [null]], [false, false]);
    const clip: RangeClip = {
      type: 'cels',
      rows: [{ layer: 0, cels: [{ cel: shared, op: 1 }] }],
    };
    sprite.layer = 1;

    sprite.pasteRange(clip);

    expect(sprite.layers[1].cels[0]).not.toBe(shared);
    expect(sprite.layers[1].cels[0]!.data).not.toBe(shared.data);
    expect(sprite.layers[1].cels[0]!.data[0]).toBe(A);
    expect(sprite.layers[0].cels[0]).toBe(shared);
  });

  test('pasting cel rows skips groups and leaves unrelated cels untouched', () => {
    const a = cel(A), b = cel(B), c = cel(C), untouched = cel(D);
    const sprite = spriteWith([[null], [null], [null], [untouched]]);
    sprite.layers[1].group = true;
    sprite.layer = 3;
    const clip: RangeClip = {
      type: 'cels',
      rows: [
        { layer: 10, cels: [{ cel: a, op: 0.1 }] },
        { layer: 11, cels: [{ cel: b, op: 0.2 }] },
        { layer: 12, cels: [{ cel: c, op: 0.3 }] },
      ],
    };

    sprite.pasteRange(clip);

    expect(sprite.layers[3].cels[0]).not.toBe(untouched);
    expect(sprite.layers[3].cels[0]!.data[0]).toBe(A);
    expect(sprite.layers[2].cels[0]!.data[0]).toBe(B);
    expect(sprite.layers[1].cels[0]).toBeNull();
    expect(sprite.layers[0].cels[0]!.data[0]).toBe(C);
    expect(sprite.layers[3].celOpacity[0]).toBe(0.1);
    expect(sprite.layers[2].celOpacity[0]).toBe(0.2);
    expect(sprite.layers[0].celOpacity[0]).toBe(0.3);
  });

  test('moveCels moves the selected block and preserves links at the destination', () => {
    const shared = cel(A);
    const otherLayer = cel(D);
    const sprite = spriteWith([[shared, shared, cel(B), null], [otherLayer, otherLayer, otherLayer, otherLayer]]);
    const range = { type: 'cels' as const, layers: [0, 0] as [number, number], frames: [0, 1] as [number, number] };

    sprite.moveCels(range, 0, 2, false);

    expect(sprite.layers[0].cels[0]).toBeNull();
    expect(sprite.layers[0].cels[1]).toBeNull();
    expect(sprite.layers[0].cels[2]).toBe(shared);
    expect(sprite.layers[0].cels[3]).toBe(shared);
    expect(sprite.layers[1].cels.every(c => c === otherLayer)).toBe(true);
    expect(sprite.range).toEqual({ type: 'cels', layers: [0, 0], frames: [2, 3] });
  });
});
