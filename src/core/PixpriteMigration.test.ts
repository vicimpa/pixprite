import { describe, expect, mock, test } from 'bun:test';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { PIXPRITE_VERSION, Sprite } = await import('~/core/Sprite');

const RED = 0xff0000ff;
const GREEN = 0xff00ff00;
const BLUE = 0xffff0000;

const b64 = (...values: number[]) => btoa(String.fromCharCode(...values.flatMap(v => [
  v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255,
])));

const legacyDocument = (): any => {
  const current = new Sprite(2, 1).toJSON();
  return {
    ...current,
    version: 3,
    layers: current.layers.map(layer => ({
      ...layer,
      cels: [b64(RED, GREEN)],
    })),
  };
};

describe('.pixprite migrations', () => {
  test('v3 full-canvas cels migrate to placed v4 cels and save stably', () => {
    const legacy = legacyDocument();
    const loaded = new Sprite();

    loaded.load(legacy);
    const saved = loaded.toJSON();

    expect(PIXPRITE_VERSION).toBe(4);
    expect(saved.version).toBe(4);
    expect(saved.layers[0].cels[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 1 });
    expect([...loaded.layers[0].cels[0]!.data]).toEqual([RED, GREEN]);
    expect(saved.layers[0].cels[0]).not.toEqual(legacy.layers[0].cels[0]);

    const second = new Sprite();
    second.load(JSON.parse(JSON.stringify(saved)));
    expect(second.toJSON()).toEqual(saved);
  });

  test('v3 preserves null and empty cels', () => {
    const legacy = legacyDocument();
    legacy.frames.push({ duration: 100 });
    legacy.layers[0].cels.push(null);
    legacy.layers[0].celOpacity.push(1);

    const loaded = new Sprite();
    loaded.load(legacy);

    expect(loaded.frames).toHaveLength(2);
    expect(loaded.layers[0].cels[1]).toBeNull();
    expect(loaded.layers[0].cels[0]).not.toBeNull();
  });

  test('a newer version cannot overwrite the current document', () => {
    const current = new Sprite(1, 1);
    current.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([BLUE]) });
    const before = current.toJSON();
    const newer = { ...before, version: PIXPRITE_VERSION + 1 };

    expect(() => current.load(newer)).toThrow('Newer pixprite version: 5; supported up to 4');
    expect(current.toJSON()).toEqual(before);
    expect(current.layers[0].cels[0]!.data[0]).toBe(BLUE);
  });

  test('unknown extension data survives load and save without an extension', () => {
    const json = new Sprite(1, 1).toJSON();
    Object.assign(json, {
      ext: { 'missing.extension': { nested: [1, true, null, 'value'] } },
    });
    Object.assign(json.layers[0], {
      ext: { 'unknown.layer': { enabled: false } },
    });

    const loaded = new Sprite();
    loaded.load(json);

    expect(loaded.ext).toEqual(json.ext!);
    expect(loaded.layers[0].ext).toEqual(json.layers[0].ext!);
    expect(loaded.toJSON().ext).toEqual(json.ext!);
    expect(loaded.toJSON().layers[0].ext).toEqual(json.layers[0].ext!);
  });
});
