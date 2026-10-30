import { describe, expect, mock, test } from 'bun:test';
import type { Sprite as SpriteModel } from '~/core/Sprite';
import { encodeGif } from '~/core/Gif';
import { decodeGif } from '~/core/formats/GifDecode';
import { decodeApng, encodeApng } from '~/core/formats/Apng';
import { decodeAseprite, encodeAseprite, type AseDocument } from '~/core/formats/Aseprite';
import { packRgba } from '~/core/Image';

mock.module('@vicimpa/decorators', () => ({
  prop: () => {},
  reactive: () => <T,>(value: T) => value,
}));

const { PIXPRITE_VERSION, Sprite, SUPPORTED_PIXPRITE_VERSIONS } = await import('~/core/Sprite');

const RED = packRgba(255, 0, 0, 255);
const rgba = new Uint8ClampedArray(new Uint32Array([RED]).buffer);

const aseDocument = (): AseDocument => ({
  width: 1,
  height: 1,
  frames: [{ duration: 100 }],
  layers: [{
    name: 'Layer', visible: true, locked: false, background: false, continuous: true,
    opacity: 1, blend: 'source-over',
    cels: [{ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) }],
  }],
  tags: [], palette: [], colorMode: 'rgb',
});

const truncations = (bytes: Uint8Array) => [
  bytes.subarray(0, 0),
  bytes.subarray(0, Math.min(12, bytes.length)),
  bytes.subarray(0, Math.floor(bytes.length / 2)),
  bytes.subarray(0, bytes.length - 1),
];

/** Keep malformed-inline fixtures explicitly on v4, whose validation remains supported. */
function legacyV4(sprite: SpriteModel): any {
  const json = JSON.parse(JSON.stringify(sprite.toJSON()));
  const images = new Map<string, any>(json.images.map((image: any) => [image.id, image]));
  json.version = 4;
  json.layers.forEach((layer: any) => layer.cels = layer.cels.map((cel: any) => {
    if (!cel || 'link' in cel) return cel;
    const source = images.get(cel.image.id)!;
    const { image: _image, ...position } = cel;
    return { ...position, w: source.w, h: source.h, d: source.d };
  }));
  delete json.images;
  return json;
}

