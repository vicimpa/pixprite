import { describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage, Sprite as SpriteModel } from '~/core/Sprite';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite } = await import('~/core/Sprite');

const A = 0xff000001;
const B = 0xff000002;
const C = 0xff000003;
const D = 0xff000004;

const cel = (value: number, x = 0, y = 0): CelImage => ({
  x, y, w: 1, h: 1, data: new Uint32Array([value]),
});

const spriteWith = (cels: Cel[], continuous = true) => {
  const sprite = new Sprite(2, 2);
  sprite.frames = cels.map(() => ({ duration: 100 }));
  sprite.layers[0].cels = cels;
  sprite.layers[0].celOpacity = cels.map(() => 1);
  sprite.layers[0].continuous = continuous;
  return sprite;
};

const addLayer = (sprite: SpriteModel, cels: Cel[], continuous = true) => {
  const base = sprite.layers[0];
  sprite.layers = [...sprite.layers, {
    ...base,
    name: `Layer ${sprite.layers.length + 1}`,
    cels,
    celOpacity: cels.map(() => 1),
    continuous,
    locked: false,
  }];
  return sprite.layers.length - 1;
};

describe('Linked cels', () => {
  test('finds links by image identity, not by equal pixels', () => {
    const shared = cel(A);
    const equalButIndependent = cel(A);
    const sprite = spriteWith([shared, shared, equalButIndependent, null]);

    expect(sprite.linkedFrames(0, 0)).toEqual([0, 1]);
    expect(sprite.linkedFrames(0, 1)).toEqual([0, 1]);
    expect(sprite.linkedFrames(0, 2)).toEqual([2]);
    expect(sprite.linkedFrames(0, 3)).toEqual([3]);
    expect(sprite.isLinked(0, 0)).toBe(true);
    expect(sprite.isLinked(0, 2)).toBe(false);
    expect(sprite.isLinked(0, 3)).toBe(false);
  });

  test('setCel replaces every linked frame and leaves unrelated cels untouched', () => {
    const shared = cel(A);
    const unrelated = cel(B);
    const sprite = spriteWith([shared, shared, unrelated, null]);
    const replacement = cel(C);

    sprite.setCel(replacement, 0, 1);

    expect(sprite.layers[0].cels[0]).toBe(replacement);
    expect(sprite.layers[0].cels[1]).toBe(replacement);
    expect(sprite.layers[0].cels[2]).toBe(unrelated);
    expect(sprite.layers[0].cels[3]).toBeNull();
    expect([...shared.data]).toEqual([A]);
    expect([...unrelated.data]).toEqual([B]);
  });

  test('putCanvas edits linked images together without mutating their previous image', () => {
    const shared: CelImage = { x: 0, y: 0, w: 2, h: 2, data: new Uint32Array([A, A, A, A]) };
    const unrelated = cel(C);
    const sprite = spriteWith([shared, shared, unrelated]);

    sprite.putCanvas(new Uint32Array([B, B, C, D]), 0, 1);

    const next = sprite.layers[0].cels[0]!;
    expect(sprite.layers[0].cels[1]).toBe(next);
    expect(next).not.toBe(shared);
    expect([...next.data]).toEqual([B, B, C, D]);
    expect([...shared.data]).toEqual([A, A, A, A]);
    expect(sprite.layers[0].cels[2]).toBe(unrelated);
  });

  test('linkCels uses the first non-empty cel and stays inside the range', () => {
    const first = cel(A);
    const before = cel(B);
    const after = cel(D);
    const sprite = spriteWith([before, null, first, cel(C), cel(B), after]);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [1, 4] };

    sprite.linkCels();

    const cels = sprite.layers[0].cels;
    expect(cels[0]).toBe(before);
    expect(cels[1]).toBeNull();
    expect(cels[2]).toBe(first);
    expect(cels[3]).toBe(first);
    expect(cels[4]).toBe(first);
    expect(cels[5]).toBe(after);
    expect(sprite.linkedFrames(0, 4)).toEqual([2, 3, 4]);
  });

  test('linkCels applies to all layers in a frame range except locked layers', () => {
    const editable = spriteWith([cel(A), cel(B), cel(C)]);
    const lockedFirst = cel(D);
    const locked = addLayer(editable, [lockedFirst, cel(A), cel(B)]);
    editable.layers[locked].locked = true;
    const outsideFirst = cel(C);
    const outside = addLayer(editable, [outsideFirst, cel(D), cel(A)]);
    editable.layers[outside].locked = false;
    editable.range = { type: 'frames', layers: [0, 1], frames: [0, 2] };

    editable.linkCels();

    expect(editable.layers[0].cels[1]).toBe(editable.layers[0].cels[0]);
    expect(editable.layers[0].cels[2]).toBe(editable.layers[0].cels[0]);
    expect(editable.layers[locked].cels[1]).not.toBe(lockedFirst);
    expect(editable.layers[locked].cels[2]).not.toBe(lockedFirst);
    expect(editable.layers[outside].cels[1]).toBe(outsideFirst);
    expect(editable.layers[outside].cels[2]).toBe(outsideFirst);
  });

  test('unlinkCels clones only selected linked images', () => {
    const shared = cel(A);
    const sprite = spriteWith([shared, shared, shared]);
    sprite.frame = 1;

    sprite.unlinkCels();

    const cels = sprite.layers[0].cels;
    expect(cels[0]).toBe(shared);
    expect(cels[2]).toBe(shared);
    expect(cels[1]).not.toBe(shared);
    expect(cels[1]!.data).not.toBe(shared.data);
    expect([...cels[1]!.data]).toEqual([...shared.data]);
    expect(sprite.linkedFrames(0, 0)).toEqual([0, 2]);
    expect(sprite.isLinked(0, 1)).toBe(false);
  });

  test('unlinkCels leaves locked layers linked', () => {
    const shared = cel(A);
    const sprite = spriteWith([shared, shared]);
    sprite.layers[0].locked = true;
    sprite.frame = 1;

    sprite.unlinkCels();

    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
  });

  test('addFrame links duplicates only on continuous layers', () => {
    const original = cel(A);
    const sprite = spriteWith([original]);
    const independent = addLayer(sprite, [original], false);

    sprite.addFrame('duplicate');

    expect(sprite.layers[0].cels[1]).toBe(original);
    expect(sprite.layers[independent].cels[1]).not.toBe(original);
    expect(sprite.layers[independent].cels[1]!.data).not.toBe(original.data);
    expect([...sprite.layers[independent].cels[1]!.data]).toEqual([...original.data]);
  });

  test('duplicateCels makes linked copies on continuous layers', () => {
    const shared = cel(A);
    const sprite = spriteWith([shared, cel(B)]);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [0, 1] };

    sprite.duplicateCels();

    expect(sprite.layers[0].cels[2]).toBe(shared);
    expect(sprite.layers[0].cels[3]).toBe(sprite.layers[0].cels[1]);
  });

  test('plain duplicateCels preserves internal links but detaches copies from originals', () => {
    const shared = cel(A);
    const other = cel(B);
    const sprite = spriteWith([shared, shared, other], false);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [0, 2] };

    sprite.duplicateCels(false);

    const cels = sprite.layers[0].cels;
    expect(cels[0]).toBe(shared);
    expect(cels[1]).toBe(shared);
    expect(cels[2]).toBe(other);
    expect(cels[3]).not.toBe(shared);
    expect(cels[4]).toBe(cels[3]);
    expect(cels[5]).not.toBe(other);
    expect(cels[3]!.data).not.toBe(shared.data);
    expect(cels[5]!.data).not.toBe(other.data);
  });

  test('nudgeCels moves a linked image once and keeps its links', () => {
    const shared = cel(A);
    const unrelated = cel(B, 1, 1);
    const sprite = spriteWith([shared, shared, unrelated]);
    sprite.range = { type: 'cels', layers: [0, 0], frames: [0, 1] };

    sprite.nudgeCels(2, 3);

    const moved = sprite.layers[0].cels[0]!;
    expect(sprite.layers[0].cels[1]).toBe(moved);
    expect(moved.x).toBe(2);
    expect(moved.y).toBe(3);
    expect(moved.data).toBe(shared.data);
    expect(sprite.layers[0].cels[2]).toBe(unrelated);
  });

  test('cel metadata changes propagate to every linked frame', () => {
    const shared = cel(A);
    const unrelated = cel(B);
    const sprite = spriteWith([shared, shared, unrelated]);

    expect(sprite.setExtData({ kind: 'cel', layer: 0, frame: 1 }, 'example', { value: 42 })).toBe(true);

    const changed = sprite.layers[0].cels[0]!;
    expect(sprite.layers[0].cels[1]).toBe(changed);
    expect(changed.ext).toEqual({ example: { value: 42 } });
    expect(sprite.layers[0].cels[2]).toBe(unrelated);
    expect(unrelated.ext).toBeUndefined();
  });

  test('recolor maps each shared image once and preserves link identity', () => {
    const shared = cel(A);
    const unrelated = cel(C);
    const sprite = spriteWith([shared, shared, unrelated]);

    sprite.recolor(new Map([[A, B]]));

    const changed = sprite.layers[0].cels[0]!;
    expect(sprite.layers[0].cels[1]).toBe(changed);
    expect([...changed.data]).toEqual([B]);
    expect([...shared.data]).toEqual([A]);
    expect([...sprite.layers[0].cels[2]!.data]).toEqual([C]);
  });

  test('JSON round-trip restores valid links and independent images', () => {
    const shared = cel(A);
    const independent = cel(B);
    const sprite = spriteWith([shared, shared, independent, null]);

    const json = sprite.toJSON();
    expect(json.layers[0].cels[1]).toEqual({ link: 0 });

    const loaded = new Sprite();
    loaded.load(JSON.parse(JSON.stringify(json)));
    const cels = loaded.layers[0].cels;
    expect(cels[0]).toBe(cels[1]);
    expect(cels[0]).not.toBe(shared);
    expect(cels[0]!.data).not.toBe(shared.data);
    expect([...cels[0]!.data]).toEqual([A]);
    expect(cels[2]).not.toBe(cels[0]);
    expect([...cels[2]!.data]).toEqual([B]);
    expect(cels[3]).toBeNull();
    expect(loaded.linkedFrames(0, 1)).toEqual([0, 1]);
    expect(loaded.isLinked(0, 2)).toBe(false);
  });
});
