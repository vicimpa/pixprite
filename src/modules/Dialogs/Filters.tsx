import { t } from "~/core/i18n";
import { ColorInput } from "~/ui/ColorInput";
import { Color } from "~/core/Color";
import {
  ALL_CHANNELS, KERNEL_PRESETS, adjustHsl, applyCurve, convolve, curveLut, dropShadow, invert, median, outline, replaceColor,
  brightnessContrast, noise, offsetWrap, pixelate, posterize,
  type Channels, type FilterTarget,
} from "~/core/Filters";
import { packRgba } from "~/core/Image";
import { state } from "~/core/State";
import { Button, Check, Input, Label, Muted, Range, Select } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row, Section } from "~/ui/Dialog";
import { useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import styled from "styled-components";

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
function filterTarget(data: Uint32Array, layer: number): FilterTarget {
  const { sprite } = state;
  return {
    w: sprite.width, h: sprite.height, data, mask: sprite.mask,
    tiledX: state.tiledX, tiledY: state.tiledY,
    lockAlpha: sprite.layers[layer]?.background,
  };
}

/** Applies a filter to the cels of `scope` as one undo step; used by the dialogs and by commands run with arguments */
export function applyFilter(title: string, run: (t: FilterTarget, ch: Channels) => Uint32Array, scope: Scope = 'cel', ch: Channels = ALL_CHANNELS) {
  const { sprite } = state;
  if (scope === 'range' && !sprite.range) scope = 'cel';
  sprite.applyFilter(title, data => run(filterTarget(data, sprite.layer), ch), scopeCels(scope));
  state.save();
}

const ChannelRow: FC<{ value: Channels; onChange: (c: Channels) => void; }> = ({ value, onChange }) => (
  <Row>
    <FieldLabel>{t('dialog.channelRow.channels')}</FieldLabel>
    {(['r', 'g', 'b', 'a'] as const).map(k => (
      <Label key={k}><Check checked={value[k]} onChange={e => onChange({ ...value, [k]: e.target.checked })} /> {k.toUpperCase()}</Label>
    ))}
  </Row>
);

/**
 * Shared filter dialog: live preview on the current cel, channel toggles, target cels,
 * selection-limited, background alpha untouched, one undo step for everything.
 */
const FilterDialog: FC<{
  close: () => void;
  title: string;
  run: (t: FilterTarget, ch: Channels) => Uint32Array;
  deps: unknown[];
  channels?: Channels | null;
  children?: ReactNode;
}> = ({ close, title, run, deps, channels: initial = ALL_CHANNELS, children }) => {
  const { sprite } = state;
  const [ch, setCh] = useState<Channels>(initial ?? ALL_CHANNELS);
  const [scope, setScope] = useState<Scope>(sprite.range ? 'range' : 'cel');
  const [preview, setPreview] = useState(true);

  // Live preview of the current cel, recomputed shortly after the last change
  useEffect(() => {
    if (!preview) { state.filterPreview = null; return; }
    if (!sprite.getCel()) return;
    const cel = sprite.canvasPixels();
    const t = setTimeout(() => {
      state.filterPreview = { layer: sprite.layer, frame: sprite.frame, data: run(filterTarget(cel, sprite.layer), ch) };
    }, 60);
    return () => clearTimeout(t);
  }, [preview, ch, ...deps]);
  useEffect(() => () => { state.filterPreview = null; }, []);

  return (
    <Dialog title={title} onClose={close} submitLabel={t('common.apply')} onSubmit={() => {
      state.filterPreview = null;
      applyFilter(title, run, scope, ch);
    }}>
      {children}
      {initial !== null && <ChannelRow value={ch} onChange={setCh} />}
      <Row>
        <FieldLabel>{t('dialog.filter.applyTo')}</FieldLabel>
        <Select value={scope} onChange={e => setScope(e.target.value as Scope)}>
          {SCOPES.filter(([s]) => s !== 'range' || sprite.range).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
        </Select>
      </Row>
      <Row>
        <Label><Check checked={preview} onChange={e => setPreview(e.target.checked)} /> {t('common.preview')}</Label>
        {sprite.mask && <Muted>{t('dialog.filter.limitedToTheSelection')}</Muted>}
      </Row>
    </Dialog>
  );
};

const ConvolutionDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [i, setI] = useState(0);
  const kernel = KERNEL_PRESETS[i];
  return (
    <FilterDialog close={close} title={t('dialog.convolution.title')} deps={[i]} run={(t, ch) => convolve(t, kernel, ch)}>
      <Row>
        <FieldLabel>{t('dialog.convolution.matrix')}</FieldLabel>
        <Select value={i} onChange={e => setI(+e.target.value)}>
          {KERNEL_PRESETS.map((k, n) => <option key={k.name} value={n}>{k.name} ({k.w}×{k.h})</option>)}
        </Select>
      </Row>
    </FilterDialog>
  );
};

const MedianDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [size, setSize] = useState(3);
  return (
    <FilterDialog close={close} title={t('dialog.median.despeckle')} deps={[size]} channels={{ r: true, g: true, b: true, a: false }} run={(t, ch) => median(t, size, size, ch)}>
      <Row>
        <FieldLabel>{t('dialog.median.window')}</FieldLabel>
        <Select value={size} onChange={e => setSize(+e.target.value)}>
          {[3, 5, 7, 9].map(n => <option key={n} value={n}>{n}×{n}</option>)}
        </Select>
      </Row>
    </FilterDialog>
  );
};

