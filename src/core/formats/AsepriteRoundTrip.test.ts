import { describe, expect, test } from 'bun:test';
import { packRgba } from '~/core/Image';
import { FLIP_X, renderTiles, type Tileset } from '~/core/Tilemap';
import { decodeAseprite, encodeAseprite, type AseDocument, type AseLayer } from '~/core/formats/Aseprite';

const RED = packRgba(255, 0, 0, 255);
const GREEN = packRgba(0, 255, 0, 255);
const BLUE = packRgba(0, 0, 255, 255);
const ALPHA = packRgba(255, 255, 255, 128);

const layer = (name: string, frames = 3): AseLayer => ({
  name,
  visible: true,
  locked: false,
  background: false,
  continuous: true,
  opacity: 1,
  blend: 'source-over',
  cels: Array(frames).fill(null),
  celOpacity: Array(frames).fill(1),
  depth: 0,
  tileset: -1,
});

const richDocument = (): AseDocument => {
  const base = layer('Base');
  base.continuous = false;
  base.celOpacity = [0.5, 0.75, 1];
  const shared = { x: -1, y: 1, w: 2, h: 2, data: new Uint32Array([RED, GREEN, BLUE, ALPHA]) };
  base.cels = [shared, shared, null];
  base.userData = { text: 'Bottom', color: '#112233' };

  const child = layer('Child');
  child.depth = 1;
  child.clip = true;
  child.opacity = 0.8;
  child.blend = 'multiply';
  child.cels[0] = { x: 2, y: -1, w: 1, h: 2, data: new Uint32Array([GREEN, BLUE]) };
  child.cels[2] = { x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) };
  child.userData = { text: 'Clipped', color: '#445566' };

  const group = layer('Group');
  group.group = true;
  group.collapsed = true;
  group.opacity = 0.6;
  group.blend = 'screen';

  const tileset: Tileset = {
    name: 'Terrain', tw: 2, th: 2, baseIndex: 1,
    tiles: [
      new Uint32Array(4),
      new Uint32Array([RED, RED, GREEN, GREEN]),
      new Uint32Array([BLUE, ALPHA, ALPHA, BLUE]),
    ],
    userData: { text: 'Tiles', color: '#abcdef' },
  };
  const tiles = { cols: 2, rows: 1, refs: new Uint32Array([1, (2 | FLIP_X) >>> 0]) };
  const tilemap = layer('Tilemap');
  tilemap.tileset = 0;
  const tileCel = { x: 0, y: 0, w: 4, h: 2, tiles, data: renderTiles(tileset, tiles) };
  tilemap.cels = [tileCel, tileCel, null];

  return {
    width: 4,
    height: 3,
    frames: [{ duration: 80 }, { duration: 120 }, { duration: 250 }],
    layers: [base, child, group, tilemap],
    tags: [{
      name: 'Walk', from: 0, to: 2, color: '#ff0000', direction: 'pingpong', repeat: 3,
      userData: { text: 'Cycle', color: '#00ff00' },
    }],
    palette: ['#000000', '#ff0000'],
    framePalettes: [
      { frame: 0, colors: ['#000000', '#ff0000'] },
      { frame: 2, colors: ['#000000', '#00ff00', '#0000ff'] },
    ],
    slices: [{
      name: 'Hitbox', color: '#00ffff',
      keys: [
        { frame: 0, x: -1, y: 1, w: 3, h: 2, center: { x: 1, y: 0, w: 1, h: 1 }, pivot: { x: 1, y: 2 } },
        { frame: 2, x: 1, y: -1, w: 2, h: 4, center: { x: 0, y: 1, w: 1, h: 2 }, pivot: { x: 0, y: 0 } },
      ],
      userData: { text: 'Gameplay' },
    }],
    tilesets: [tileset],
    colorMode: 'rgb',
    transparentIndex: -1,
  };
};

