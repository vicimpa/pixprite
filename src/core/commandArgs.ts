/**
 * Arguments of the built-in commands. A command with `params` can be run with arguments
 * (`ctx.commands.run(id, { … })`): it then applies them at once instead of opening its dialog.
 * Labels are plain English: they describe the arguments to programs (and AI models), not to the user.
 */
import type { FormField, FormSchema, FormValues } from "@pixprite/api";
import { Color } from "~/core/Color";
import {
  ALL_CHANNELS, KERNEL_PRESETS, adjustHsl, brightnessContrast, convolve, dropShadow, invert, median, noise, offsetWrap,
  outline, pixelate, posterize, replaceColor, type Channels, type FilterTarget,
} from "~/core/Filters";
import { BLEND_MODES, type BlendMode } from "~/core/Sprite";
import { state } from "~/core/State";
import { t } from "~/core/i18n";
import { applyFilter, toColor, type Scope } from "~/modules/Dialogs/Filters";
import { convertSpriteColorMode } from "~/modules/Dialogs/ColorMode";
import type { ColorMode, Dither } from "~/core/ColorMode";

export type Parametric = { params: FormSchema; apply: (args: FormValues) => unknown; };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Arguments checked against the schema: unknown keys are dropped, missing ones take the default,
 * numbers are clamped; a value of the wrong kind throws
 */
export function commandArgs(schema: FormSchema, args: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of schema) {
    const v = args[f.key] ?? f.default;
    if (v === undefined) throw new Error(`Argument "${f.key}" is required`);
    out[f.key] = coerce(f, v);
  }
  return out;
}

function coerce(f: FormField, v: unknown) {
  const bad = () => { throw new Error(`Argument "${f.key}": ${JSON.stringify(v)} is not a valid ${f.type}`); };
  switch (f.type) {
    case 'number': case 'slider': case 'layer': case 'tag': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
      if (!Number.isFinite(n)) return bad();
      const whole = f.type === 'layer' || f.type === 'tag' || (f.step ?? 1) % 1 === 0 ? Math.round(n) : n;
      return Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, whole));
    }
    case 'checkbox': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : bad();
    case 'color': return typeof v === 'string' && HEX.test(v) ? v : bad();
    // `"5"` picks the option 5: callers (and models) often send numbers as strings
    case 'select': return f.options?.find(o => String(o.value) === String(v))?.value ?? bad();
    default: return typeof v === 'string' ? v : String(v);
  }
}

const s = () => state.sprite;
const hex = (v: unknown) => toColor(Color.fromHex(String(v)));
const fg = () => state.colorA.toHexString(false);
const bg = () => state.colorB.toHexString(false);

const SCOPE: FormField = {
  key: 'scope', type: 'select', label: 'Cels to change', default: 'cel',
  options: (['cel', 'layer', 'frame', 'all', 'range'] as Scope[]).map(value => ({
    value,
    label: { cel: 'the current cel', layer: 'every frame of the current layer', frame: 'every layer of the current frame', all: 'every cel', range: 'the timeline selection' }[value],
  })),
};

const RGB: Channels = { r: true, g: true, b: true, a: false };

/** A filter command: its arguments become the filter's settings, plus which cels it changes */
function filter(title: () => string, params: FormSchema, run: (a: FormValues) => (t: FilterTarget, ch: Channels) => Uint32Array, ch: Channels = ALL_CHANNELS): Parametric {
  return {
    params: [...params, SCOPE],
    apply: a => applyFilter(title(), run(a), a.scope as Scope, ch),
  };
}

