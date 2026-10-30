import { describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage, Layer, Sprite as SpriteModel } from '~/core/Sprite';

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

const layer = (cels: Cel[], continuous = true, depth = 0): Layer => ({
  name: 'Layer',
  visible: true,
  locked: false,
  background: false,
  continuous,
  opacity: 1,
  blend: 'source-over',
  cels,
  celOpacity: cels.map(() => 1),
  group: false,
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

const expectConsistent = (sprite: SpriteModel) => {
  for (const layer of sprite.layers) {
    expect(layer.cels).toHaveLength(sprite.frames.length);
    expect(layer.celOpacity).toHaveLength(sprite.frames.length);
  }
  for (const tag of sprite.tags) {
    expect(tag.from).toBeGreaterThanOrEqual(0);
    expect(tag.to).toBeGreaterThanOrEqual(tag.from);
    expect(tag.to).toBeLessThan(sprite.frames.length);
  }
  if (sprite.loop) {
    expect(sprite.loop[0]).toBeGreaterThanOrEqual(0);
    expect(sprite.loop[1]).toBeGreaterThanOrEqual(sprite.loop[0]);
    expect(sprite.loop[1]).toBeLessThan(sprite.frames.length);
  }
};

describe('Layer and frame structure operations', () => {
  test('removeFrames deletes a range, shifts tags and preserves remaining cels', () => {
    const a = cel(A), d = cel(D);
    const sprite = spriteWith([[a, cel(B), cel(C), d]]);
    sprite.frames.forEach((f, i) => { f.duration = 80 + i * 10; });
    sprite.tags = [
      { name: 'All', from: 0, to: 3, color: '#000000', direction: 'forward' },
      { name: 'Deleted', from: 1, to: 2, color: '#000000', direction: 'forward' },
      { name: 'Last', from: 3, to: 3, color: '#000000', direction: 'forward' },
    ];
    sprite.loop = [1, 3];
    sprite.range = { type: 'frames', layers: [0, 0], frames: [1, 2] };

    expect(sprite.removeFrames()).toBe(true);

    expect(sprite.frames.map(f => f.duration)).toEqual([80, 110]);
    expect(sprite.layers[0].cels).toEqual([a, d]);
    expect(sprite.layers[0].cels[0]).toBe(a);
    expect(sprite.layers[0].cels[1]).toBe(d);
    expect(sprite.tags.map(t => [t.name, t.from, t.to])).toEqual([
      ['All', 0, 1], ['Last', 1, 1],
    ]);
    expect(sprite.loop).toEqual([1, 1]);
    expect(sprite.frame).toBe(1);
    expectConsistent(sprite);
  });

  test('removeFrames refuses to delete every frame', () => {
    const sprite = spriteWith([[cel(A), cel(B)]]);
    const frames = sprite.frames;
    const cels = sprite.layers[0].cels;
    sprite.range = { type: 'frames', layers: [0, 0], frames: [0, 1] };

    expect(sprite.removeFrames()).toBe(false);
    expect(sprite.frames).toBe(frames);
    expect(sprite.layers[0].cels).toBe(cels);
    expectConsistent(sprite);
  });

  test('moveFrames relocates a block with durations, opacity and link identity', () => {
    const a = cel(A), shared = cel(B), d = cel(D);
    const sprite = spriteWith([[a, shared, shared, d]]);
    sprite.frames.forEach((f, i) => { f.duration = 80 + i * 10; });
    sprite.layers[0].celOpacity = [0.1, 0.2, 0.3, 0.4];
    sprite.frame = 2;

    sprite.moveFrames([1, 2], 0, false);

    expect(sprite.frames.map(f => f.duration)).toEqual([90, 100, 80, 110]);
    expect(sprite.layers[0].cels).toEqual([shared, shared, a, d]);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[0].celOpacity).toEqual([0.2, 0.3, 0.1, 0.4]);
    expect(sprite.frame).toBe(1);
    expect(sprite.range).toEqual({ type: 'frames', layers: [0, 0], frames: [0, 1] });
    expectConsistent(sprite);
  });

  test('moveFrames copies preserve internal links but detach copied pixels', () => {
    const shared = cel(A);
    const other = cel(B);
    const sprite = spriteWith([[shared, shared, other]], [false]);

    sprite.moveFrames([0, 1], 3, true);

    expect(sprite.frames).toHaveLength(3 + 2);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[0].cels[2]).toBe(other);
    const copied = sprite.layers[0].cels[3];
    expect(sprite.layers[0].cels[4]).toBe(copied);
    expect(copied).not.toBe(shared);
    expect(copied!.data).not.toBe(shared.data);
    expect(copied!.data[0]).toBe(A);
    expect(sprite.range).toEqual({ type: 'frames', layers: [0, 0], frames: [3, 4] });
    expectConsistent(sprite);
  });

  test('reverseFrames reverses only selected frames across every layer', () => {
    const a = cel(A), b = cel(B), c = cel(C), d = cel(D);
    const sprite = spriteWith([[a, b, c, d], [d, c, b, a]]);
    sprite.frames.forEach((f, i) => { f.duration = 80 + i * 10; });
    sprite.layers[0].celOpacity = [0.1, 0.2, 0.3, 0.4];
    sprite.layers[1].celOpacity = [0.4, 0.3, 0.2, 0.1];
    sprite.range = { type: 'frames', layers: [0, 1], frames: [1, 2] };

    sprite.reverseFrames();

    expect(sprite.frames.map(f => f.duration)).toEqual([80, 100, 90, 110]);
    expect(sprite.layers[0].cels).toEqual([a, c, b, d]);
    expect(sprite.layers[1].cels).toEqual([d, b, c, a]);
    expect(sprite.layers[0].celOpacity).toEqual([0.1, 0.3, 0.2, 0.4]);
    expect(sprite.layers[1].celOpacity).toEqual([0.4, 0.2, 0.3, 0.1]);
    expectConsistent(sprite);
  });

  test('reverseFrames on a cel range leaves durations and other layers untouched', () => {
    const a = cel(A), b = cel(B), c = cel(C), d = cel(D);
    const sprite = spriteWith([[a, b, c, d], [a, a, a, a]]);
    const durations = sprite.frames.map(f => f.duration);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [0, 2] };

    sprite.reverseFrames();

    expect(sprite.frames.map(f => f.duration)).toEqual(durations);
    expect(sprite.layers[0].cels).toEqual([c, b, a, d]);
    expect(sprite.layers[1].cels).toEqual([a, a, a, a]);
    expectConsistent(sprite);
  });

  test('removeLayers deletes only selected plain layers', () => {
    const a = cel(A), b = cel(B), c = cel(C);
    const sprite = spriteWith([[a], [b], [c]]);
    sprite.layers[0].name = 'A';
    sprite.layers[1].name = 'B';
    sprite.layers[2].name = 'C';
    sprite.range = { type: 'layers', layers: [0, 1], frames: [0, 0] };

    expect(sprite.removeLayers()).toBe(true);

    expect(sprite.layers.map(l => l.name)).toEqual(['C']);
    expect(sprite.layers[0].cels).toEqual([c]);
    expect(sprite.layers[0].cels[0]).toBe(c);
    expect(sprite.layer).toBe(0);
    expectConsistent(sprite);
  });

  test('moveLayer reorders siblings without changing their image data', () => {
    const a = cel(A), b = cel(B), c = cel(C);
    const sprite = spriteWith([[a], [b], [c]]);
    sprite.layers.forEach((l, i) => { l.name = ['A', 'B', 'C'][i]; });
    const aData = a.data, bData = b.data, cData = c.data;
    sprite.layer = 0;

    sprite.moveLayer(1);
    expect(sprite.layers.map(l => l.name)).toEqual(['B', 'A', 'C']);
    expect(sprite.layer).toBe(1);

    sprite.moveLayer(-1);
    expect(sprite.layers.map(l => l.name)).toEqual(['A', 'B', 'C']);
    expect(sprite.layer).toBe(0);
    expect(sprite.layers[0].cels[0]!.data).toBe(aData);
    expect(sprite.layers[1].cels[0]!.data).toBe(bData);
    expect(sprite.layers[2].cels[0]!.data).toBe(cData);
    expectConsistent(sprite);
  });

  test('moveLayers copies preserve links inside the copied layer', () => {
    const shared = cel(A);
    const sprite = spriteWith([[shared, shared]]);

    expect(sprite.moveLayers([0, 0], 1, true)).toBe(true);

    expect(sprite.layers).toHaveLength(2);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[1].name).toBe('Layer copy');
    expect(sprite.layers[1].cels[0]).toBe(sprite.layers[1].cels[1]);
    expect(sprite.layers[1].cels[0]).not.toBe(shared);
    expect(sprite.layers[1].cels[0]!.data).not.toBe(shared.data);
    expectConsistent(sprite);
  });

  test('moveCels copies preserve internal links on non-continuous layers', () => {
    const shared = cel(A);
    const sprite = spriteWith([[shared, shared, null]], [false]);
    const range = { type: 'cels' as const, layers: [0, 0] as [number, number], frames: [0, 1] as [number, number] };

    sprite.moveCels(range, 0, 1, true);

    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(sprite.layers[0].cels[2]);
    expect(sprite.layers[0].cels[1]).not.toBe(shared);
    expect(sprite.layers[0].cels[1]!.data).not.toBe(shared.data);
    expect(sprite.layers[0].cels[1]!.data[0]).toBe(A);
    expectConsistent(sprite);
  });
});
