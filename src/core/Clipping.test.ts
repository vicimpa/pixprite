import { beforeAll, describe, expect, mock, test } from 'bun:test';
import type { Layer, Sprite as SpriteModel } from '~/core/Sprite';
import { packRgba } from '~/core/Image';
import { canvasPixels, installSoftwareCanvas } from '~/core/Canvas.test-helper';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite } = await import('~/core/Sprite');

beforeAll(installSoftwareCanvas);

const RED = packRgba(255, 0, 0, 255);
const GREEN = packRgba(0, 255, 0, 255);
const BLUE = packRgba(0, 0, 255, 255);

const layer = (data: number[] | null, clip = false, depth = 0, group = false): Layer => ({
  name: group ? 'Group' : clip ? 'Clip' : 'Layer',
  visible: true,
  locked: false,
  background: false,
  continuous: true,
  opacity: 1,
  blend: 'source-over',
  cels: [data ? { x: 0, y: 0, w: 3, h: 1, data: new Uint32Array(data) } : null],
  celOpacity: [1],
  group,
  depth,
  collapsed: false,
  tileset: -1,
  ...(clip ? { clip: true } : {}),
});

const spriteWith = (layers: Layer[]) => {
  const sprite = new Sprite(3, 1);
  sprite.layers = layers;
  return sprite;
};

const pixels = (sprite: SpriteModel) => [...canvasPixels(sprite.render())];

describe('Clipping layers', () => {
  test('shows clipping pixels only where the base has alpha', () => {
    const sprite = spriteWith([
      layer([RED, 0, RED]),
      layer([GREEN, GREEN, GREEN], true),
    ]);

    expect(pixels(sprite)).toEqual([GREEN, 0, GREEN]);
  });

  test('applies a run of clipping layers to the same base', () => {
    const sprite = spriteWith([
      layer([RED, RED, 0]),
      layer([GREEN, GREEN, GREEN], true),
      layer([BLUE, BLUE, BLUE], true),
    ]);

    expect(pixels(sprite)).toEqual([BLUE, BLUE, 0]);
  });

  test('hides clipping layers when their base is hidden', () => {
    const sprite = spriteWith([
      layer([RED, RED, RED]),
      layer([GREEN, GREEN, GREEN], true),
    ]);
    sprite.layers[0].visible = false;

    expect(pixels(sprite)).toEqual([0, 0, 0]);
  });

  test('skips a hidden clipping layer without hiding its base', () => {
    const sprite = spriteWith([
      layer([RED, RED, RED]),
      layer([GREEN, GREEN, GREEN], true),
    ]);
    sprite.layers[1].visible = false;

    expect(pixels(sprite)).toEqual([RED, RED, RED]);
  });

  test('draws a leading clipping layer plainly when it has no base', () => {
    const sprite = spriteWith([layer([GREEN, GREEN, GREEN], true)]);
    expect(pixels(sprite)).toEqual([GREEN, GREEN, GREEN]);
  });

  test('uses the nearest base inside a group instead of an outside layer', () => {
    const sprite = spriteWith([
      layer([BLUE, BLUE, BLUE]),
      layer([RED, 0, RED], false, 1),
      layer([GREEN, GREEN, GREEN], true, 1),
      layer(null, false, 0, true),
    ]);

    expect(pixels(sprite)).toEqual([GREEN, BLUE, GREEN]);
  });

  test('can clip a whole group to the root base below it', () => {
    const group = layer(null, true, 0, true);
    const sprite = spriteWith([
      layer([RED, 0, RED]),
      layer([GREEN, GREEN, GREEN], false, 1),
      group,
    ]);

    expect(pixels(sprite)).toEqual([GREEN, 0, GREEN]);
  });

  test('single-layer rendering does not require its clipping base', () => {
    const sprite = spriteWith([
      layer([RED, 0, RED]),
      layer([GREEN, GREEN, GREEN], true),
    ]);

    expect([...canvasPixels(sprite.render(0, 1))]).toEqual([GREEN, GREEN, GREEN]);
  });

  test('restricts merges that would lose a clipping base', () => {
    const sprite = spriteWith([
      layer([RED, RED, RED], true),
      layer([GREEN, GREEN, GREEN]),
    ]);
    sprite.layer = 1;
    sprite.range = { type: 'layers', layers: [0, 1], frames: [0, 0] };

    expect(sprite.canMergeDown).toBe(false);
    expect(sprite.rangeNodes).toBeNull();

    sprite.layers[0].clip = false;
    expect(sprite.canMergeDown).toBe(true);
    expect(sprite.rangeNodes).toEqual([0, 1]);

    sprite.layers[0].clip = true;
    sprite.layers[1].clip = true;
    expect(sprite.canMergeDown).toBe(true);
    expect(sprite.rangeNodes).toEqual([0, 1]);
  });

  test('document round-trip preserves clipping flags and rendered pixels', () => {
    const sprite = spriteWith([
      layer([RED, 0, RED]),
      layer([GREEN, GREEN, GREEN], true),
    ]);

    const loaded = new Sprite();
    loaded.load(JSON.parse(JSON.stringify(sprite.toJSON())));

    expect(loaded.layers[0].clip).toBeUndefined();
    expect(loaded.layers[1].clip).toBe(true);
    expect(pixels(loaded)).toEqual([GREEN, 0, GREEN]);
  });
});
