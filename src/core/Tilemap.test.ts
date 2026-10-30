import { describe, expect, test } from 'bun:test';
import {
  FLIP_D, FLIP_X, FLIP_Y, alignToTiles, composeFlags, cutTile, findTile,
  findTileFlipped, flagsOf, isEmptyTile, mapCsv, mapGrid, mapJson, newTileset,
  renderTiles, rotateRef, sameTile, tileImage, tileIndex, tileKey, tileOf,
  tileUsage, tileVariants, tilesFromImage, tilesetImage, transformTile,
  type Tileset,
} from '~/core/Tilemap';

const A = 0xff000001;
const B = 0xff000002;
const C = 0xff000003;
const D = 0xff000004;
const probe = new Uint32Array([A, B, C, D]);
const tileset = (): Tileset => ({
  name: 'Test', tw: 2, th: 2, baseIndex: 1,
  tiles: [new Uint32Array(4), probe.slice(), new Uint32Array([D, C, B, A])],
});

describe('Tilemap', () => {
  test('separates tile indices from flip flags', () => {
    const ref = (7 | FLIP_X | FLIP_Y | FLIP_D) >>> 0;
    expect(tileOf(ref)).toBe(7);
    expect(flagsOf(ref)).toBe((FLIP_X | FLIP_Y | FLIP_D) >>> 0);
  });

  test('transforms tiles and supports inverse transforms', () => {
    expect([...transformTile(probe, 2, 2, FLIP_X)]).toEqual([B, A, D, C]);
    expect([...transformTile(probe, 2, 2, FLIP_Y)]).toEqual([C, D, A, B]);
    expect([...transformTile(probe, 2, 2, FLIP_D)]).toEqual([A, C, B, D]);
    expect(transformTile(probe, 2, 2, 0)).toBe(probe);

    for (const flags of tileVariants(tileset())) {
      const transformed = transformTile(probe, 2, 2, flags);
      expect([...transformTile(transformed, 2, 2, flags, true)]).toEqual([...probe]);
    }
  });

  test('ignores diagonal flips for rectangular tiles', () => {
    const rectangular = new Uint32Array([A, B, C, D, 5, 6]);
    expect([...transformTile(rectangular, 3, 2, FLIP_D)]).toEqual([...rectangular]);
    expect(tileVariants({ ...tileset(), tw: 3 }).length).toBe(4);
    expect(tileVariants(tileset()).length).toBe(8);
  });

  test('resolves tile images and transparent missing references', () => {
    const ts = tileset();
    expect([...tileImage(ts, (1 | FLIP_X) >>> 0)]).toEqual([B, A, D, C]);
    expect([...tileImage(ts, 99)]).toEqual([0, 0, 0, 0]);
  });

  test('rotates references four times back to the original', () => {
    for (const flags of tileVariants(tileset())) {
      const original = (1 | flags) >>> 0;
      let ref = original;
      ref = rotateRef(ref);
      ref = rotateRef(ref);
      ref = rotateRef(ref);
      ref = rotateRef(ref);
      expect(ref).toBe(original);
    }
  });

  test('creates a tileset with an empty tile zero', () => {
    const ts = newTileset(3, 2, 'Terrain');
    expect(ts).toEqual({
      name: 'Terrain', tw: 3, th: 2,
      tiles: [new Uint32Array(6)], baseIndex: 1,
    });
  });

  test('compares visible pixels while ignoring hidden transparent colors', () => {
    const transparentA = new Uint32Array([0x00112233, A]);
    const transparentB = new Uint32Array([0x00abcdef, A]);
    expect(sameTile(transparentA, transparentB)).toBe(true);
    expect(tileKey(transparentA)).toBe(tileKey(transparentB));
    expect(isEmptyTile(new Uint32Array([0x00112233]))).toBe(true);
    expect(isEmptyTile(transparentA)).toBe(false);
    expect(sameTile(transparentA, new Uint32Array([0, B]))).toBe(false);
  });

  test('renders tile references into a pixel buffer', () => {
    const ts: Tileset = { name: '', tw: 2, th: 1, baseIndex: 1, tiles: [
      new Uint32Array(2), new Uint32Array([A, B]), new Uint32Array([C, D]),
    ] };
    const result = renderTiles(ts, {
      cols: 2, rows: 2,
      refs: new Uint32Array([(1 | FLIP_X) >>> 0, 2, 0, 99]),
    });
    expect([...result]).toEqual([B, A, C, D, 0, 0, 0, 0]);
  });

  test('cuts partial tiles and aligns rectangles to the tile grid', () => {
    const ts = tileset();
    const data = new Uint32Array([A, B, C, D, 5, 6]);
    expect([...cutTile(ts, data, { x: 0, y: 0, w: 3, h: 2 }, 1, 0)]).toEqual([C, 0, 6, 0]);
    expect(alignToTiles(ts, { x: 1, y: 2, w: 3, h: 2 })).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    expect(alignToTiles(ts, { x: 2, y: 2, w: 0, h: 0 })).toEqual({ x: 2, y: 2, w: 2, h: 2 });
  });

  test('finds exact, flipped and missing tiles', () => {
    const ts = tileset();
    expect(findTile(ts, probe)).toBe(1);
    expect(findTile(ts, new Uint32Array(4))).toBe(0);
    expect(findTile(ts, new Uint32Array([0xff000005, 0xff000006, 0xff000007, 0xff000008]))).toBe(-1);
    expect(findTileFlipped(ts, transformTile(probe, 2, 2, FLIP_X))).toBe((1 | FLIP_X) >>> 0);
    expect(findTileFlipped(ts, new Uint32Array(4))).toBe(0);
    expect(findTileFlipped(ts, new Uint32Array([0xff000005, 0xff000006, 0xff000007, 0xff000008]))).toBe(-1);
  });

  test('composes every square-tile flag combination', () => {
    const ts = tileset();
    for (const f of tileVariants(ts)) {
      for (const g of tileVariants(ts)) {
        const composed = composeFlags(ts, f, g);
        const expected = transformTile(transformTile(probe, 2, 2, f), 2, 2, g);
        expect([...transformTile(probe, 2, 2, composed)]).toEqual([...expected]);
      }
    }
  });

  test('counts tile usage and ignores missing tile indices', () => {
    const usage = tileUsage(3, [
      { tiles: { cols: 3, rows: 1, refs: new Uint32Array([0, 1, (2 | FLIP_X) >>> 0]) } },
      { tiles: { cols: 2, rows: 1, refs: new Uint32Array([2, 3]) } },
      {},
    ]);
    expect(usage).toEqual([1, 1, 2]);
  });

  test('indexes duplicate tiles by their visible content', () => {
    const ts = tileset();
    ts.tiles.push(probe.slice());
    const index = tileIndex(ts);
    expect(index.get(tileKey(probe))).toEqual([1, 3]);
    expect(findTile(ts, probe, index)).toBe(1);
  });

  test('lays out tileset images in rows', () => {
    const ts: Tileset = { name: '', tw: 2, th: 1, baseIndex: 1, tiles: [
      new Uint32Array(2), new Uint32Array([A, B]), new Uint32Array([C, D]),
    ] };
    expect(tilesetImage(ts, 2)).toEqual({
      w: 4, h: 1, data: new Uint32Array([A, B, C, D]),
    });
    expect(tilesetImage(ts, 1)).toEqual({
      w: 2, h: 2, data: new Uint32Array([A, B, C, D]),
    });
  });

  test('cuts images into tiles with optional empty and duplicate skipping', () => {
    const img = { w: 4, h: 2, data: new Uint32Array([A, A, A, A, B, B, 0, 0]) };
    expect(tilesFromImage(img, 2, 1)).toEqual([
      new Uint32Array([A, A]), new Uint32Array([B, B]),
    ]);
    expect(tilesFromImage(img, 2, 1, false, false)).toEqual([
      new Uint32Array([A, A]), new Uint32Array([A, A]),
      new Uint32Array([B, B]), new Uint32Array([0, 0]),
    ]);
  });

  test('maps offset cels onto a clipped canvas grid', () => {
    const ts = tileset();
    const grid = mapGrid(ts, {
      x: -2, y: 2,
      tiles: { cols: 2, rows: 2, refs: new Uint32Array([1, 2, 1, 2]) },
    }, 6, 6);
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(3);
    expect([...grid.refs]).toEqual([0, 0, 0, 2, 0, 0, 2, 0, 0]);
    expect([...mapGrid(ts, null, 6, 6).refs]).toEqual(new Array(9).fill(0));
  });

  test('exports maps as CSV and JSON with separate flip metadata', () => {
    const ts = tileset();
    const grid = {
      cols: 2, rows: 1,
      refs: new Uint32Array([(1 | FLIP_X | FLIP_D) >>> 0, 2]),
    };
    expect(mapCsv(grid)).toBe('1hd,2\n');
    expect(JSON.parse(mapJson(ts, grid, 'Ground', 'texture.png'))).toEqual({
      layer: 'Ground', columns: 2, rows: 1,
      tileset: { name: 'Test', tileWidth: 2, tileHeight: 2, tiles: 2, image: 'texture.png' },
      tiles: [1, 2],
      flips: [{ h: true, v: false, d: true }, { h: false, v: false, d: false }],
    });

    const plain = JSON.parse(mapJson(ts, { cols: 1, rows: 1, refs: new Uint32Array([1]) }, 'Plain'));
    expect(plain.flips).toBeUndefined();
  });
});
