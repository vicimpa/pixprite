import { describe, expect, mock, test } from 'bun:test';
import type { CelImage, Layer, Sprite as SpriteModel } from '~/core/Sprite';
import type { Tileset } from '~/core/Tilemap';
import { packRgba } from '~/core/Image';
import { FLIP_X, renderTiles } from '~/core/Tilemap';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite } = await import('~/core/Sprite');

const RED = packRgba(255, 0, 0, 255);
const GREEN = packRgba(0, 255, 0, 255);
const BLUE = packRgba(0, 0, 255, 255);
const ALPHA = packRgba(255, 255, 255, 128);

const layer = (name: string, depth = 0): Layer => ({
  name,
  visible: true,
  locked: false,
  background: false,
  continuous: true,
  opacity: 1,
  blend: 'source-over',
  cels: Array(3).fill(null),
  celOpacity: Array(3).fill(1),
  group: false,
  depth,
  collapsed: false,
  tileset: -1,
});

const createDocument = () => {
  const sprite = new Sprite(4, 3);
  sprite.name = 'Round trip';
  sprite.info = {
    description: 'Fixture with all document resources',
    tags: ['test', 'round-trip'],
    genre: 'example',
    author: 'Pixprite',
  };
  sprite.frames = [
    { duration: 80 },
    { duration: 120, ext: { timing: { source: 'manual' } } },
    { duration: 250 },
  ];
  sprite.tags = [{
    name: 'Walk', from: 0, to: 2, color: '#ff0000', direction: 'pingpong', repeat: 3,
    userData: { text: 'Main cycle', color: '#00ff00' },
    ext: { rig: { role: 'body' } },
  }];
  sprite.slices = [{
    name: 'Hitbox', color: '#00ffff',
    keys: [
      { frame: 0, x: -1, y: 1, w: 3, h: 2, center: { x: 1, y: 0, w: 1, h: 1 }, pivot: { x: 1, y: 2 } },
      { frame: 2, x: 1, y: -1, w: 2, h: 4 },
    ],
    userData: { text: 'Gameplay', color: '#ff00ff' },
    ext: { physics: { kind: 'hurtbox' } },
  }];
  sprite.guides = [{ axis: 'x', pos: -2 }, { axis: 'y', pos: 5 }];
  sprite.loop = [0, 2];
  sprite.framePalettes = [
    { frame: 0, colors: ['#000000', '#ff0000'] },
    { frame: 2, colors: ['#000000', '#00ff00', '#0000ff'] },
  ];
  sprite.colorMode = 'rgb';
  sprite.transparentIndex = -1;
  sprite.ext = { project: { id: 'fixture', nested: [1, true, null] } };

  const shared: CelImage = {
    x: -1, y: 1, w: 2, h: 2,
    data: new Uint32Array([RED, GREEN, BLUE, ALPHA]),
    ext: { pixels: { label: 'shared' } },
  };
  const base = layer('Base');
  base.cels = [shared, shared, null];
  base.celOpacity = [0.5, 0.75, 1];
  base.continuous = false;
  base.userData = { text: 'Bottom layer', color: '#111111' };

  const child = layer('Clipped child', 1);
  child.clip = true;
  child.opacity = 0.8;
  child.blend = 'multiply';
  child.cels[0] = { x: 2, y: -1, w: 1, h: 2, data: new Uint32Array([GREEN, BLUE]) };
  child.cels[2] = { x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  child.ext = { effects: { outline: 1 } };

  const group = layer('Group', 0);
  group.group = true;
  group.collapsed = true;
  group.opacity = 0.6;
  group.blend = 'screen';
  group.ext = { organization: { order: 1 } };

  const tileset: Tileset = {
    name: 'Terrain', tw: 2, th: 2, baseIndex: 1,
    tiles: [
      new Uint32Array(4),
      new Uint32Array([RED, RED, GREEN, GREEN]),
      new Uint32Array([BLUE, ALPHA, ALPHA, BLUE]),
    ],
    userData: { text: 'Shared tiles', color: '#abcdef' },
  };
  const tiles = { cols: 2, rows: 1, refs: new Uint32Array([1, (2 | FLIP_X) >>> 0]) };
  const tileCel: CelImage = {
    x: 0, y: 0, w: 4, h: 2, tiles,
    data: renderTiles(tileset, tiles),
    ext: { map: { room: 'start' } },
  };
  const tilemap = layer('Tilemap');
  tilemap.tileset = 0;
  tilemap.cels = [tileCel, tileCel, null];
  sprite.tilesets = [tileset];

  const reference = layer('Reference');
  reference.reference = { src: 'data:image/png;base64,AAECAw==', x: 1, y: -2, scale: 2, angle: 90 };
  reference.opacity = 0.4;
  reference.visible = false;

  sprite.layers = [base, child, group, tilemap, reference];
  sprite.layer = 3;
  sprite.frame = 2;
  return { sprite, shared, tileCel };
};

const jsonClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const expectDocument = (loaded: SpriteModel, original: SpriteModel) => {
  expect([loaded.width, loaded.height]).toEqual([4, 3]);
  expect(loaded.frames.map(f => f.duration)).toEqual([80, 120, 250]);
  expect(loaded.frames[1].ext).toEqual({ timing: { source: 'manual' } });
  expect(loaded.tags).toEqual(original.tags);
  expect(loaded.slices).toEqual(original.slices);
  expect(loaded.guides).toEqual(original.guides);
  expect(loaded.loop).toEqual([0, 2]);
  expect(loaded.framePalettes).toEqual(original.framePalettes);
  expect(loaded.info).toEqual(original.info);
  expect(loaded.ext).toEqual(original.ext);

  const originalBase = original.layers[0];
  const base = loaded.layers[0];
  expect(base.cels[0]).toBe(base.cels[1]);
  expect(base.cels[0]).not.toBe(originalBase.cels[0]);
  expect(base.cels[0]!.data).not.toBe(originalBase.cels[0]!.data);
  expect([...base.cels[0]!.data]).toEqual([...originalBase.cels[0]!.data]);
  expect(base.cels[0]).toMatchObject({ x: -1, y: 1, w: 2, h: 2, ext: { pixels: { label: 'shared' } } });
  expect(base.cels[2]).toBeNull();
  expect(base.celOpacity).toEqual([0.5, 0.75, 1]);
  expect(loaded.linkedFrames(0, 1)).toEqual([0, 1]);

  expect(loaded.layers[1]).toMatchObject({ depth: 1, clip: true, opacity: 0.8, blend: 'multiply' });
  expect(loaded.layers[2]).toMatchObject({ group: true, collapsed: true, opacity: 0.6, blend: 'screen' });
  expect(loaded.layers[1].ext).toEqual({ effects: { outline: 1 } });

  expect(loaded.tilesets).toHaveLength(1);
  expect(loaded.tilesets[0]).toMatchObject({ name: 'Terrain', tw: 2, th: 2, baseIndex: 1 });
  expect(loaded.tilesets[0].tiles).toHaveLength(3);
  loaded.tilesets[0].tiles.forEach((tile, i) => expect([...tile]).toEqual([...original.tilesets[0].tiles[i]]));
  const loadedTileCel = loaded.layers[3].cels[0]!;
  expect(loaded.layers[3].cels[1]).toBe(loadedTileCel);
  expect(loadedTileCel.tiles).toEqual(original.layers[3].cels[0]!.tiles);
  expect([...loadedTileCel.data]).toEqual([...original.layers[3].cels[0]!.data]);
  expect(loadedTileCel.ext).toEqual({ map: { room: 'start' } });

  expect(loaded.layers[4].reference).toEqual(original.layers[4].reference);
  expect(loaded.layers[4].visible).toBe(false);
};

describe('.pixprite round-trip', () => {
  test('create → save → load → save produces the same document', () => {
    const { sprite } = createDocument();
    const first = sprite.toJSON();

    expect(first.format).toBe('pixprite');
    expect(first.version).toBe(7);

    const loaded = new Sprite();
    loaded.load(jsonClone(first));
    const second = loaded.toJSON();

    expect(second).toEqual(first);
    expectDocument(loaded, sprite);
  });

  test('a second load retains valid resource references and linked images', () => {
    const { sprite } = createDocument();
    const firstLoad = new Sprite();
    firstLoad.load(jsonClone(sprite.toJSON()));
    const secondLoad = new Sprite();
    secondLoad.load(jsonClone(firstLoad.toJSON()));

    expectDocument(secondLoad, sprite);
    expect(secondLoad.layers.every(l => l.cels.length === secondLoad.frames.length)).toBe(true);
    expect(secondLoad.layers.every(l => l.celOpacity.length === secondLoad.frames.length)).toBe(true);
    expect(secondLoad.layers[3].tileset).toBe(0);
    expect(secondLoad.tilesets[secondLoad.layers[3].tileset]).toBeDefined();
  });

  test('editing a loaded linked cel does not mutate the original document', () => {
    const { sprite, shared } = createDocument();
    const first = sprite.toJSON();
    const loaded = new Sprite();
    loaded.load(jsonClone(first));
    const replacement: CelImage = { x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([BLUE]) };

    loaded.setCel(replacement, 0, 1);

    expect(loaded.layers[0].cels[0]).toBe(replacement);
    expect(loaded.layers[0].cels[1]).toBe(replacement);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect([...shared.data]).toEqual([RED, GREEN, BLUE, ALPHA]);
    expect(sprite.toJSON()).toEqual(first);
  });
});