describe('.aseprite round-trip', () => {
  // Optional network check against fixtures authored by Aseprite, independent of our encoder.
  // Fetch instead of redistributing upstream assets; see docs/aseprite-compatibility.md.
  const upstreamTest = process.env.PIXPRITE_ASEPRITE_COMPAT === '1' ? test : test.skip;
  upstreamTest('imports pinned original Aseprite fixtures and preserves their supported data', async () => {
    const revision = '3669f4774d181d77deb3e6db95fe6df8ca347410';
    const load = async (name: string) => {
      const response = await fetch(`https://raw.githubusercontent.com/aseprite/aseprite/${revision}/tests/sprites/${name}.aseprite`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Aseprite fixture ${name}: HTTP ${response.status}`);
      return decodeAseprite(new Uint8Array(await response.arrayBuffer()));
    };

    const tags = await load('tags3');
    expect([tags.width, tags.height, tags.frames.length]).toEqual([4, 4, 12]);
    expect(tags.layers.map(l => l.name)).toEqual(['a', 'b', 'c']);
    expect(tags.tags.map(t => [t.name, t.from, t.to, t.direction])).toEqual([
      ['forward', 0, 3, 'forward'], ['reverse', 4, 7, 'reverse'], ['pingpong', 8, 11, 'pingpong'],
    ]);
    expect(tags.layers[0].cels[1]).toBe(tags.layers[0].cels[0]);
    expect([...tags.layers[0].cels[0]!.data]).toEqual([0, 0xff8a4276, 0xff8a4276, 0, 0xff8a4276, 0xff8a4276, 0xff8a4276, 0xff8a4276]);
    expect(tags.layers[2].cels[2]).toBeNull();

    const groups = await load('groups2');
    expect([groups.width, groups.height, groups.colorMode]).toEqual([8, 8, 'indexed']);
    expect(groups.layers.map(l => [l.name, l.depth, l.group, l.visible])).toEqual([
      ['body', 1, false, true], ['head', 1, false, true], ['player', 0, true, true],
      ['sword', 1, false, true], ['gun', 1, false, false], ['items', 0, true, true],
    ]);
    expect(groups.layers.filter(l => l.group).map(l => l.opacity)).toEqual([1, 1]);

    const tilemap = await load('2x2tilemap2x2tile');
    expect([tilemap.width, tilemap.height]).toEqual([6, 6]);
    expect(tilemap.tilesets![0].tiles).toHaveLength(5);
    expect([...tilemap.layers[0].cels[0]!.tiles!.refs]).toEqual([1, 2, 4, 3]);
    for (const document of [tags, groups, tilemap])
      expect(await decodeAseprite(await encodeAseprite(document))).toEqual(document);
  }, 60000);

  test('RGB document remains stable through binary save → load → save', async () => {
    const original = richDocument();
    const firstBytes = await encodeAseprite(original);
    const first = await decodeAseprite(firstBytes);
    const secondBytes = await encodeAseprite(first);
    const second = await decodeAseprite(secondBytes);

    expect(secondBytes).toEqual(firstBytes);
    expect(second).toEqual(first);

    expect([first.width, first.height]).toEqual([4, 3]);
    expect(first.frames).toEqual(original.frames);
    expect(first.tags).toEqual([{ ...original.tags[0], userData: { text: 'Cycle' } }]);
    expect(first.slices).toEqual(original.slices);
    expect(first.palette).toEqual(original.palette);
    expect(first.framePalettes).toEqual(original.framePalettes);
    expect(first.colorMode).toBe('rgb');

    const base = first.layers[0];
    expect(base.cels[0]).toBe(base.cels[1]);
    expect(base.cels[0]).toMatchObject({ x: -1, y: 1, w: 2, h: 2 });
    expect([...base.cels[0]!.data]).toEqual([RED, GREEN, BLUE, ALPHA]);
    expect(base.cels[2]).toBeNull();
    expect(base.celOpacity).toEqual([128 / 255, 191 / 255, 1]);
    expect(base.userData).toEqual(original.layers[0].userData);

    expect(first.layers[1]).toMatchObject({ depth: 1, clip: true, blend: 'multiply' });
    expect(first.layers[1].opacity).toBe(204 / 255);
    expect(first.layers[1].userData).toEqual(original.layers[1].userData);
    expect(first.layers[2]).toMatchObject({ group: true, collapsed: true, blend: 'screen', depth: 0 });
    expect(first.layers[2].opacity).toBe(153 / 255);

    expect(first.tilesets).toHaveLength(1);
    expect(first.tilesets![0].name).toBe('Terrain');
    expect(first.tilesets![0].userData).toEqual(original.tilesets![0].userData);
    first.tilesets![0].tiles.forEach((tile, i) => expect([...tile]).toEqual([...original.tilesets![0].tiles[i]]));
    const loadedTiles = first.layers[3].cels[0]!;
    expect(first.layers[3].cels[1]).toBe(loadedTiles);
    expect(loadedTiles.tiles).toEqual(original.layers[3].cels[0]!.tiles);
    expect([...loadedTiles.data]).toEqual([...original.layers[3].cels[0]!.data]);
  });

  test('grayscale preserves intensity and alpha', async () => {
    const gray = packRgba(120, 120, 120, 128);
    const document: AseDocument = {
      width: 1, height: 1,
      frames: [{ duration: 100 }],
      layers: [{ ...layer('Gray', 1), cels: [{ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([gray]) }] }],
      tags: [], palette: [], colorMode: 'gray',
    };

    const bytes = await encodeAseprite(document);
    const loaded = await decodeAseprite(bytes);
    const secondBytes = await encodeAseprite(loaded);

    expect(secondBytes).toEqual(bytes);
    expect(loaded.colorMode).toBe('gray');
    expect(loaded.layers[0].cels[0]!.data[0]).toBe(gray);
  });

  test('indexed pixels, palette and transparent index survive a second save', async () => {
    const document: AseDocument = {
      width: 3, height: 1,
      frames: [{ duration: 100 }],
      layers: [{ ...layer('Indexed', 1), cels: [{ x: 0, y: 0, w: 3, h: 1, data: new Uint32Array([RED, 0, GREEN]) }] }],
      tags: [],
      palette: ['#00000000', '#ff0000', '#00ff00'],
      colorMode: 'indexed',
      transparentIndex: 0,
    };

    const bytes = await encodeAseprite(document);
    const loaded = await decodeAseprite(bytes);
    const secondBytes = await encodeAseprite(loaded);

    expect(secondBytes).toEqual(bytes);
    expect(loaded.colorMode).toBe('indexed');
    expect(loaded.palette).toEqual(document.palette);
    expect(loaded.transparentIndex).toBe(0);
    expect([...loaded.layers[0].cels[0]!.data]).toEqual([RED, 0, GREEN]);
  });
});
