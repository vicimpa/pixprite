import { describe, expect, mock, test } from 'bun:test';
import type { Cel, CelImage, Sprite as SpriteModel } from '~/core/Sprite';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite } = await import('~/core/Sprite');

const A = 0xff000001;
const B = 0xff000002;

const cel = (value = A): CelImage => ({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([value]) });

const spriteWith = (cels: Cel[]) => {
  const sprite = new Sprite(1, 1);
  sprite.frames = cels.map(() => ({ duration: 100 }));
  sprite.layers[0].cels = cels;
  sprite.layers[0].celOpacity = cels.map(() => 1);
  return sprite;
};

const pixels = (sprite: SpriteModel) => sprite.layers[0].cels.map(c => c?.data[0] ?? 0);

describe('Frame palettes', () => {
  test('adds sorted palette keys and selects the latest key at each frame', () => {
    const sprite = spriteWith([cel(), cel(), cel(), cel()]);
    const colors = ['#111111'];
    sprite.frame = 2;
    sprite.addFramePalette(colors);
    colors.push('#222222');

    sprite.frame = 1;
    sprite.addFramePalette(['#333333']);

    expect(sprite.framePalettes).toEqual([
      { frame: 0, colors: ['#111111'] },
      { frame: 1, colors: ['#333333'] },
      { frame: 2, colors: ['#111111'] },
    ]);
    expect(sprite.framePalettes[0].colors).not.toBe(colors);
    expect(sprite.framePaletteAt(0)).toBe(sprite.framePalettes[0]);
    expect(sprite.framePaletteAt(1)).toBe(sprite.framePalettes[1]);
    expect(sprite.framePaletteAt(2)).toBe(sprite.framePalettes[2]);
    expect(sprite.framePaletteAt(3)).toBe(sprite.framePalettes[2]);
  });

  test('computes the exact frames governed by each palette key', () => {
    const sprite = spriteWith([cel(), cel(), cel(), cel(), cel()]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000'] },
      { frame: 2, colors: ['#111111'] },
      { frame: 4, colors: ['#222222'] },
    ];

    expect([...sprite.framesOfPalette(sprite.framePalettes[0])]).toEqual([0, 1]);
    expect([...sprite.framesOfPalette(sprite.framePalettes[1])]).toEqual([2, 3]);
    expect([...sprite.framesOfPalette(sprite.framePalettes[2])]).toEqual([4]);
  });

  test('does not add a duplicate key or share the input color array', () => {
    const sprite = spriteWith([cel(), cel()]);
    const colors = ['#123456'];
    sprite.addFramePalette(colors);
    const before = sprite.framePalettes;
    const version = sprite.version;

    sprite.addFramePalette(['#abcdef']);

    expect(sprite.framePalettes).toBe(before);
    expect(sprite.version).toBe(version);
    expect(sprite.framePalettes).toEqual([{ frame: 0, colors: ['#123456'] }]);
    expect(sprite.framePalettes[0].colors).not.toBe(colors);
  });

  test('removing a key falls back to the previous palette', () => {
    const sprite = spriteWith([cel(), cel(), cel()]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000'] },
      { frame: 1, colors: ['#111111'] },
      { frame: 2, colors: ['#222222'] },
    ];
    const first = sprite.framePalettes[0];
    const last = sprite.framePalettes[2];
    sprite.frame = 1;

    sprite.removeFramePalette();

    expect(sprite.framePalettes).toEqual([first, last]);
    expect(sprite.framePaletteAt(1)).toBe(first);
    expect(sprite.framePaletteAt(2)).toBe(last);
  });

  test('removing the last keyed palette collapses to one global palette', () => {
    const sprite = spriteWith([cel(), cel()]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000'] },
      { frame: 1, colors: ['#111111'] },
    ];
    sprite.frame = 1;

    sprite.removeFramePalette();

    expect(sprite.framePalettes).toEqual([]);
    expect(sprite.framePaletteAt(0)).toBeNull();
    expect(sprite.framePaletteAt(1)).toBeNull();
  });

  test('recolor changes only frames governed by the selected palette', () => {
    const originals = [cel(), cel(), cel(), cel()];
    const sprite = spriteWith(originals.slice());
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000'] },
      { frame: 2, colors: ['#111111'] },
    ];
    const frames = sprite.framesOfPalette(sprite.framePalettes[1]);

    sprite.recolor(new Map([[A, B]]), frames);

    expect(pixels(sprite)).toEqual([A, A, B, B]);
    expect(sprite.layers[0].cels[0]).toBe(originals[0]);
    expect(sprite.layers[0].cels[1]).toBe(originals[1]);
    expect(sprite.layers[0].cels[2]).not.toBe(originals[2]);
    expect(sprite.layers[0].cels[3]).not.toBe(originals[3]);
    expect(originals.map(c => c!.data[0])).toEqual([A, A, A, A]);
  });

  test('recolor splits a linked cel at a palette boundary without mutating either image', () => {
    const shared = cel();
    const sprite = spriteWith([shared, shared, shared]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000'] },
      { frame: 2, colors: ['#111111'] },
    ];

    sprite.recolor(new Map([[A, B]]), sprite.framesOfPalette(sprite.framePalettes[1]));

    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[0].cels[2]).not.toBe(shared);
    expect(pixels(sprite)).toEqual([A, A, B]);
    expect([...shared.data]).toEqual([A]);
    expect(sprite.linkedFrames(0, 0)).toEqual([0, 1]);
    expect(sprite.isLinked(0, 2)).toBe(false);
  });

  test('recolor keeps links between frames inside the same palette range', () => {
    const shared = cel();
    const sprite = spriteWith([shared, shared, shared]);

    sprite.recolor(new Map([[A, B]]), new Set([1, 2]));

    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(sprite.layers[0].cels[2]);
    expect(sprite.layers[0].cels[1]).not.toBe(shared);
    expect(pixels(sprite)).toEqual([A, B, B]);
    expect(sprite.linkedFrames(0, 1)).toEqual([1, 2]);
  });

  test('JSON round-trip preserves all palette keys and their colors', () => {
    const sprite = spriteWith([cel(), cel(), cel()]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#000000', '#ffffff'] },
      { frame: 2, colors: ['#123456', '#abcdef'] },
    ];

    const loaded = new Sprite();
    loaded.load(JSON.parse(JSON.stringify(sprite.toJSON())));

    expect(loaded.framePalettes).toEqual(sprite.framePalettes);
    expect(loaded.framePaletteAt(1)?.colors).toEqual(['#000000', '#ffffff']);
    expect(loaded.framePaletteAt(2)?.colors).toEqual(['#123456', '#abcdef']);
    expect([...loaded.framesOfPalette(loaded.framePalettes[0])]).toEqual([0, 1]);
  });

  test('document conversion retains keyed palettes and exposes the base palette', () => {
    const sprite = spriteWith([cel(), cel()]);
    sprite.framePalettes = [
      { frame: 0, colors: ['#010203'] },
      { frame: 1, colors: ['#040506'] },
    ];

    const document = sprite.toDocument();
    const loaded = new Sprite();
    loaded.fromDocument(document);

    expect(document.palette).toEqual(['#010203']);
    expect(loaded.framePalettes).toEqual(sprite.framePalettes);
    expect(loaded.framePaletteAt(1)?.colors).toEqual(['#040506']);
  });
});
