import { Color } from "./Color";
import { ALL_CHANNELS, type FilterTarget, type Channels } from "./Filters";
import { packRgba } from "./Image";
import { state } from "./State";

export type Scope = 'cel' | 'layer' | 'frame' | 'all' | 'range';

export const SCOPES: [Scope, string][] = [
  ['cel', 'Current cel'],
  ['layer', 'All frames of this layer'],
  ['frame', 'All layers of this frame'],
  ['all', 'Everything'],
  ['range', 'Timeline selection'],
];

function scopeCels(scope: Scope): [number, number][] {
  const { sprite } = state;
  const layers = sprite.layers.map((_, i) => i), frames = sprite.frames.map((_, i) => i);
  switch (scope) {
    case 'layer': return frames.map(f => [sprite.layer, f]);
    case 'frame': return layers.map(l => [l, sprite.frame]);
    case 'all': return layers.flatMap(l => frames.map(f => [l, f] as [number, number]));
    case 'range': return sprite.selectedCels;
    default: return [[sprite.layer, sprite.frame]];
  }
}

export const toColor = (c: Color) => {
  const [r, g, b, a] = c.rgba;
  return packRgba(r, g, b, Math.round(a * 255));
};

/** What a filter works on: one cel's pixels, limited to the selection */
export function filterTarget(data: Uint32Array, layer: number): FilterTarget {
  const { sprite } = state;
  return {
    w: sprite.width, h: sprite.height, data, mask: sprite.mask,
    tiledX: state.tiledX, tiledY: state.tiledY,
    lockAlpha: sprite.layers[layer]?.background || sprite.layers[layer]?.lockAlpha,
  };
}

/** Applies a filter to the cels of `scope` as one undo step; used by the dialogs and by commands run with arguments */
export function applyFilter(title: string, run: (t: FilterTarget, ch: Channels) => Uint32Array, scope: Scope = 'cel', ch: Channels = ALL_CHANNELS) {
  const { sprite } = state;
  if (scope === 'range' && !sprite.range) scope = 'cel';
  sprite.applyFilter(title, (data, _mask, layer) => run(filterTarget(data, layer), ch), scopeCels(scope));
  state.save();
}