describe('Corrupted files', () => {
  test('Aseprite rejects truncated headers, chunks and compressed data', async () => {
    const bytes = await encodeAseprite(aseDocument());
    for (const part of truncations(bytes))
      await expect(decodeAseprite(part)).rejects.toThrow();
  });

  test('GIF rejects truncated headers, palettes, image data and missing trailer', () => {
    const bytes = encodeGif(1, 1, [{ data: rgba, delay: 100 }]);
    for (const part of truncations(bytes))
      expect(() => decodeGif(part)).toThrow();
  });

  test('APNG rejects truncated headers, chunks and compressed data', async () => {
    const bytes = await encodeApng(1, 1, [{ data: rgba, delay: 100 }]);
    for (const part of truncations(bytes))
      await expect(decodeApng(part)).rejects.toThrow();
  });

  test('.pixprite rejects a cel whose pixel buffer is shorter than its dimensions', () => {
    const sprite = new Sprite(1, 1);
    sprite.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) });
    const json = legacyV4(sprite);
    const cel = json.layers[0].cels[0] as { w: number; h: number; d: string; };
    cel.w = 2;
    cel.h = 1;
    cel.d = btoa(String.fromCharCode(1, 0, 0, 0));

    expect(() => new Sprite().load(json)).toThrow('Invalid cel pixel buffer length');
  });

  test('.pixprite rejects a tile reference buffer with the wrong length', () => {
    const sprite = new Sprite(1, 1);
    sprite.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) });
    const json = legacyV4(sprite);
    Object.assign(json.layers[0].cels[0] as object, {
      tc: 2,
      tr: 1,
      t: btoa(String.fromCharCode(1, 0, 0, 0)),
    });

    expect(() => new Sprite().load(json)).toThrow('Invalid tile reference buffer length');
  });

  test('.pixprite rejects a legacy full-canvas buffer with the wrong length', () => {
    const sprite = new Sprite(2, 1) as SpriteModel;
    const json = legacyV4(sprite);
    json.layers[0].cels[0] = btoa(String.fromCharCode(1, 0, 0, 0)) as never;

    expect(() => new Sprite().load(json)).toThrow('Invalid cel pixel buffer length');
  });

  const validPixprite = () => {
    const sprite = new Sprite(1, 1);
    sprite.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) });
    return legacyV4(sprite);
  };

  const u32 = (...values: number[]) => btoa(String.fromCharCode(...values.flatMap(v => [
    v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255,
  ])));

  test('.pixprite rejects negative, zero, fractional and excessive document dimensions', () => {
    for (const [width, height] of [[-1, 1], [1, -1], [0, 1], [1, 0], [1.5, 1], [4097, 1], [1, 4097]]) {
      const json = validPixprite();
      json.width = width;
      json.height = height;
      expect(() => new Sprite().load(json)).toThrow('Invalid document dimensions');
    }
  });

  test('.pixprite validates dimensions before decoding or allocating pixel data', () => {
    const json = validPixprite();
    json.width = 5000;
    (json.layers[0].cels[0] as { d: string; }).d = 'not base64';
    expect(() => new Sprite().load(json)).toThrow('Invalid document dimensions');
  });

  test('.pixprite rejects excessive cel dimensions before reading its buffer', () => {
    const json = validPixprite();
    (json.layers[0].cels[0] as { w: number; d: string; }).w = 5000;
    (json.layers[0].cels[0] as { d: string; }).d = 'not base64';
    expect(() => new Sprite().load(json)).toThrow('Invalid cel dimensions');
  });

  test('.pixprite rejects missing frames and layers', () => {
    const noFrames = validPixprite();
    noFrames.frames = [];
    expect(() => new Sprite().load(noFrames)).toThrow('Document has no frames');

    const noLayers = validPixprite();
    noLayers.layers = [];
    expect(() => new Sprite().load(noLayers)).toThrow('Document has no layers');
  });

  test('.pixprite rejects layer and frame count mismatches', () => {
    const json = validPixprite();
    json.layers[0].cels = [];
    expect(() => new Sprite().load(json)).toThrow('Layer cel count does not match frame count');
  });

  test('.pixprite rejects invalid linked cel references', () => {
    for (const link of [-1, 1, 0.5]) {
      const json = validPixprite();
      json.frames.push({ duration: 100 });
      json.layers[0].celOpacity.push(1);
      json.layers[0].cels.push({ link });
      expect(() => new Sprite().load(json)).toThrow('Invalid linked cel reference');
    }

    const missingTarget = validPixprite();
    missingTarget.frames.push({ duration: 100 });
    missingTarget.layers[0].celOpacity.push(1);
    missingTarget.layers[0].cels[0] = null;
    missingTarget.layers[0].cels.push({ link: 0 });
    expect(() => new Sprite().load(missingTarget)).toThrow('Invalid linked cel reference');
  });

  test('.pixprite rejects a layer that references a missing tileset', () => {
    const json = validPixprite();
    json.layers[0].tileset = 0;
    expect(() => new Sprite().load(json)).toThrow('Invalid layer tileset reference');
  });

  test('.pixprite rejects tile references outside the selected tileset', () => {
    const json = validPixprite();
    json.tilesets = [{ name: 'Tiles', tw: 1, th: 1, baseIndex: 1, count: 1, d: u32(0) }];
    json.layers[0].tileset = 0;
    Object.assign(json.layers[0].cels[0] as object, { tc: 1, tr: 1, t: u32(2) });
    expect(() => new Sprite().load(json)).toThrow('Invalid tile reference');
  });

  test('binary decoders reject zero and excessive canvas dimensions', async () => {
    const gif = encodeGif(1, 1, [{ data: rgba, delay: 100 }]);
    const ase = await encodeAseprite(aseDocument());
    const apng = await encodeApng(1, 1, [{ data: rgba, delay: 100 }]);

    for (const [width, height] of [[0, 1], [65535, 65535]]) {
      const gifView = new DataView(gif.buffer);
      gifView.setUint16(6, width, true);
      gifView.setUint16(8, height, true);
      expect(() => decodeGif(gif)).toThrow('Invalid GIF dimensions');

      const aseView = new DataView(ase.buffer);
      aseView.setUint16(8, width, true);
      aseView.setUint16(10, height, true);
      await expect(decodeAseprite(ase)).rejects.toThrow('Invalid Aseprite dimensions');

      const apngView = new DataView(apng.buffer);
      apngView.setUint32(16, width);
      apngView.setUint32(20, height);
      await expect(decodeApng(apng)).rejects.toThrow('Invalid PNG dimensions');
    }
  });

  test('Aseprite rejects a document without frames', async () => {
    const bytes = await encodeAseprite(aseDocument());
    new DataView(bytes.buffer).setUint16(6, 0, true);
    await expect(decodeAseprite(bytes)).rejects.toThrow('Aseprite file has no frames');
  });

  test('Aseprite bounds frames, chunks and cel allocations before reading their payloads', async () => {
    const original = await encodeAseprite(aseDocument());
    const oversizedFrame = original.slice();
    new DataView(oversizedFrame.buffer).setUint32(128, original.length, true);
    await expect(decodeAseprite(oversizedFrame)).rejects.toThrow('Truncated Aseprite frame');

    const shortChunk = original.slice();
    new DataView(shortChunk.buffer).setUint32(144, 5, true);
    await expect(decodeAseprite(shortChunk)).rejects.toThrow('Invalid Aseprite chunk length');

    const oversizedCel = original.slice();
    const view = new DataView(oversizedCel.buffer);
    for (let pos = 144; pos < oversizedCel.length; pos += view.getUint32(pos, true)) {
      if (view.getUint16(pos + 4, true) !== 0x2005) continue;
      view.setUint16(pos + 22, 65535, true);
      view.setUint16(pos + 24, 65535, true);
      break;
    }
    await expect(decodeAseprite(oversizedCel)).rejects.toThrow('Invalid Aseprite pixel dimensions');
  });

  test('compressed pixel payloads cannot exceed their validated dimensions', async () => {
    const document = aseDocument();
    document.width = 2;
    document.layers[0].cels[0]!.w = 2;
    document.layers[0].cels[0]!.data = new Uint32Array([RED, RED]);
    const ase = await encodeAseprite(document);
    const aseView = new DataView(ase.buffer);
    for (let pos = 144; pos < ase.length; pos += aseView.getUint32(pos, true)) {
      if (aseView.getUint16(pos + 4, true) === 0x2005) aseView.setUint16(pos + 22, 1, true);
    }
    await expect(decodeAseprite(ase)).rejects.toThrow('Invalid decompressed pixel buffer length');

    const png = await encodeApng(2, 1, [{ data: new Uint8Array(8), delay: 100 }]);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1);
    for (let pos = 8; pos < png.length; pos += view.getUint32(pos) + 12) {
      if (String.fromCharCode(...png.subarray(pos + 4, pos + 8)) === 'fcTL') view.setUint32(pos + 12, 1);
    }
    await expect(decodeApng(png)).rejects.toThrow('Invalid decompressed pixel buffer length');
  });

  test('GIF validates local image dimensions before allocating its LZW output', () => {
    const gif = encodeGif(1, 1, [{ data: rgba, delay: 100 }]);
    const globalPaletteBytes = 3 * (1 << ((gif[10] & 7) + 1));
    let pos = 13 + globalPaletteBytes;
    while (gif[pos] === 0x21) {
      pos += 2;
      while (gif[pos]) pos += gif[pos] + 1;
      pos++;
    }
    expect(gif[pos]).toBe(0x2c);
    const view = new DataView(gif.buffer);
    view.setUint16(pos + 5, 65535, true);
    view.setUint16(pos + 7, 65535, true);
    expect(() => decodeGif(gif)).toThrow('Invalid GIF frame dimensions');
  });

  test('.pixprite rejects primitive cels, invalid loops and non-array cel opacity', () => {
    for (const cel of [false, 0, 1, [], undefined]) {
      const json = validPixprite();
      Object.assign(json.layers[0].cels, { 0: cel });
      expect(() => new Sprite().load(json)).toThrow('Invalid cel structure');
    }
    for (const loop of [false, [0.5, 0.5], ['0', '0']]) {
      const json = validPixprite();
      Object.assign(json, { loop });
      expect(() => new Sprite().load(json)).toThrow('Invalid loop range');
    }
    const opacity = validPixprite();
    Object.assign(opacity.layers[0], { celOpacity: { length: 1 } });
    expect(() => new Sprite().load(opacity)).toThrow('Invalid cel opacity');
  });

  test('.pixprite preserves the current document and undo history when decoding or integrity fails', () => {
    const current = new Sprite(2, 1);
    current.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([RED]) });
    current.checkpoint('Before invalid import');
    const before = current.toJSON();
    const history = current.history;
    const corrupt = validPixprite();
    Object.assign(corrupt.layers[0].cels[0] as object, { d: '!!!!!!!!' });
    expect(() => current.load(corrupt)).toThrow();
    expect(current.toJSON()).toEqual(before);
    expect(current.history).toBe(history);

    const brokenGroup = validPixprite();
    brokenGroup.layers[0].depth = 1;
    expect(() => current.load(brokenGroup)).toThrow('Document integrity: missing layer group');
    expect(current.toJSON()).toEqual(before);
    expect(current.history).toBe(history);
  });

  test('.pixprite declares and accepts every supported format version', () => {
    expect(PIXPRITE_VERSION).toBe(5);
    expect([...SUPPORTED_PIXPRITE_VERSIONS]).toEqual([3, 4, 5]);
    expect(() => new Sprite().load(validPixprite())).not.toThrow();

    const legacy = validPixprite();
    Object.assign(legacy, { version: 3 });
    legacy.layers[0].cels[0] = u32(RED) as never;
    expect(() => new Sprite().load(legacy)).not.toThrow();
  });

  test('.pixprite rejects unknown and newer format versions before loading', () => {
    for (const version of [0, 2, '4', undefined]) {
      const json = validPixprite();
      Object.assign(json, { version });
      expect(() => new Sprite().load(json)).toThrow('Unsupported pixprite version');
    }

    const newer = validPixprite();
    Object.assign(newer, { version: PIXPRITE_VERSION + 1 });
    expect(() => new Sprite().load(newer)).toThrow('Newer pixprite version');
  });

  test('.pixprite rejects invalid palette, tag and user-data colors', () => {
    const palette = validPixprite();
    palette.framePalettes = [{ frame: 0, colors: ['red'] }];
    expect(() => new Sprite().load(palette)).toThrow('Invalid color');

    const tag = validPixprite();
    tag.tags = [{ name: 'Bad', from: 0, to: 0, color: '#gg0000', direction: 'forward' }];
    expect(() => new Sprite().load(tag)).toThrow('Invalid color');

    const userData = validPixprite();
    userData.layers[0].userData = { color: 'blue' };
    expect(() => new Sprite().load(userData)).toThrow('Invalid color');
  });

  test('.pixprite rejects non-JSON extension metadata', () => {
    const arrayRoot = validPixprite();
    Object.assign(arrayRoot, { ext: [] });
    expect(() => new Sprite().load(arrayRoot)).toThrow('Invalid extension metadata');

    const nonFinite = validPixprite();
    Object.assign(nonFinite, { ext: { value: Number.NaN } });
    expect(() => new Sprite().load(nonFinite)).toThrow('Invalid extension metadata');

    const nested = validPixprite();
    Object.assign(nested.layers[0].cels[0] as object, { ext: { callback: () => true } });
    expect(() => new Sprite().load(nested)).toThrow('Invalid extension metadata');
  });

  test('.pixprite detects cyclic extension metadata before loading', () => {
    const json = validPixprite();
    const ext: Record<string, unknown> = {};
    ext.self = ext;
    Object.assign(json, { ext });
    expect(() => new Sprite().load(json)).toThrow('Cyclic extension metadata');
  });

  test('.pixprite rejects non-object document roots and invalid field types', () => {
    for (const value of [null, [], 'document', 42])
      expect(() => new Sprite().load(value)).toThrow('Invalid document structure');

    const duration = validPixprite();
    duration.frames[0].duration = 0;
    expect(() => new Sprite().load(duration)).toThrow('Invalid frame duration');

    const opacity = validPixprite();
    opacity.layers[0].opacity = 2;
    expect(() => new Sprite().load(opacity)).toThrow('Invalid layer opacity');

    const blend = validPixprite();
    Object.assign(blend.layers[0], { blend: 'invalid' });
    expect(() => new Sprite().load(blend)).toThrow('Invalid layer blend mode');
  });

  test('.pixprite validates cel opacity arrays and coordinates', () => {
    const opacity = validPixprite();
    opacity.layers[0].celOpacity = [];
    expect(() => new Sprite().load(opacity)).toThrow('Invalid cel opacity');

    for (const [x, y] of [[0.5, 0], [0, 0.5], [Number.NaN, 0]]) {
      const json = validPixprite();
      Object.assign(json.layers[0].cels[0] as object, { x, y });
      expect(() => new Sprite().load(json)).toThrow('Invalid cel coordinates');
    }
  });

  test('.pixprite validates tag, slice and frame palette resource ranges', () => {
    const tag = validPixprite();
    tag.tags = [{ name: 'Bad', from: 0, to: 2, color: '#000000', direction: 'forward' }];
    expect(() => new Sprite().load(tag)).toThrow('Invalid tag range');

    const slice = validPixprite();
    slice.slices = [{ name: 'Bad', color: '#000000', keys: [{ frame: 2, x: 0, y: 0, w: 1, h: 1 }] }];
    expect(() => new Sprite().load(slice)).toThrow('Invalid slice frame');

    const palette = validPixprite();
    palette.framePalettes = [{ frame: 2, colors: ['#000000'] }];
    expect(() => new Sprite().load(palette)).toThrow('Invalid frame palette key');
  });

  test('.pixprite checks tileset pixel buffer length', () => {
    const json = validPixprite();
    json.tilesets = [{ name: 'Tiles', tw: 1, th: 1, baseIndex: 1, count: 2, d: u32(0) }];
    expect(() => new Sprite().load(json)).toThrow('Invalid tileset pixel buffer length');
  });

  test('.pixprite verifies group integrity after constructing the model', () => {
    const json = validPixprite();
    json.layers[0].depth = 1;
    expect(() => new Sprite().load(json)).toThrow('Document integrity: missing layer group');
  });
});
