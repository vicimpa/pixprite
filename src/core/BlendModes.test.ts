import { beforeAll, describe, expect, mock, test } from 'bun:test';
import type { BlendMode, Layer } from '~/core/Sprite';
import { packRgba, unpackRgba } from '~/core/Image';
import { canvasPixels, installSoftwareCanvas } from '~/core/Canvas.test-helper';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { BLEND_MODES, Sprite } = await import('~/core/Sprite');

beforeAll(installSoftwareCanvas);

type Rgb = [number, number, number];

const layer = (rgb: Rgb, blend: BlendMode = 'source-over', opacity = 1, celOpacity = 1): Layer => ({
  name: 'Layer',
  visible: true,
  locked: false,
  background: false,
  continuous: true,
  opacity,
  blend,
  cels: [{ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([packRgba(...rgb, 255)]) }],
  celOpacity: [celOpacity],
  group: false,
  depth: 0,
  collapsed: false,
  tileset: -1,
});

const render = (mode: BlendMode, backdrop: Rgb, source: Rgb, opacity = 1, celOpacity = 1) => {
  const sprite = new Sprite(1, 1);
  sprite.layers = [
    layer(backdrop),
    layer(source, mode, opacity, celOpacity),
  ];
  return unpackRgba(canvasPixels(sprite.render())[0]);
};

const separableCases: [BlendMode, number][] = [
  ['source-over', 192],
  ['multiply', 48],
  ['screen', 208],
  ['overlay', 96],
  ['darken', 64],
  ['lighten', 192],
  ['color-dodge', 255],
  ['color-burn', 1],
  ['hard-light', 161],
  ['soft-light', 96],
  ['difference', 128],
  ['exclusion', 160],
];

describe('Blend modes', () => {
  test('covers every mode exposed by the document model', () => {
    const covered: BlendMode[] = [
      ...separableCases.map(([mode]) => mode),
      'hue', 'saturation', 'color', 'luminosity',
    ];
    expect(new Set(covered)).toEqual(new Set(BLEND_MODES));
  });

  for (const [mode, expected] of separableCases) {
    test(`${mode} uses the expected color formula`, () => {
      expect(render(mode, [64, 64, 64], [192, 192, 192])).toEqual([expected, expected, expected, 255]);
    });
  }

  test('hue takes source hue while retaining backdrop luminosity', () => {
    expect(render('hue', [0, 0, 255], [255, 0, 0])).toEqual([94, 0, 0, 255]);
  });

  test('saturation takes source saturation while retaining backdrop luminosity', () => {
    expect(render('saturation', [255, 0, 0], [100, 100, 100])).toEqual([77, 77, 77, 255]);
  });

  test('color takes source hue and saturation with backdrop luminosity', () => {
    expect(render('color', [100, 100, 100], [255, 0, 0])).toEqual([255, 34, 34, 255]);
  });

  test('luminosity takes source luminosity while retaining backdrop color', () => {
    expect(render('luminosity', [255, 0, 0], [100, 100, 100])).toEqual([255, 34, 34, 255]);
  });

  test('layer and cel opacity multiply before source-over compositing', () => {
    expect(render('source-over', [0, 0, 255], [255, 0, 0], 0.5, 0.5)).toEqual([64, 0, 191, 255]);
  });

  test('group blend applies after compositing its children', () => {
    const sprite = new Sprite(1, 1);
    const child = layer([192, 192, 192]);
    child.depth = 1;
    const group = layer([0, 0, 0], 'multiply');
    group.group = true;
    group.cels = [null];
    sprite.layers = [layer([64, 64, 64]), child, group];

    expect(unpackRgba(canvasPixels(sprite.render())[0])).toEqual([48, 48, 48, 255]);
  });
});