const CurveBox = styled.svg`
  background: var(--field);
  border: 1px solid var(--b1);
  cursor: crosshair;
  touch-action: none;
`;

/** Curve editor: click to add a point, drag to move, right click to remove */
const CurveEditor: FC<{ points: [number, number][]; onChange: (p: [number, number][]) => void; }> = ({ points, onChange }) => {
  const ref = useRef<SVGSVGElement>(null);
  const size = 200;
  const drag = useRef<number | null>(null);
  const toVal = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [
      Math.round(Math.max(0, Math.min(255, (e.clientX - r.left) / r.width * 255))),
      Math.round(Math.max(0, Math.min(255, 255 - (e.clientY - r.top) / r.height * 255))),
    ];
  };
  const lut = useMemo(() => curveLut(points), [points]);
  const path = Array.from(lut, (v, x) => `${x ? 'L' : 'M'}${x / 255 * size},${size - v / 255 * size}`).join('');
  return (
    <CurveBox
      ref={ref}
      width={size}
      height={size}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, y] = toVal(e);
        const hit = points.findIndex(([px, py]) => Math.abs(px - x) < 8 && Math.abs(py - y) < 8);
        if (e.button === 2) {
          if (hit >= 0 && points.length > 2) onChange(points.filter((_, i) => i !== hit));
          return;
        }
        if (hit >= 0) { drag.current = hit; return; }
        const next = [...points, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
        drag.current = next.findIndex(p => p[0] === x && p[1] === y);
        onChange(next);
      }}
      onPointerMove={e => {
        if (drag.current === null) return;
        const [x, y] = toVal(e);
        const next = points.slice();
        next[drag.current] = [x, y];
        onChange(next);
      }}
      onPointerUp={() => {
        drag.current = null;
        onChange(points.slice().sort((a, b) => a[0] - b[0]));
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <path d={`M0,${size}L${size},0`} stroke="var(--b2)" strokeDasharray="4 4" fill="none" />
      <path d={path} stroke="var(--accent)" strokeWidth={2} fill="none" />
      {points.map(([x, y], i) => (
        <rect key={i} x={x / 255 * size - 4} y={size - y / 255 * size - 4} width={8} height={8} fill="var(--fg)" stroke="var(--b1)" />
      ))}
    </CurveBox>
  );
};

const CurvesDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [points, setPoints] = useState<[number, number][]>([[0, 0], [255, 255]]);
  const lut = useMemo(() => curveLut(points), [points]);
  return (
    <FilterDialog close={close} title={t('dialog.curves.title')} deps={[lut]} channels={{ r: true, g: true, b: true, a: false }} run={(t, ch) => applyCurve(t, lut, ch)}>
      <CurveEditor points={points} onChange={setPoints} />
      <Row>
        <Muted>{t('dialog.curves.clickAddsAPoint')}</Muted>
        <Button type="button" onClick={() => setPoints([[0, 0], [255, 255]])}>{t('common.reset')}</Button>
      </Row>
    </FilterDialog>
  );
};

const InvertDialog: FC<{ close: () => void; }> = ({ close }) => (
  <FilterDialog close={close} title={t('dialog.invert.negative')} deps={[]} channels={{ r: true, g: true, b: true, a: false }} run={(t, ch) => invert(t, ch)} />
);

const ReplaceDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [from, setFrom] = useState(state.colorA.toHexString(false));
  const [to, setTo] = useState(state.colorB.toHexString(false));
  const [tol, setTol] = useState(0);
  return (
    <FilterDialog close={close} title={t('dialog.replace.replaceColor')} deps={[from, to, tol]}
      run={(t, ch) => replaceColor(t, toColor(Color.fromHex(from)), toColor(Color.fromHex(to)), tol, ch)}>
      <Row><FieldLabel>{t('dialog.replace.find')}</FieldLabel><ColorInput value={from} onChange={setFrom} /><Muted>{from}</Muted></Row>
      <Row><FieldLabel>{t('dialog.replace.replaceWith')}</FieldLabel><ColorInput value={to} onChange={setTo} /><Muted>{to}</Muted></Row>
      <Row><FieldLabel>{t('common.tolerance')}</FieldLabel><Range min={0} max={255} value={tol} onChange={e => setTol(+e.target.value)} /><Muted>{tol}</Muted></Row>
    </FilterDialog>
  );
};

const HslDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(0);
  const [light, setLight] = useState(0);
  return (
    <FilterDialog close={close} title={t('dialog.hsl.hueSaturation')} deps={[hue, sat, light]} channels={null} run={t => adjustHsl(t, hue, sat, light)}>
      <Row><FieldLabel>{t('dialog.hsl.hue')}</FieldLabel><Range min={-180} max={180} value={hue} onChange={e => setHue(+e.target.value)} /><Muted>{hue}°</Muted></Row>
      <Row><FieldLabel>{t('dialog.hsl.saturation')}</FieldLabel><Range min={-100} max={100} value={sat} onChange={e => setSat(+e.target.value)} /><Muted>{sat}%</Muted></Row>
      <Row><FieldLabel>{t('dialog.hsl.lightness')}</FieldLabel><Range min={-100} max={100} value={light} onChange={e => setLight(+e.target.value)} /><Muted>{light}%</Muted></Row>
    </FilterDialog>
  );
};

const OutlineDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [color, setColor] = useState(state.colorA.toHexString(false));
  const [outside, setOutside] = useState(true);
  const [diagonal, setDiagonal] = useState(false);
  return (
    <FilterDialog close={close} title={t('dialog.outline.title')} deps={[color, outside, diagonal]} channels={null}
      run={t => outline(t, toColor(Color.fromHex(color)), { outside, diagonal })}>
      <Row><FieldLabel>{t('common.color')}</FieldLabel><ColorInput value={color} onChange={setColor} /></Row>
      <Row>
        <FieldLabel>{t('dialog.outline.place')}</FieldLabel>
        <Select value={outside ? 'out' : 'in'} onChange={e => setOutside(e.target.value === 'out')}>
          <option value="out">{t('dialog.outline.aroundTheShape')}</option>
          <option value="in">{t('dialog.outline.onTheShapesEdge')}</option>
        </Select>
      </Row>
      <Label><Check checked={diagonal} onChange={e => setDiagonal(e.target.checked)} /> {t('dialog.outline.includeDiagonalNeighbours')}</Label>
    </FilterDialog>
  );
};

const ShadowDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [color, setColor] = useState('#000000');
  const [alpha, setAlpha] = useState(160);
  const [dx, setDx] = useState(1);
  const [dy, setDy] = useState(1);
  return (
    <FilterDialog close={close} title={t('dialog.shadow.dropShadow')} deps={[color, alpha, dx, dy]} channels={null}
      run={t => dropShadow(t, dx, dy, toColor(Color.fromHex(color + alpha.toString(16).padStart(2, '0'))))}>
      <Row><FieldLabel>{t('common.color')}</FieldLabel><ColorInput value={color} onChange={setColor} /></Row>
      <Row><FieldLabel>{t('common.opacity')}</FieldLabel><Range min={0} max={255} value={alpha} onChange={e => setAlpha(+e.target.value)} /></Row>
      <Row>
        <FieldLabel>{t('common.offset')}</FieldLabel>
        <Input type="number" value={dx} onChange={e => setDx(Math.round(+e.target.value))} />
        <Input type="number" value={dy} onChange={e => setDy(Math.round(+e.target.value))} />
      </Row>
    </FilterDialog>
  );
};

const PosterizeDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [levels, setLevels] = useState(4);
  return (
    <FilterDialog close={close} title={t('dialog.posterize.title')} deps={[levels]} channels={{ r: true, g: true, b: true, a: false }} run={(t, ch) => posterize(t, levels, ch)}>
      <Row><FieldLabel>{t('dialog.posterize.levels')}</FieldLabel><Range min={2} max={32} value={levels} onChange={e => setLevels(+e.target.value)} /><Muted>{levels}</Muted></Row>
    </FilterDialog>
  );
};

const BrightnessDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  return (
    <FilterDialog close={close} title={t('dialog.brightness.brightnessContrast')} deps={[bright, contrast]} channels={{ r: true, g: true, b: true, a: false }}
      run={(t, ch) => brightnessContrast(t, bright, contrast, ch)}>
      <Row><FieldLabel>{t('dialog.brightness.title')}</FieldLabel><Range min={-100} max={100} value={bright} onChange={e => setBright(+e.target.value)} /><Muted>{bright}</Muted></Row>
      <Row><FieldLabel>{t('dialog.brightness.contrast')}</FieldLabel><Range min={-100} max={100} value={contrast} onChange={e => setContrast(+e.target.value)} /><Muted>{contrast}</Muted></Row>
    </FilterDialog>
  );
};

const NoiseDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [amount, setAmount] = useState(24);
  const [mono, setMono] = useState(true);
  const [seed, setSeed] = useState(1);
  return (
    <FilterDialog close={close} title={t('dialog.noise.title')} deps={[amount, mono, seed]} channels={{ r: true, g: true, b: true, a: false }}
      run={(t, ch) => noise(t, amount, mono, seed, ch)}>
      <Row><FieldLabel>{t('common.amount')}</FieldLabel><Range min={0} max={128} value={amount} onChange={e => setAmount(+e.target.value)} /><Muted>{amount}</Muted></Row>
      <Row>
        <Label><Check checked={mono} onChange={e => setMono(e.target.checked)} /> {t('dialog.noise.sameForAllChannels')}</Label>
        <Button type="button" onClick={() => setSeed(s => s + 1)}>{t('dialog.noise.reroll')}</Button>
      </Row>
    </FilterDialog>
  );
};

const PixelateDialog: FC<{ close: () => void; }> = ({ close }) => {
  const [size, setSize] = useState(2);
  return (
    <FilterDialog close={close} title={t('dialog.pixelate.title')} deps={[size]} channels={null} run={t => pixelate(t, size)}>
      <Row><FieldLabel>{t('dialog.pixelate.blockSize')}</FieldLabel><Range min={2} max={32} value={size} onChange={e => setSize(+e.target.value)} /><Muted>{size}px</Muted></Row>
    </FilterDialog>
  );
};

/** Shift with wrap-around: handy for checking that a tile repeats seamlessly */
const OffsetDialog: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const b = sprite.mask?.bounds ?? { w: sprite.width, h: sprite.height };
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  return (
    <FilterDialog close={close} title={t('common.offset')} deps={[dx, dy]} channels={null} run={t => offsetWrap(t, dx, dy)}>
      <Row>
        <FieldLabel>X</FieldLabel>
        <Input type="number" value={dx} onChange={e => setDx(Math.round(+e.target.value))} />
        <FieldLabel>Y</FieldLabel>
        <Input type="number" value={dy} onChange={e => setDy(Math.round(+e.target.value))} />
      </Row>
      <Row>
        <Button type="button" onClick={() => { setDx(Math.floor(b.w / 2)); setDy(Math.floor(b.h / 2)); }}>{t('dialog.offset.halfSize')}</Button>
        <Button type="button" onClick={() => { setDx(0); setDy(0); }}>{t('common.reset')}</Button>
        <Muted>{t('dialog.offset.pixelsLeavingOneEdge')}</Muted>
      </Row>
    </FilterDialog>
  );
};

export const filterDialogs = {
  posterize: () => openDialog(close => <PosterizeDialog close={close} />),
  brightness: () => openDialog(close => <BrightnessDialog close={close} />),
  noise: () => openDialog(close => <NoiseDialog close={close} />),
  pixelate: () => openDialog(close => <PixelateDialog close={close} />),
  offset: () => openDialog(close => <OffsetDialog close={close} />),
  convolution: () => openDialog(close => <ConvolutionDialog close={close} />),
  median: () => openDialog(close => <MedianDialog close={close} />),
  curves: () => openDialog(close => <CurvesDialog close={close} />),
  invert: () => openDialog(close => <InvertDialog close={close} />),
  replaceColor: () => openDialog(close => <ReplaceDialog close={close} />),
  hsl: () => openDialog(close => <HslDialog close={close} />),
  outline: () => openDialog(close => <OutlineDialog close={close} />),
  shadow: () => openDialog(close => <ShadowDialog close={close} />),
};

export { Section };
