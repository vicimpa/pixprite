import { describe, expect, mock, test } from 'bun:test';
import type { CelImage, Layer, Sprite as SpriteModel } from '~/core/Sprite';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { Sprite, childrenOf, parentOf, rootsOf, subtreeStart } = await import('~/core/Sprite');

const A = 0xff000001;

const cel = (): CelImage => ({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([A]) });

const layer = (name: string, frames: number, depth = 0, group = false): Layer => ({
  name,
  visible: true,
  locked: false,
  background: false,
  continuous: true,
  opacity: 1,
  blend: 'source-over',
  cels: Array(frames).fill(null),
  celOpacity: Array(frames).fill(1),
  group,
  depth,
  collapsed: false,
  tileset: -1,
});

const spriteWith = (layers: Layer[], frames = 2) => {
  const sprite = new Sprite(2, 2);
  sprite.frames = Array.from({ length: frames }, () => ({ duration: 100 }));
  sprite.layers = layers;
  return sprite;
};

const hierarchy = () => spriteWith([
  layer('Outside bottom', 2),
  layer('Child A', 2, 1),
  layer('Nested child', 2, 2),
  layer('Nested group', 2, 1, true),
  layer('Child B', 2, 1),
  layer('Root group', 2, 0, true),
  layer('Outside top', 2),
]);

const shape = (sprite: SpriteModel) => sprite.layers.map(l => [l.name, l.depth, l.group]);

