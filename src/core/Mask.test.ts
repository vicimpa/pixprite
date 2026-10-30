import { describe, expect, test } from 'bun:test';
import { Mask } from '~/core/Mask';

const selected = (mask: Mask) => {
  const points: [number, number][] = [];
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.has(x, y)) points.push([x, y]);
  return points;
};

describe('Mask', () => {
  test('tracks empty state, bounds and out-of-bounds access', () => {
    const empty = new Mask(4, 3);
    expect(empty.empty).toBe(true);
    expect(empty.bounds).toBeNull();
    expect(empty.has(0, 0)).toBe(false);

    const mask = Mask.fromFn(4, 3, (x, y) => (x === 1 && y === 2) || (x === 3 && y === 0));
    expect(mask.empty).toBe(false);
    expect(mask.bounds).toEqual({ x: 1, y: 0, w: 3, h: 3 });
    expect(mask.has(-1, 0)).toBe(false);
    expect(mask.has(0, -1)).toBe(false);
    expect(mask.has(4, 0)).toBe(false);
    expect(mask.has(0, 3)).toBe(false);
  });

  test('creates clipped rectangles', () => {
    const mask = Mask.rect(4, 4, { x: -1, y: 1, w: 3, h: 4 });
    expect(selected(mask)).toEqual([
      [0, 1], [1, 1],
      [0, 2], [1, 2],
      [0, 3], [1, 3],
    ]);
    expect(mask.bounds).toEqual({ x: 0, y: 1, w: 2, h: 3 });
  });

  test('samples ellipses at pixel centers', () => {
    const mask = Mask.ellipse(5, 5, { x: 0, y: 0, w: 5, h: 5 });
    expect(mask.has(2, 2)).toBe(true);
    expect(mask.has(0, 2)).toBe(true);
    expect(mask.has(2, 0)).toBe(true);
    expect(mask.has(0, 0)).toBe(false);
    expect(mask.has(4, 4)).toBe(false);
  });

  test('creates polygons and handles degenerate point input', () => {
    const polygon = Mask.polygon(6, 6, [[1, 1], [4, 1], [4, 4], [1, 4]]);
    expect(polygon.bounds).toEqual({ x: 1, y: 1, w: 4, h: 4 });
    expect(polygon.has(2, 2)).toBe(true);
    expect(polygon.has(0, 0)).toBe(false);

    expect(selected(Mask.polygon(4, 4, [[2, 1]]))).toEqual([[2, 1]]);
    expect(selected(Mask.polygon(4, 4, [[0, 0], [2, 0]]))).toEqual([[0, 0], [2, 0]]);
  });

  test('combines masks with every selection mode without mutating inputs', () => {
    const a = Mask.rect(4, 1, { x: 0, y: 0, w: 3, h: 1 });
    const b = Mask.rect(4, 1, { x: 1, y: 0, w: 3, h: 1 });
    const aData = a.data.slice();
    const bData = b.data.slice();

    expect([...a.combine(b, 'replace').data]).toEqual([...b.data]);
    expect(a.combine(b, 'replace')).toBe(b);
    expect([...a.combine(b, 'add').data]).toEqual([1, 1, 1, 1]);
    expect([...a.combine(b, 'subtract').data]).toEqual([1, 0, 0, 0]);
    expect([...a.combine(b, 'intersect').data]).toEqual([0, 1, 1, 0]);
    expect(a.data).toEqual(aData);
    expect(b.data).toEqual(bData);
  });

  test('inverts into a new mask', () => {
    const mask = Mask.rect(3, 2, { x: 1, y: 0, w: 1, h: 1 });
    const inverted = mask.invert();
    expect(inverted).not.toBe(mask);
    expect([...inverted.data]).toEqual([1, 0, 1, 1, 1, 1]);
    expect([...mask.data]).toEqual([0, 1, 0, 0, 0, 0]);
  });

  test('grows and shrinks using a square neighbourhood', () => {
    const point = Mask.rect(5, 5, { x: 2, y: 2, w: 1, h: 1 });
    const grown = point.morph(1);
    expect(grown.bounds).toEqual({ x: 1, y: 1, w: 3, h: 3 });
    expect(selected(grown).length).toBe(9);
    expect(grown.morph(-1).data).toEqual(point.data);
    expect(point.morph(-1).empty).toBe(true);
    expect(point.data).not.toBe(grown.data);
  });

  test('creates borders between outer and inner morphology', () => {
    const square = Mask.rect(5, 5, { x: 1, y: 1, w: 3, h: 3 });
    const border = square.border(1);
    expect(border.bounds).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(selected(border).length).toBe(24);
    expect(border.has(2, 2)).toBe(false);
  });

  test('translates and reframes with clipping', () => {
    const point = Mask.rect(3, 3, { x: 0, y: 0, w: 1, h: 1 });
    const translated = point.translate(2, 1);
    expect(selected(translated)).toEqual([[2, 1]]);
    expect(point.translate(-1, 0).empty).toBe(true);

    const reframed = translated.reframe(4, 2, -1, 0);
    expect(selected(reframed)).toEqual([[1, 1]]);
    expect(translated.reframe(2, 2).empty).toBe(true);
    expect(selected(point)).toEqual([[0, 0]]);
  });

  test('computes and caches border edges', () => {
    const empty = new Mask(2, 2);
    expect([...empty.edges]).toEqual([]);

    const point = Mask.rect(1, 1, { x: 0, y: 0, w: 1, h: 1 });
    expect([...point.edges]).toEqual([
      0, 0, 1, 0,
      0, 0, 0, 1,
      1, 0, 1, 1,
      0, 1, 1, 1,
    ]);
    expect(point.edges).toBe(point.edges);
  });
});
