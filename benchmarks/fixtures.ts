import { Sprite, createCelInstance, createImage } from '../src/core/Sprite';
import { newLayer } from '../src/core/SpriteModel';
import { renderTiles } from '../src/core/Tilemap';

import type { Scenario } from './scenarios';

function pixels(length: number, seed: number) {
  const out = new Uint32Array(length);
  let x = seed + 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = (x | 0xff000000) >>> 0;
  }
  return out;
}

export function fixture(config: Scenario) {
  const { width, height, frames, layers, linked, tiles } = config;
  const sourcePixels = width * height * layers * (linked ? 1 : frames) + (tiles ?? 0) * 16 * 16;
  if (width > 4096 || height > 4096 || sourcePixels > 67_108_864) throw new Error('Fixture exceeds model limits');
  const doc = new Sprite(width, height);
  doc.name = config.id;
  doc.frames = Array.from({ length: frames }, (_, i) => ({ duration: 80 + i % 5 * 10 }));
  doc.layers = Array.from({ length: layers }, (_, layer) => {
    const result = newLayer(`Layer ${layer}`, frames);
    let first: ReturnType<typeof createCelInstance>;
    result.cels = Array.from({ length: frames }, (_, frame) => {
      if (linked && frame) return first;
      const image = createImage(width, height, pixels(width * height, layer * frames + frame), `${config.id}:${layer}:${frame}`);
      return first = createCelInstance(image);
    });
    return result;
  });
  if (tiles) {
    const ts = { name: 'Deterministic tiles', tw: 16, th: 16, baseIndex: 1,
      tiles: Array.from({ length: tiles }, (_, i) => i ? pixels(256, i) : new Uint32Array(256)) };
    const refs = { cols: width / 16, rows: height / 16, refs: Uint32Array.from({ length: width * height / 256 }, (_, i) => i % (tiles - 1) + 1) };
    const cel = createCelInstance(createImage(width, height, renderTiles(ts, refs), `${config.id}:map`));
    cel.tiles = refs;
    doc.layers[0].cels = [cel]; doc.layers[0].tileset = 0; doc.tilesets = [ts];
  }
  return { doc, sourcePixels };
}