/** Params of commands whose defaults follow the editor state are built on each call */
export const DYNAMIC_PARAMS: Record<string, () => FormSchema> = {
  'edit.replaceColor': () => [
    { key: 'from', type: 'color', label: 'Color to find', default: fg() },
    { key: 'to', type: 'color', label: 'Color to put instead', default: bg() },
    { key: 'tolerance', type: 'slider', label: 'Tolerance', min: 0, max: 255, default: 0 },
  ],
  'fx.outline': () => [
    { key: 'color', type: 'color', label: 'Outline color', default: fg() },
    { key: 'outside', type: 'checkbox', label: 'Around the shape (off: on its edge)', default: true },
    { key: 'diagonal', type: 'checkbox', label: 'Include diagonal neighbours', default: false },
  ],
  'image.canvasSize': () => [
    { key: 'width', type: 'number', label: 'New width, px', min: 1, max: 4096, default: s().width },
    { key: 'height', type: 'number', label: 'New height, px', min: 1, max: 4096, default: s().height },
    { key: 'anchorX', type: 'slider', label: 'Where the old image stays horizontally: 0 left, 0.5 center, 1 right', min: 0, max: 1, step: 0.5, default: 0.5 },
    { key: 'anchorY', type: 'slider', label: 'Where the old image stays vertically: 0 top, 0.5 center, 1 bottom', min: 0, max: 1, step: 0.5, default: 0.5 },
  ],
  'image.spriteSize': () => [
    { key: 'width', type: 'number', label: 'New width, px (pixels are scaled)', min: 1, max: 4096, default: s().width },
    { key: 'height', type: 'number', label: 'New height, px', min: 1, max: 4096, default: s().height },
  ],
  'layer.properties': () => {
    const l = s().current;
    return [
      { key: 'layer', type: 'layer', label: 'Layer index', default: s().layer },
      { key: 'name', type: 'text', label: 'Name', default: l?.name ?? '' },
      { key: 'opacity', type: 'slider', label: 'Opacity', min: 0, max: 255, default: Math.round((l?.opacity ?? 1) * 255) },
      { key: 'blend', type: 'select', label: 'Blend mode', default: l?.blend ?? 'normal', options: BLEND_MODES.map(m => ({ value: m, label: m })) },
    ];
  },
  'anim.frameProperties': () => [
    { key: 'duration', type: 'number', label: 'Duration, ms', min: 10, max: 65535, default: s().frames[s().frame]?.duration ?? 100 },
    { key: 'all', type: 'checkbox', label: 'Every frame (off: the current frame or the timeline selection)', default: false },
  ],
  'anim.goto': () => [
    { key: 'frame', type: 'number', label: 'Frame index, from 0', min: 0, max: Math.max(0, s().frames.length - 1), default: s().frame },
  ],
  'cel.properties': () => [
    { key: 'opacity', type: 'slider', label: 'Cel opacity', min: 0, max: 255, default: 255 },
  ],
  'image.colorMode': () => [
    { key: 'mode', type: 'select', label: 'Color mode', default: s().colorMode === 'indexed' ? 'rgb' : 'indexed', options: [
      { value: 'rgb', label: 'RGB, any color' }, { value: 'indexed', label: 'indexed, palette colors only' }, { value: 'gray', label: 'grayscale' },
    ] },
    { key: 'dither', type: 'select', label: 'Dithering (indexed)', default: 'none', options: [
      { value: 'none', label: 'none, nearest color' }, { value: 'bayer2', label: 'pattern 2×2' }, { value: 'bayer4', label: 'pattern 4×4' },
      { value: 'bayer8', label: 'pattern 8×8' }, { value: 'diffusion', label: 'error diffusion' }, { value: 'atkinson', label: 'error diffusion, light (Atkinson)' },
    ] },
    { key: 'amount', type: 'slider', label: 'Dithering amount, %', min: 0, max: 100, default: 100 },
  ],
};

const selectionSize = (label: string): FormSchema => [{ key: 'pixels', type: 'number', label, min: 1, max: 256, default: 1 }];