describe('Layer groups', () => {
  test('finds subtree boundaries, parents, direct children and roots', () => {
    const sprite = hierarchy();
    const layers = sprite.layers;

    expect(subtreeStart(layers, 5)).toBe(1);
    expect(subtreeStart(layers, 3)).toBe(2);
    expect(subtreeStart(layers, 1)).toBe(1);
    expect(parentOf(layers, 1)).toBe(5);
    expect(parentOf(layers, 2)).toBe(3);
    expect(parentOf(layers, 3)).toBe(5);
    expect(parentOf(layers, 5)).toBe(-1);
    expect(childrenOf(layers, 5)).toEqual([1, 3, 4]);
    expect(childrenOf(layers, 3)).toEqual([2]);
    expect(rootsOf(layers)).toEqual([0, 5, 6]);
  });

  test('inherits visibility and locks through nested groups', () => {
    const sprite = hierarchy();
    sprite.layers[5].visible = false;
    sprite.layers[3].locked = true;

    expect(sprite.visibleDeep(1)).toBe(false);
    expect(sprite.visibleDeep(2)).toBe(false);
    expect(sprite.visibleDeep(0)).toBe(true);
    expect(sprite.lockedDeep(2)).toBe(true);
    expect(sprite.lockedDeep(1)).toBe(false);

    sprite.layer = 2;
    expect(sprite.editable).toBe(false);
    sprite.layers[5].visible = true;
    expect(sprite.editable).toBe(false);
    sprite.layers[3].locked = false;
    expect(sprite.editable).toBe(true);
    sprite.layer = 5;
    expect(sprite.editable).toBe(false);
  });

  test('addGroup wraps selected sibling layers without cloning their cels', () => {
    const shared = cel();
    const a = layer('A', 2);
    const b = layer('B', 2);
    a.cels = [shared, shared];
    b.cels = [shared, null];
    const sprite = spriteWith([a, b, layer('C', 2)]);
    sprite.range = { type: 'layers', layers: [0, 1], frames: [0, 1] };

    sprite.addGroup();

    expect(shape(sprite)).toEqual([
      ['A', 1, false],
      ['B', 1, false],
      ['Group 1', 0, true],
      ['C', 0, false],
    ]);
    expect(sprite.layer).toBe(2);
    expect(childrenOf(sprite.layers, 2)).toEqual([0, 1]);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[1].cels[0]).toBe(shared);
    expect(sprite.range).toBeNull();
  });

  test('addLayer enters an open group but not a collapsed one', () => {
    const sprite = hierarchy();
    sprite.layer = 5;

    sprite.addLayer();

    expect(sprite.layer).toBe(1);
    expect(sprite.layers[1].depth).toBe(1);
    expect(parentOf(sprite.layers, 1)).toBe(6);

    sprite.layer = 6;
    sprite.toggleCollapsed(6);
    sprite.addLayer();

    expect(sprite.layers[6].collapsed).toBe(true);
    expect(sprite.layer).toBe(7);
    expect(sprite.layers[7].depth).toBe(0);
    expect(parentOf(sprite.layers, 7)).toBe(-1);
  });

  test('duplicateLayer copies a whole subtree and preserves only internal cel links', () => {
    const shared = cel();
    const child = layer('Child', 2, 1);
    child.cels = [shared, shared];
    const group = layer('Group', 2, 0, true);
    const sprite = spriteWith([child, group]);
    sprite.layer = 1;

    sprite.duplicateLayer();

    expect(shape(sprite)).toEqual([
      ['Child', 1, false],
      ['Group', 0, true],
      ['Child', 1, false],
      ['Group copy', 0, true],
    ]);
    expect(sprite.layers[0].cels[0]).toBe(shared);
    expect(sprite.layers[0].cels[1]).toBe(shared);
    expect(sprite.layers[2].cels[0]).toBe(sprite.layers[2].cels[1]);
    expect(sprite.layers[2].cels[0]).not.toBe(shared);
    expect(sprite.layers[2].cels[0]!.data).not.toBe(shared.data);
    expect([...sprite.layers[2].cels[0]!.data]).toEqual([...shared.data]);
    expect(parentOf(sprite.layers, 2)).toBe(3);
  });

  test('removeLayers removes a group together with its complete subtree', () => {
    const sprite = hierarchy();
    const outsideBottom = sprite.layers[0];
    const outsideTop = sprite.layers[6];
    sprite.layer = 5;

    expect(sprite.removeLayers()).toBe(true);

    expect(sprite.layers).toEqual([outsideBottom, outsideTop]);
    expect(sprite.layers[0].depth).toBe(0);
    expect(sprite.layers[1].depth).toBe(0);
    expect(sprite.range).toBeNull();
  });

  test('removeLayers refuses to remove every root layer', () => {
    const sprite = spriteWith([
      layer('Child', 2, 1),
      layer('Group', 2, 0, true),
    ]);
    const before = sprite.layers;
    sprite.layer = 1;

    expect(sprite.removeLayers()).toBe(false);
    expect(sprite.layers).toBe(before);
    expect(sprite.layers.length).toBe(2);
  });

  test('ungroup dissolves only the active group and retains nested structure', () => {
    const sprite = hierarchy();
    const nestedChild = sprite.layers[2];
    const nestedGroup = sprite.layers[3];
    sprite.layer = 5;

    sprite.ungroup();

    expect(shape(sprite)).toEqual([
      ['Outside bottom', 0, false],
      ['Child A', 0, false],
      ['Nested child', 1, false],
      ['Nested group', 0, true],
      ['Child B', 0, false],
      ['Outside top', 0, false],
    ]);
    expect(sprite.layers[2].cels).toBe(nestedChild.cels);
    expect(sprite.layers[3].cels).toBe(nestedGroup.cels);
    expect(parentOf(sprite.layers, 2)).toBe(3);
    expect(sprite.layer).toBe(4);
  });

  test('moveLayers moves a group with all descendants and keeps their relative depths', () => {
    const sprite = hierarchy();
    const child = sprite.layers[1];
    const nested = sprite.layers[2];
    sprite.layer = 5;

    expect(sprite.moveLayers([5, 5], 7, false)).toBe(true);

    expect(shape(sprite)).toEqual([
      ['Outside bottom', 0, false],
      ['Outside top', 0, false],
      ['Child A', 1, false],
      ['Nested child', 2, false],
      ['Nested group', 1, true],
      ['Child B', 1, false],
      ['Root group', 0, true],
    ]);
    expect(sprite.layers[2].cels).toBe(child.cels);
    expect(sprite.layers[3].cels).toBe(nested.cels);
    expect(subtreeStart(sprite.layers, 6)).toBe(2);
    expect(childrenOf(sprite.layers, 6)).toEqual([2, 4, 5]);
    expect(sprite.layer).toBe(6);
  });

  test('moveOutOfGroup moves a nested layer above its former parent', () => {
    const sprite = hierarchy();
    const nested = sprite.layers[2];
    sprite.layer = 2;

    sprite.moveOutOfGroup();

    expect(shape(sprite)).toEqual([
      ['Outside bottom', 0, false],
      ['Child A', 1, false],
      ['Nested group', 1, true],
      ['Nested child', 1, false],
      ['Child B', 1, false],
      ['Root group', 0, true],
      ['Outside top', 0, false],
    ]);
    expect(sprite.layers[3].cels).toBe(nested.cels);
    expect(parentOf(sprite.layers, 3)).toBe(5);
    expect(childrenOf(sprite.layers, 2)).toEqual([]);
    expect(sprite.layer).toBe(3);
  });

  test('soloLayer keeps ancestors and descendants, then restores prior visibility', () => {
    const sprite = hierarchy();
    sprite.layers[6].visible = false;

    sprite.soloLayer(2);

    expect(sprite.layers.map(l => l.visible)).toEqual([false, false, true, true, false, true, false]);
    sprite.soloLayer(2);
    expect(sprite.layers.map(l => l.visible)).toEqual([true, true, true, true, true, true, false]);
  });

  test('rangeNodes returns sibling blocks while skipping their descendants', () => {
    const sprite = hierarchy();
    sprite.range = { type: 'layers', layers: [1, 4], frames: [0, 1] };
    expect(sprite.rangeNodes).toEqual([1, 3, 4]);

    sprite.range = { type: 'layers', layers: [0, 1], frames: [0, 1] };
    expect(sprite.rangeNodes).toBeNull();
  });

  test('JSON round-trip preserves group hierarchy and collapsed state', () => {
    const sprite = hierarchy();
    sprite.layers[3].collapsed = true;
    sprite.layers[5].userData = { text: 'Characters', color: '#ff00ff' };

    const loaded = new Sprite();
    loaded.load(JSON.parse(JSON.stringify(sprite.toJSON())));

    expect(shape(loaded)).toEqual(shape(sprite));
    expect(loaded.layers[3].collapsed).toBe(true);
    expect(loaded.layers[5].userData).toEqual({ text: 'Characters', color: '#ff00ff' });
    expect(childrenOf(loaded.layers, 5)).toEqual([1, 3, 4]);
    expect(parentOf(loaded.layers, 2)).toBe(3);
  });
});