/** Commands that take arguments; `params` here are the fixed ones (see DYNAMIC_PARAMS for the rest) */
export const PARAMETRIC: Record<string, Parametric> = {
  'edit.replaceColor': filter(() => t('dialog.replace.replaceColor'), [],
    a => (f, ch) => replaceColor(f, hex(a.from), hex(a.to), Number(a.tolerance), ch)),
  'edit.adjust': filter(() => t('dialog.hsl.hueSaturation'), [
    { key: 'hue', type: 'slider', label: 'Hue shift, degrees', min: -180, max: 180, default: 0 },
    { key: 'saturation', type: 'slider', label: 'Saturation, %', min: -100, max: 100, default: 0 },
    { key: 'lightness', type: 'slider', label: 'Lightness, %', min: -100, max: 100, default: 0 },
  ], a => f => adjustHsl(f, Number(a.hue), Number(a.saturation), Number(a.lightness))),
  'fx.outline': filter(() => t('dialog.outline.title'), [],
    a => f => outline(f, hex(a.color), { outside: !!a.outside, diagonal: !!a.diagonal })),
  'fx.shadow': filter(() => t('dialog.shadow.dropShadow'), [
    { key: 'color', type: 'color', label: 'Shadow color', default: '#000000' },
    { key: 'opacity', type: 'slider', label: 'Shadow opacity', min: 0, max: 255, default: 160 },
    { key: 'x', type: 'number', label: 'Offset X, px', min: -64, max: 64, default: 1 },
    { key: 'y', type: 'number', label: 'Offset Y, px', min: -64, max: 64, default: 1 },
  ], a => f => dropShadow(f, Number(a.x), Number(a.y), hex(String(a.color).slice(0, 7) + Number(a.opacity).toString(16).padStart(2, '0')))),
  'fx.convolution': filter(() => t('dialog.convolution.title'), [
    { key: 'matrix', type: 'select', label: 'Matrix', default: KERNEL_PRESETS[0].name, options: KERNEL_PRESETS.map(k => ({ value: k.name, label: `${k.name} (${k.w}×${k.h})` })) },
  ], a => (f, ch) => convolve(f, KERNEL_PRESETS.find(k => k.name === a.matrix)!, ch)),
  'fx.median': filter(() => t('dialog.median.despeckle'), [
    { key: 'size', type: 'select', label: 'Window', default: 3, options: [3, 5, 7, 9].map(n => ({ value: n, label: `${n}×${n}` })) },
  ], a => (f, ch) => median(f, Number(a.size), Number(a.size), ch), RGB),
  'fx.negative': filter(() => t('dialog.invert.negative'), [], () => (f, ch) => invert(f, ch), RGB),
  'fx.posterize': filter(() => t('dialog.posterize.title'), [
    { key: 'levels', type: 'slider', label: 'Levels per channel', min: 2, max: 32, default: 4 },
  ], a => (f, ch) => posterize(f, Number(a.levels), ch), RGB),
  'fx.brightness': filter(() => t('dialog.brightness.brightnessContrast'), [
    { key: 'brightness', type: 'slider', label: 'Brightness', min: -100, max: 100, default: 0 },
    { key: 'contrast', type: 'slider', label: 'Contrast', min: -100, max: 100, default: 0 },
  ], a => (f, ch) => brightnessContrast(f, Number(a.brightness), Number(a.contrast), ch), RGB),
  'fx.noise': filter(() => t('dialog.noise.title'), [
    { key: 'amount', type: 'slider', label: 'Amount', min: 0, max: 128, default: 24 },
    { key: 'mono', type: 'checkbox', label: 'Same for all channels', default: true },
    { key: 'seed', type: 'number', label: 'Random seed', min: 0, max: 1e9, default: 1 },
  ], a => (f, ch) => noise(f, Number(a.amount), !!a.mono, Number(a.seed), ch), RGB),
  'fx.pixelate': filter(() => t('dialog.pixelate.title'), [
    { key: 'size', type: 'slider', label: 'Block size, px', min: 2, max: 32, default: 2 },
  ], a => f => pixelate(f, Number(a.size))),
  'fx.offset': filter(() => t('common.offset'), [
    { key: 'x', type: 'number', label: 'Shift X, px (wraps around)', min: -4096, max: 4096, default: 0 },
    { key: 'y', type: 'number', label: 'Shift Y, px (wraps around)', min: -4096, max: 4096, default: 0 },
  ], a => f => offsetWrap(f, Number(a.x), Number(a.y))),

  'image.canvasSize': {
    params: [],
    apply: a => {
      const sprite = s();
      const w = Number(a.width), h = Number(a.height);
      const dx = w - sprite.width, dy = h - sprite.height;
      sprite.canvasSize(w, h, Math.floor(dx * Number(a.anchorX)), Math.floor(dy * Number(a.anchorY)));
      state.fit();
      state.save();
    },
  },
  'image.spriteSize': {
    params: [],
    apply: a => { s().scaleSprite(Number(a.width), Number(a.height)); state.fit(); state.save(); },
  },
  'image.colorMode': {
    params: [],
    apply: a => a.mode === s().colorMode ? undefined : convertSpriteColorMode(a.mode as ColorMode, a.dither as Dither, Number(a.amount) / 100),
  },
  'layer.properties': {
    params: [],
    apply: a => {
      const sprite = s();
      const i = Number(a.layer);
      const layer = sprite.layers[i];
      if (!layer) throw new Error(`No layer ${i}`);
      sprite.updateLayer(i, { name: String(a.name) || layer.name, opacity: Number(a.opacity) / 255, blend: a.blend as BlendMode });
      state.save();
    },
  },
  'anim.frameProperties': {
    params: [],
    apply: a => { s().setDuration(Number(a.duration), !!a.all); state.save(); },
  },
  'anim.goto': {
    params: [],
    apply: a => { const sprite = s(); sprite.dropFloating(); sprite.frame = Number(a.frame); sprite.range = null; },
  },
  'cel.properties': {
    params: [],
    apply: a => { s().setCelOpacity(Number(a.opacity) / 255); state.save(); },
  },
  'select.grow': {
    params: selectionSize('Grow by, px'),
    apply: a => s().mask && s().setMask(s().mask!.morph(Number(a.pixels)), 'Grow selection'),
  },
  'select.shrink': {
    params: selectionSize('Shrink by, px'),
    apply: a => s().mask && s().setMask(s().mask!.morph(-Number(a.pixels)), 'Shrink selection'),
  },
  'select.border': {
    params: selectionSize('Border width, px'),
    apply: a => s().mask && s().setMask(s().mask!.border(Number(a.pixels)), 'Selection outline'),
  },
};

/** The full argument schema of a built-in command (fixed and state-dependent parts), or undefined */
export function commandParams(id: string): FormSchema | undefined {
  const p = PARAMETRIC[id];
  if (!p) return undefined;
  const dyn = DYNAMIC_PARAMS[id]?.() ?? [];
  // A filter's own settings come first, its `scope` last
  const scope = p.params.filter(f => f.key === 'scope');
  return [...dyn, ...p.params.filter(f => f.key !== 'scope'), ...scope];
}
