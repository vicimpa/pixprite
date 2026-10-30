import { VirtualList } from "~/ui/VirtualList";
import { ColorInput as ColorField } from "~/ui/ColorInput";
import { Color } from "~/core/Color";
import { COMMANDS, commandLabel } from "~/core/Commands";
import { addDocuments, asepriteLosses, exportFile, exportFrames, pickFile, saveProject, sheetOptions, type ExportOptions, type ProjectFormat } from "~/core/Files";
import { buildSheet, defaultTemplate, type SheetType, type TrimMode } from "~/core/SpriteSheet";
import { BLEND_MODES, cleanInfo, Sprite, tagsByName, type BlendMode, type TagDirection } from "~/core/Sprite";
import { DEFAULT_PREFS, UI_FONTS, state, type Prefs } from "~/core/State";
import { prettyCombo } from "~/core/Hotkeys";
import { moveGuide } from "~/core/Reference";
import { Button, Check, Input, Label, Muted, Range, Select } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row, Section } from "~/ui/Dialog";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import styled from "styled-components";
import { keyNames, LANGUAGES, t } from "~/core/i18n";
import { THEMES } from "~/core/Themes";
import type { Rect } from "~/core/Image";
import { InfoFields } from "~/modules/ProjectInfo";

import { loadDialogPrefs, saveDialogPrefs, num, Field, NumberField } from "./fields";

const ColorInput: FC<{ value: string; onChange: (v: string) => void; }> = ({ value, onChange }) => (
  <ColorField value={value.slice(0, 7)} onChange={onChange} />
);

const ANCHORS = [0, 0.5, 1];

const AnchorGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, var(--row));
  gap: 2px;
`;

/** Margins and size stay in sync both ways; negative margins crop */
const CanvasSize: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const W = sprite.width, H = sprite.height;
  const [m, setM] = useState({ l: 0, t: 0, r: 0, b: 0 });
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const w = W + m.l + m.r, h = H + m.t + m.b;
  const fromSize = (nw: number, nh: number, a = anchor) => {
    const dx = nw - W, dy = nh - H;
    const l = Math.floor(dx * a[0]), t = Math.floor(dy * a[1]);
    setM({ l, t, r: dx - l, b: dy - t });
  };
  return (
    <Dialog title={t('dialog.canvasSize.title')} onClose={close} onSubmit={() => {
      sprite.canvasSize(Math.max(1, w), Math.max(1, h), m.l, m.t);
      state.fit();
      state.save();
    }}>
      <Muted>Current: {W}×{H}. Pixels are not scaled; negative margins crop.</Muted>
      <Row>
        <FieldLabel>{t('common.size')}</FieldLabel>
        <Input type="number" min={1} value={w} onChange={e => fromSize(Math.max(1, +e.target.value), h)} />
        ×
        <Input type="number" min={1} value={h} onChange={e => fromSize(w, Math.max(1, +e.target.value))} />
      </Row>
      <Row>
        <FieldLabel>{t('dialog.canvasSize.anchor')}</FieldLabel>
        <AnchorGrid>
          {ANCHORS.map(y => ANCHORS.map(x => (
            <Button type="button" key={`${x}:${y}`} $square $active={anchor[0] === x && anchor[1] === y}
              onClick={() => { setAnchor([x, y]); fromSize(w, h, [x, y]); }} />
          )))}
        </AnchorGrid>
      </Row>
      <Row>
        <FieldLabel>{t('dialog.canvasSize.margins')}</FieldLabel>
        {(['l', 't', 'r', 'b'] as const).map(k => (
          <Label key={k}>
            {{ l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }[k]}
            <Input type="number" value={m[k]} onChange={e => setM({ ...m, [k]: Math.round(+e.target.value) })} />
          </Label>
        ))}
      </Row>
      <Row>
        <FieldLabel>{t('common.quick')}</FieldLabel>
        <Button type="button" onClick={() => {
          const b = sprite.mask?.bounds;
          if (b) setM({ l: -b.x, t: -b.y, r: b.x + b.w - W, b: b.y + b.h - H });
        }} disabled={!sprite.mask}>{t('dialog.canvasSize.fitSelection')}</Button>
        <Button type="button" onClick={() => setM({ l: 1, t: 1, r: 1, b: 1 })}>+1 all sides</Button>
        <Button type="button" onClick={() => setM({ l: 0, t: 0, r: 0, b: 0 })}>{t('common.reset')}</Button>
      </Row>
    </Dialog>
  );
};

const SpriteSize: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const [w, setW] = useState(sprite.width);
  const [h, setH] = useState(sprite.height);
  const [lock, setLock] = useState(true);
  const ratio = sprite.width / sprite.height;
  const setWidth = (v: number) => { setW(v); if (lock) setH(Math.max(1, Math.round(v / ratio))); };
  const setHeight = (v: number) => { setH(v); if (lock) setW(Math.max(1, Math.round(v * ratio))); };
  return (
    <Dialog title={t('dialog.spriteSize.scaleImage')} onClose={close} onSubmit={() => {
      sprite.scaleSprite(w, h);
      state.fit();
      state.save();
    }}>
      <Muted>{t('dialog.spriteSize.nearestNeighbourScalingKeeps')}</Muted>
      <Row>
        <FieldLabel>{t('common.width')}</FieldLabel>
        <Input type="number" min={1} value={w} onChange={e => setWidth(Math.max(1, +e.target.value))} /><Muted>px</Muted>
        <Input type="number" min={1} value={Math.round(w / sprite.width * 100)} onChange={e => setWidth(Math.max(1, Math.round(sprite.width * +e.target.value / 100)))} /><Muted>%</Muted>
      </Row>
      <Row>
        <FieldLabel>{t('common.height')}</FieldLabel>
        <Input type="number" min={1} value={h} onChange={e => setHeight(Math.max(1, +e.target.value))} /><Muted>px</Muted>
        <Input type="number" min={1} value={Math.round(h / sprite.height * 100)} onChange={e => setHeight(Math.max(1, Math.round(sprite.height * +e.target.value / 100)))} /><Muted>%</Muted>
      </Row>
      <Row>
        <FieldLabel>{t('common.quick')}</FieldLabel>
        {[0.5, 2, 3, 4].map(k => (
          <Button type="button" key={k} onClick={() => { setW(Math.round(sprite.width * k)); setH(Math.round(sprite.height * k)); }}>×{k}</Button>
        ))}
      </Row>
      <Label><Check checked={lock} onChange={e => setLock(e.target.checked)} /> {t('dialog.spriteSize.keepProportions')}</Label>
    </Dialog>
  );
};

const SpriteProperties: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const [name, setName] = useState(sprite.name);
  const [info, setInfo] = useState(sprite.info);
  const total = sprite.frames.reduce((s, f) => s + f.duration, 0);
  const submit = () => {
    const nextName = name || 'untitled';
    if (sprite.name !== nextName) { sprite.name = nextName; sprite.touch(); }
    if (JSON.stringify(cleanInfo(info)) !== JSON.stringify(sprite.info)) sprite.setInfo(info);
    state.save();
  };
  return (
    <Dialog title={t('dialog.spriteProperties.imageProperties')} width={Math.min(420, innerWidth - 32)} onClose={close} onSubmit={submit}>
      <Field label={t('common.name')}><Input value={name} style={{ width: 160 }} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t('common.size')}><span>{sprite.width}×{sprite.height}</span></Field>
      <Field label={t('common.layers')}><span>{sprite.layers.length}</span></Field>
      <Field label={t('common.frames')}><span>{sprite.frames.length} · {(total / 1000).toFixed(2)}s</span></Field>
      <Section>{t('info.section')}</Section>
      <InfoFields value={info} onChange={setInfo} />
    </Dialog>
  );
};

const BLEND_NAMES: Record<BlendMode, string> = {
  'source-over': 'blend.normal', multiply: 'blend.multiply', screen: 'blend.screen', overlay: 'blend.overlay', darken: 'blend.darken',
  lighten: 'blend.lighten', 'color-dodge': 'blend.dodge', 'color-burn': 'blend.burn', 'hard-light': 'blend.hardLight',
  'soft-light': 'blend.softLight', difference: 'blend.difference', exclusion: 'blend.exclusion', hue: 'blend.hue',
  saturation: 'blend.saturation', color: 'blend.color', luminosity: 'blend.luminosity',
};

const LayerProperties: FC<{ close: () => void; index: number; }> = ({ close, index }) => {
  const { sprite } = state;
  const layer = sprite.layers[index];
  const [name, setName] = useState(layer.name);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 255));
  const [blend, setBlend] = useState<BlendMode>(layer.blend);
  const [clip, setClip] = useState(!!layer.clip);
  const [lockAlpha, setLockAlpha] = useState(!!layer.lockAlpha);
  const [note, setNote] = useState(layer.userData?.text ?? '');
  const ref = layer.reference;
  const [refX, setRefX] = useState(String(Math.round(ref?.x ?? 0)));
  const [refY, setRefY] = useState(String(Math.round(ref?.y ?? 0)));
  const [refScale, setRefScale] = useState(String(Math.round((ref?.scale ?? 1) * 1000) / 10));
  return (
    <Dialog title={t('common.layerProperties')} onClose={close} onSubmit={() => {
      const reference = ref && { ...ref, x: num(refX, ref.x), y: num(refY, ref.y), scale: Math.max(0.001, num(refScale, ref.scale * 100) / 100) };
      sprite.updateLayer(index, { name: name || layer.name, opacity: opacity / 255, blend, clip, lockAlpha, userData: note ? { ...layer.userData, text: note } : layer.userData?.color ? { color: layer.userData.color } : undefined, ...(reference ? { reference } : {}) });
      state.save();
    }}>
      <Field label={t('common.name')}><Input value={name} style={{ width: 160 }} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t('common.note')}><Input value={note} style={{ width: 160 }} onChange={e => setNote(e.target.value)} /></Field>
      <Field label={t('dialog.layerProperties.blend')}>
        <Select value={blend} onChange={e => setBlend(e.target.value as BlendMode)}>
          {BLEND_MODES.map(m => <option key={m} value={m}>{t(BLEND_NAMES[m])}</option>)}
        </Select>
      </Field>
      <Field label={t('common.opacity')}>
        <Range min={0} max={255} value={opacity} onChange={e => setOpacity(+e.target.value)} />
        <Input type="number" min={0} max={255} value={opacity} onChange={e => setOpacity(Math.max(0, Math.min(255, +e.target.value)))} />
      </Field>
      {!layer.group && !layer.background && !ref && <Label><Check checked={lockAlpha} onChange={e => setLockAlpha(e.target.checked)} /> {t('dialog.layerProperties.lockAlpha')}</Label>}
      {!layer.background && !ref && <Label><Check checked={clip} onChange={e => setClip(e.target.checked)} /> {t('dialog.layerProperties.clipToLayerBelow')}</Label>}
      {ref && <>
        <Muted>{t('dialog.layerProperties.referenceImageShownIn')}</Muted>
        <NumberField label="X" value={refX} onChange={setRefX} />
        <NumberField label="Y" value={refY} onChange={setRefY} />
        <NumberField label={t('common.scale')} value={refScale} onChange={setRefScale} min={1} step={10} suffix="%" />
      </>}
    </Dialog>
  );
};

const FrameProperties: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const sel = sprite.selectedFrames;
  const [ms, setMs] = useState(String(sprite.frames[sprite.frame].duration));
  const [all, setAll] = useState(false);
  const [mode, setMode] = useState<'set' | 'multiply' | 'add' | 'stretch'>('set');
  const [factor, setFactor] = useState('1');
  const [delta, setDelta] = useState('10');
  const tagIndex = sprite.tags.findIndex(t => t === sprite.tagAt());
  const tag = sprite.tags[tagIndex];
  const tagTotal = tag ? sprite.frames.slice(tag.from, tag.to + 1).reduce((a, f) => a + f.duration, 0) : 0;
  const [total, setTotal] = useState(String(tagTotal));
  return (
    <Dialog title={t('dialog.frameProperties.frameTiming')} onClose={close} onSubmit={() => {
      if (mode === 'set') sprite.setDuration(Math.max(10, num(ms, 100) | 0), all);
      else if (mode === 'multiply') sprite.changeDurations('multiply', Math.max(0.01, num(factor, 1)), all);
      else if (mode === 'add') sprite.changeDurations('add', num(delta, 0) | 0, all);
      else if (tag) sprite.stretchTag(tagIndex, Math.max(10, num(total, tagTotal) | 0));
      state.save();
    }}>
      <Field label={t('dialog.frameProperties.change')}>
        <Select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="set">{t('dialog.frameProperties.setDuration')}</option>
          <option value="multiply">{t('dialog.frameProperties.multiplyDuration')}</option>
          <option value="add">{t('dialog.frameProperties.addToDuration')}</option>
          {tag && <option value="stretch">{t('dialog.frameProperties.stretchTagToLength')}</option>}
        </Select>
      </Field>
      {mode === 'stretch' ? <>
        <Muted>{tag?.name}</Muted>
        <NumberField label={t('dialog.frameProperties.tagLength')} value={total} onChange={setTotal} min={10} step={10} suffix="ms" />
      </> : <>
        <Muted>{all ? 'All frames' : sel.length > 1 ? `Frames ${sel[0] + 1}–${sel[sel.length - 1] + 1}` : `Frame ${sprite.frame + 1}`}</Muted>
        {mode === 'set' && <>
          <NumberField label={t('dialog.frameProperties.duration')} value={ms} onChange={setMs} min={10} step={10} suffix="ms" />
          <Field label={t('dialog.frameProperties.orFps')}>
            {[6, 8, 10, 12, 15, 24].map(fps => (
              <Button type="button" key={fps} onClick={() => setMs(String(Math.round(1000 / fps)))}>{fps}</Button>
            ))}
          </Field>
        </>}
        {mode === 'multiply' && <NumberField label={t('dialog.frameProperties.factor')} value={factor} onChange={setFactor} min={0.01} step={0.1} suffix="×" />}
        {mode === 'add' && <NumberField label={t('dialog.frameProperties.add')} value={delta} onChange={setDelta} step={10} suffix="ms" />}
        <Label><Check checked={all} onChange={e => setAll(e.target.checked)} /> {t('dialog.frameProperties.applyToEveryFrame')}</Label>
      </>}
    </Dialog>
  );
};

const TweenFrames: FC<{ close: () => void; }> = ({ close }) => {
  const [count, setCount] = useState('3');
  const [ease, setEase] = useState(false);
  return (
    <Dialog title={t('dialog.tweenFrames.inBetweenFrames')} onClose={close} onSubmit={() => {
      if (state.sprite.tweenFrames(Math.max(1, Math.min(256, num(count, 3) | 0)), ease)) state.save();
    }}>
      <Muted>{t('dialog.tweenFrames.selectTwoFramesOn')}</Muted>
      <NumberField label={t('dialog.tweenFrames.framesToInsert')} value={count} onChange={setCount} min={1} max={256} />
      <Label><Check checked={ease} onChange={e => setEase(e.target.checked)} /> {t('dialog.tweenFrames.easeInOut')}</Label>
    </Dialog>
  );
};

const TagProperties: FC<{ close: () => void; index: number; }> = ({ close, index }) => {
  const { sprite } = state;
  const tag = sprite.tags[index];
  const [name, setName] = useState(tag.name);
  const [from, setFrom] = useState(String(tag.from + 1));
  const [to, setTo] = useState(String(tag.to + 1));
  const [color, setColor] = useState(tag.color);
  const [direction, setDirection] = useState<TagDirection>(tag.direction);
  const [repeat, setRepeat] = useState(String(tag.repeat ?? 0));
  const [note, setNote] = useState(tag.userData?.text ?? '');
  const max = sprite.frames.length;
  return (
    <Dialog title={t('dialog.tagProperties.tag')} onClose={close}
      extraButtons={<Button type="button" onClick={() => { sprite.removeTag(index); close(); }}>{t('common.deleteTag')}</Button>}
      onSubmit={() => {
        const a = Math.max(1, Math.min(max, num(from, 1) | 0)) - 1;
        const b = Math.max(1, Math.min(max, num(to, 1) | 0)) - 1;
        sprite.updateTag(index, { name, color, direction, userData: note ? { text: note } : undefined, repeat: Math.max(0, Math.min(999, num(repeat, 0) | 0)), from: Math.min(a, b), to: Math.max(a, b) });
        state.save();
      }}>
      <Field label={t('common.name')}><Input value={name} style={{ width: 140 }} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t('common.note')}><Input value={note} style={{ width: 140 }} onChange={e => setNote(e.target.value)} /></Field>
      <NumberField label={t('dialog.tagProperties.fromFrame')} value={from} onChange={setFrom} min={1} max={max} />
      <NumberField label={t('dialog.tagProperties.toFrame')} value={to} onChange={setTo} min={1} max={max} />
      <Field label={t('common.color')}><ColorInput value={color} onChange={setColor} /></Field>
      <Field label={t('dialog.tagProperties.playback')}>
        <Select value={direction} onChange={e => setDirection(e.target.value as TagDirection)}>
          <option value="forward">{t('dialog.tagProperties.forward')}</option>
          <option value="reverse">{t('dialog.tagProperties.backward')}</option>
          <option value="pingpong">{t('dialog.tagProperties.backAndForth')}</option>
          <option value="pingpong-reverse">{t('dialog.tagProperties.backAndForthReversed')}</option>
        </Select>
      </Field>
      <NumberField label={t('dialog.tagProperties.repeat')} value={repeat} onChange={setRepeat} min={0} max={999} suffix={t('dialog.tagProperties.times0Forever')} />
    </Dialog>
  );
};

const GotoFrame: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const [n, setN] = useState(String(sprite.frame + 1));
  return (
    <Dialog title={t('common.goToFrame')} onClose={close} submitLabel={t('dialog.gotoFrame.go')} onSubmit={() => {
      sprite.dropFloating();
      sprite.frame = Math.max(0, Math.min(sprite.frames.length - 1, (num(n, 1) | 0) - 1));
      sprite.range = null;
    }}>
      <NumberField label={t('common.frame')} value={n} onChange={setN} min={1} max={sprite.frames.length} suffix={`of ${sprite.frames.length}`} />
    </Dialog>
  );
};

const GuidePosition: FC<{ close: () => void; index: number; }> = ({ close, index }) => {
  const g = state.guides[index];
  const [pos, setPos] = useState(String(g?.pos ?? 0));
  if (!g) return null;
  return (
    <Dialog title={t('dialog.guidePosition.title')} onClose={close} onSubmit={() => moveGuide(index, Math.round(num(pos, g.pos)))}>
      <NumberField label={g.axis === 'x' ? 'X' : 'Y'} value={pos} onChange={setPos} suffix="px" />
    </Dialog>
  );
};

const CelProperties: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const [opacity, setOpacity] = useState(Math.round((sprite.current?.celOpacity[sprite.frame] ?? 1) * 255));
  const count = sprite.selectedCels.length;
  return (
    <Dialog title={t('dialog.celProperties.celOpacity')} onClose={close} onSubmit={() => { sprite.setCelOpacity(opacity / 255); state.save(); }}>
      <Muted>{count > 1 ? `${count} cels` : `Layer "${sprite.current?.name}", frame ${sprite.frame + 1}`}</Muted>
      <Field label={t('common.opacity')}>
        <Range min={0} max={255} value={opacity} onChange={e => setOpacity(+e.target.value)} />
        <Input type="number" min={0} max={255} value={opacity} onChange={e => setOpacity(Math.max(0, Math.min(255, +e.target.value)))} />
      </Field>
    </Dialog>
  );
};

const SaveAs: FC<{ close: () => void; }> = ({ close }) => {
  const [name, setName] = useState(state.sprite.name);
  const [format, setFormat] = useState<ProjectFormat>('pixprite');
  return (
    <Dialog title={t('dialog.saveAs.downloadACopy')} onClose={close} submitLabel={t('dialog.saveAs.download')} onSubmit={() => { void saveProject(name || 'untitled', format).catch(error => state.showTip(`${t('msg.exportFailed')}: ${error instanceof Error ? error.message : error}`, 4000)); }}>
      <Field label={t('common.fileName')}><Input value={name} style={{ width: 160 }} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t('common.format')}>
        <Select value={format} onChange={e => setFormat(e.target.value as ProjectFormat)}>
          <option value="pixprite">{t('dialog.saveAs.pixpriteProjectPixprite')}</option>
          <option value="aseprite">{t('dialog.saveAs.asepriteFileAseprite')}</option>
        </Select>
      </Field>
      {format === 'aseprite' && asepriteLosses(state.sprite).map(x => <Muted key={x}>{t('dialog.saveAs.notSavedInThis')}: {x}</Muted>)}
    </Dialog>
  );
};

type SheetPrefs = NonNullable<ExportOptions['sheet']>;

const SHEET_DEFAULTS: SheetPrefs = {
  type: 'rows', count: 0, splitLayers: false, splitTags: false, border: 0, spacing: 0, inner: 0,
  trim: 'none', trimByGrid: false, extrude: false, mergeDuplicates: false, ignoreEmpty: false, powerOfTwo: false, template: '',
};

/** Live, debounced preview of the sheet being configured */
const SheetPreview: FC<{ opts: ExportOptions; }> = ({ opts }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState('');
  const key = JSON.stringify(opts);
  useEffect(() => {
    const timer = setTimeout(() => {
      const sheet = buildSheet(sheetOptions(opts, exportFrames(opts.tag)), { sprite: state.sprite, prefs: state.prefs });
      const can = ref.current;
      if (!can) return;
      // Fit into the box with whole-number zoom when it fits
      const box = 380, k = Math.min(8, box / Math.max(sheet.width, sheet.height));
      const z = k >= 1 ? Math.floor(k) : k;
      can.width = Math.max(1, Math.round(sheet.width * z));
      can.height = Math.max(1, Math.round(sheet.height * z));
      const ctx = can.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet.canvas, 0, 0, can.width, can.height);
      const unique = new Set(sheet.samples.map(s => s.slot)).size;
      const text = `${sheet.width * opts.scale}×${sheet.height * opts.scale}px · ${sheet.samples.length} ${t('common.framesLower')}${unique < sheet.samples.length ? ` · ${unique} ${t('dialog.sheetPreview.uniqueImages')}` : ''}`;
      setInfo(text);
      // File size of the PNG that will be written (at 1×; scaling adds little to PNG size)
      sheet.canvas.convertToBlob({ type: 'image/png' }).then(b => setInfo(`${text} · ~${b.size < 1024 ? `${b.size} B` : `${(b.size / 1024).toFixed(1)} KB`}`), () => { });
    }, 120);
    return () => clearTimeout(timer);
  }, [key]);
  return <>
    <div style={{ maxHeight: 400, overflow: 'auto', background: 'repeating-conic-gradient(#0000 0 25%, #0002 0 50%) 0 0 / 12px 12px', border: '1px solid var(--b1)', padding: 4 }}>
      <canvas ref={ref} style={{ display: 'block', imageRendering: 'pixelated' }} />
    </div>
    <Muted>{info}</Muted>
  </>;
};

const ExportImage: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const last = loadDialogPrefs('export', {
    kind: (sprite.frames.length > 1 ? 'gif' : 'png') as ExportOptions['kind'],
    scale: 1, json: 'none' as 'none' | 'hash' | 'array', currentLayer: false, loop: true,
    sheet: SHEET_DEFAULTS,
    area: undefined as ExportOptions['area'],
    trim: false, split: 'none' as NonNullable<ExportOptions['split']>,
    icoSizes: [16, 32, 48] as number[],
  });
  const [o, setO] = useState({ ...last, sheet: { ...SHEET_DEFAULTS, ...last.sheet } });
  const [tag, setTag] = useState(sprite.range ? -1 : -2);
  const [name, setName] = useState(sprite.name);
  const set = (patch: Partial<typeof o>) => setO({ ...o, ...patch });
  const sh = o.sheet;
  const setSh = (patch: Partial<SheetPrefs>) => setO({ ...o, sheet: { ...sh, ...patch } });
  const opts: ExportOptions = { ...o, name, tag: tag === -2 ? undefined : tag };
  const frameCount = exportFrames(opts.tag).length;
  return (
    <Dialog title={t('dialog.exportImage.export')} onClose={close} submitLabel={t('dialog.exportImage.export')} width={o.kind === 'sheet' ? 820 : 420} onSubmit={() => {
      saveDialogPrefs('export', o);
      exportFile(opts);
    }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: '0 0 380px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label={t('common.fileName')}><Input value={name} style={{ width: 180 }} onChange={e => setName(e.target.value)} /></Field>
          <Field label={t('common.format')}>
            <Select value={o.kind} onChange={e => set({ kind: e.target.value as ExportOptions['kind'] })}>
              <option value="png">{t('dialog.exportImage.pngCurrentFrame')}</option>
              <option value="gif">{t('dialog.exportImage.gifAnimation')}</option>
              <option value="sheet">{t('dialog.exportImage.pngSpriteSheet')}</option>
              <option value="frames">{t('dialog.exportImage.pngPerFrameNumbered')}</option>
              <option value="zip">{t('dialog.exportImage.pngSequenceInA')}</option>
              <option value="apng">{t('dialog.exportImage.animatedPngApng')}</option>
              {typeof MediaRecorder !== 'undefined' && <option value="webm">{t('dialog.exportImage.webmVideo')}</option>}
              <option value="ico">{t('dialog.exportImage.iconIcoCurrentFrame')}</option>
              <option value="cur">{t('dialog.exportImage.cursorCurCurrentFrame')}</option>
            </Select>
          </Field>
          {(o.kind === 'ico' || o.kind === 'cur') && (
            <Field label={t('dialog.exportImage.sizes')}>
              <Input value={(o.icoSizes ?? [16, 32, 48]).join(', ')} style={{ width: 180 }} title={t('dialog.exportImage.squareSizesInPixels')}
                onChange={e => set({ icoSizes: e.target.value.split(/[^\d]+/).map(Number).filter(n => n >= 1 && n <= 256) })} />
            </Field>
          )}
          {o.kind !== 'png' && o.kind !== 'ico' && o.kind !== 'cur' && (
            <Field label={t('common.frames')}>
              <Select value={tag} onChange={e => setTag(+e.target.value)}>
                <option value={-2}>All ({sprite.frames.length})</option>
                {sprite.range && <option value={-1}>Selected in timeline ({sprite.selectedFrames.length})</option>}
                {sprite.tags.map((t, i) => <option key={i} value={i}>Tag: {t.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label={t('dialog.exportImage.area')}>
            <Select value={o.area?.kind === 'slice' ? `slice:${o.area.index}` : o.area?.kind ?? 'canvas'} onChange={e => {
              const v = e.target.value;
              set({ area: v === 'canvas' ? undefined : v === 'selection' ? { kind: 'selection' } : { kind: 'slice', index: +v.split(':')[1] } });
            }}>
              <option value="canvas">{t('dialog.exportImage.wholeCanvas')}</option>
              {sprite.mask && <option value="selection">{t('dialog.exportImage.selectionBounds')}</option>}
              {sprite.slices.map((sl, i) => <option key={i} value={`slice:${i}`}>Slice: {sl.name}</option>)}
            </Select>
          </Field>
          <Field label={t('common.layers')}>
            <Select value={o.currentLayer ? 'current' : 'visible'} onChange={e => set({ currentLayer: e.target.value === 'current' })}>
              <option value="visible">{t('dialog.exportImage.allVisibleLayers')}</option>
              <option value="current">Only "{sprite.current?.name}"</option>
            </Select>
          </Field>
          <NumberField label={t('common.scale')} value={String(o.scale)} onChange={v => set({ scale: Math.max(1, Math.min(32, num(v, 1) | 0)) })} min={1} max={32} suffix={`× → ${sprite.width * o.scale}×${sprite.height * o.scale}`} />
          <Field label={t('dialog.exportImage.separateFiles')}>
            <Select value={o.split} onChange={e => set({ split: e.target.value as typeof o.split })} title={t('dialog.exportImage.oneExportPerLayer')}>
              <option value="none">{t('dialog.exportImage.no')}</option>
              <option value="layers">{t('dialog.exportImage.eachVisibleLayer')}</option>
              <option value="selectedLayers">{t('dialog.exportImage.eachSelectedLayer')}</option>
              <option value="tags" disabled={!sprite.tags.length}>{t('dialog.exportImage.eachTag')}</option>
              <option value="slices" disabled={!sprite.slices.length}>{t('dialog.exportImage.eachSlice')}</option>
            </Select>
          </Field>
          {o.kind !== 'sheet' && <Label title={t('dialog.exportImage.cropsToTheUsed')}><Check checked={o.trim} onChange={e => set({ trim: e.target.checked })} /> {t('dialog.exportImage.trimToContent')}</Label>}
          {(o.kind === 'gif' || o.kind === 'apng') && <Label><Check checked={o.loop} onChange={e => set({ loop: e.target.checked })} /> {t('dialog.exportImage.loopForever')}</Label>}
          {o.kind === 'sheet' && <>
            <Section>{t('dialog.exportImage.layout')}</Section>
            <Field label={t('common.arrange')}>
              <Select value={sh.type} onChange={e => setSh({ type: e.target.value as SheetType })}>
                <option value="horizontal">{t('dialog.exportImage.oneRow')}</option>
                <option value="vertical">{t('dialog.exportImage.oneColumn')}</option>
                <option value="rows">{t('dialog.exportImage.rows')}</option>
                <option value="columns">{t('dialog.exportImage.columns')}</option>
                <option value="packed">{t('dialog.exportImage.packedSmallestTexture')}</option>
              </Select>
              {(sh.type === 'rows' || sh.type === 'columns') && (
                <Input type="number" min={0} value={sh.count} title={sh.type === 'rows' ? 'Cells per row (0 = automatic)' : 'Cells per column (0 = automatic)'} onChange={e => setSh({ count: Math.max(0, +e.target.value | 0) })} />
              )}
            </Field>
            <Label><Check checked={sh.splitLayers} onChange={e => setSh({ splitLayers: e.target.checked })} /> {t('dialog.exportImage.eachLayerSeparatelyOwn')}</Label>
            <Label><Check checked={sh.splitTags} onChange={e => setSh({ splitTags: e.target.checked })} disabled={!sprite.tags.length} /> {t('dialog.exportImage.eachTagSeparatelyOwn')}</Label>
            <Section>{t('dialog.exportImage.space')}</Section>
            <Row>
              <Label>{t('dialog.exportImage.border')} <Input type="number" min={0} max={100} value={sh.border} onChange={e => setSh({ border: Math.max(0, Math.min(100, +e.target.value | 0)) })} /></Label>
              <Label>{t('dialog.exportImage.between')} <Input type="number" min={0} max={100} value={sh.spacing} onChange={e => setSh({ spacing: Math.max(0, Math.min(100, +e.target.value | 0)) })} /></Label>
              <Label>{t('dialog.exportImage.inner')} <Input type="number" min={0} max={100} value={sh.inner} onChange={e => setSh({ inner: Math.max(0, Math.min(100, +e.target.value | 0)) })} /></Label>
            </Row>
            <Field label={t('dialog.exportImage.trim')}>
              <Select value={sh.trim} onChange={e => setSh({ trim: e.target.value as TrimMode })}>
                <option value="none">{t('dialog.exportImage.keepFullFrames')}</option>
                <option value="sprite">{t('dialog.exportImage.sameBoxForEvery')}</option>
                <option value="cels">{t('dialog.exportImage.eachFrameToIts')}</option>
              </Select>
              {sh.trim !== 'none' && <Label><Check checked={sh.trimByGrid} onChange={e => setSh({ trimByGrid: e.target.checked })} /> {t('dialog.exportImage.toGridCells')}</Label>}
            </Field>
            <Label title={t('dialog.exportImage.repeatsEdgePixelsOutward')}><Check checked={sh.extrude} onChange={e => setSh({ extrude: e.target.checked })} /> {t('dialog.exportImage.extrudeEdgesBy1px')}</Label>
            <Label><Check checked={sh.mergeDuplicates || sh.type === 'packed'} disabled={sh.type === 'packed'} onChange={e => setSh({ mergeDuplicates: e.target.checked })} /> {t('dialog.exportImage.storeIdenticalFramesOnce')}</Label>
            <Label><Check checked={sh.ignoreEmpty} onChange={e => setSh({ ignoreEmpty: e.target.checked })} /> {t('dialog.exportImage.skipEmptyFrames')}</Label>
            <Label><Check checked={sh.powerOfTwo} onChange={e => setSh({ powerOfTwo: e.target.checked })} /> {t('dialog.exportImage.powerOfTwoTexture')}</Label>
            <Section>{t('dialog.exportImage.data')}</Section>
            <Field label={t('dialog.exportImage.dataFile')}>
              <Select value={o.json} onChange={e => set({ json: e.target.value as typeof o.json })}>
                <option value="none">{t('common.none')}</option>
                <option value="hash">{t('dialog.exportImage.jsonFramesByName')}</option>
                <option value="array">{t('dialog.exportImage.jsonFrameList')}</option>
              </Select>
            </Field>
            {o.json !== 'none' && (
              <Field label={t('dialog.exportImage.frameNames')}>
                <Input value={sh.template} placeholder={defaultTemplate({ ...sh, frames: Array(frameCount) })} style={{ width: 220 }}
                  title="{title} {layer} {group} {tag} {frame} {frame01} {tagframe} {duration} {layerdata} {tagdata} {extension}"
                  onChange={e => setSh({ template: e.target.value })} />
              </Field>
            )}
          </>}
        </div>
        {o.kind === 'sheet' && <div style={{ flex: 1, minWidth: 0 }}><SheetPreview opts={opts} /></div>}
      </div>
    </Dialog>
  );
};

type SheetLayout = 'grid' | 'json';

/** Frame rectangles from a JSON sheet description, in its order (nothing when it doesn't look like one) */
function sheetRects(json: unknown) {
  const raw = (json as { frames?: unknown; })?.frames;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list.flatMap((e: { frame?: Rect; rotated?: boolean; }) =>
    e?.frame && e.frame.w > 0 ? [e.rotated ? { ...e.frame, w: e.frame.h, h: e.frame.w } : e.frame] : []);
}

function sheetNames(json: unknown) {
  const raw = (json as { frames?: unknown; })?.frames;
  if (Array.isArray(raw)) return raw.filter(e => e?.frame).map(e => String(e.filename ?? ''));
  return raw && typeof raw === 'object' ? Object.entries(raw).filter(([, e]) => e?.frame).map(([k]) => k) : [];
}

/** The sheet with the cells that will become frames outlined */
const SheetCuts: FC<{ bmp: ImageBitmap; rects: Rect[]; }> = ({ bmp, rects }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  // Whole pixels while the sheet is small, shrunk to fit when it is big
  const fit = Math.min(480 / bmp.width, 240 / bmp.height);
  const scale = fit >= 1 ? Math.min(8, Math.floor(fit)) : fit;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f0b24a';
    ctx.lineWidth = 1;
    for (const r of rects.slice(0, 4000))
      ctx.strokeRect(Math.round(r.x * scale) + .5, Math.round(r.y * scale) + .5, Math.max(1, Math.round(r.w * scale) - 1), Math.max(1, Math.round(r.h * scale) - 1));
  }, [bmp, rects, scale]);
  return <canvas ref={ref} style={{ display: 'block', maxWidth: '100%', background: 'var(--workspace)', border: '1px solid var(--b1)' }} />;
};

const ImportSheet: FC<{ close: () => void; file?: File; data?: File; }> = ({ close, file: initialFile, data: initialData }) => {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [layout, setLayout] = useState<SheetLayout>(initialData ? 'json' : 'grid');
  const [dataFile, setDataFile] = useState<File | null>(initialData ?? null);
  const [json, setJson] = useState<unknown>(null);
  const [jsonError, setJsonError] = useState(false);
  const [cw, setCw] = useState('16');
  const [ch, setCh] = useState('16');
  const [x0, setX0] = useState('0');
  const [y0, setY0] = useState('0');
  const [byColumns, setByColumns] = useState(false);
  const [partial, setPartial] = useState(false);
  const [tagByName, setTagByName] = useState(true);

  useEffect(() => { if (file) createImageBitmap(file).then(setBmp, () => setBmp(null)); }, [file]);
  useEffect(() => {
    if (!dataFile) return;
    dataFile.text().then(text => { setJson(JSON.parse(text)); setJsonError(false); }).catch(() => { setJson(null); setJsonError(true); });
  }, [dataFile]);

  const W = Math.max(1, num(cw, 16) | 0), H = Math.max(1, num(ch, 16) | 0), X = Math.max(0, num(x0, 0) | 0), Y = Math.max(0, num(y0, 0) | 0);
  const rects = useMemo<Rect[]>(() => {
    if (!bmp) return [];
    if (layout === 'json') return sheetRects(json);
    const fit = (size: number, start: number, cell: number) => Math.max(0, partial ? Math.ceil((size - start) / cell) : Math.floor((size - start) / cell));
    const cols = fit(bmp.width, X, W), rows = fit(bmp.height, Y, H), out: Rect[] = [];
    if (byColumns) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push({ x: X + c * W, y: Y + r * H, w: W, h: H });
    else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: X + c * W, y: Y + r * H, w: W, h: H });
    return out;
  }, [bmp, layout, json, W, H, X, Y, byColumns, partial]);
  const givenTags = (json as { meta?: { frameTags?: unknown[]; }; })?.meta?.frameTags?.length ?? 0;
  const tags = layout !== 'json' ? 0 : givenTags || (tagByName ? tagsByName(sheetNames(json)).length : 0);

  return (
    <Dialog title={t('dialog.importSheet.importSpriteSheet')} onClose={close} submitLabel={t('dialog.importSheet.import')} onSubmit={() => {
      if (!file || !bmp || !rects.length) return false;
      const name = file.name.replace(/\.[^.]+$/, '');
      const doc = new Sprite(32, 32);
      const ok = layout === 'json'
        ? doc.loadSheetData(bmp, json, name, tagByName)
        : doc.loadSheet(bmp, W, H, name, { x0: X, y0: Y, byColumns, partial });
      if (!ok) { state.showTip(t('dialog.importSheet.noCellsFitInto'), 3000); return false; }
      addDocuments([doc]);
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row>
            <Button type="button" onClick={async () => { const f = await pickFile('image/*'); if (f) setFile(f); }}>{t('dialog.importSheet.chooseImage')}</Button>
            <Muted>{file ? `${file.name} · ${bmp?.width ?? '?'}×${bmp?.height ?? '?'}` : 'No file'}</Muted>
          </Row>
          <Field label={t('common.frames')}>
            <Select value={layout} onChange={e => setLayout(e.target.value as SheetLayout)}>
              <option value="grid">{t('dialog.importSheet.fixedGrid')}</option>
              <option value="json">{t('dialog.importSheet.fromAJsonDescription')}</option>
            </Select>
          </Field>
          {layout === 'grid' ? <>
            <Row>
              <FieldLabel>{t('common.cell')}</FieldLabel>
              <Input type="number" min={1} value={cw} onChange={e => setCw(e.target.value)} />×
              <Input type="number" min={1} value={ch} onChange={e => setCh(e.target.value)} />
            </Row>
            <Row>
              <FieldLabel>{t('dialog.importSheet.startAt')}</FieldLabel>
              <Input type="number" min={0} value={x0} onChange={e => setX0(e.target.value)} />,
              <Input type="number" min={0} value={y0} onChange={e => setY0(e.target.value)} />
            </Row>
            <Field label={t('dialog.importSheet.order')}>
              <Select value={byColumns ? 'cols' : 'rows'} onChange={e => setByColumns(e.target.value === 'cols')}>
                <option value="rows">{t('dialog.importSheet.leftToRightThen')}</option>
                <option value="cols">{t('dialog.importSheet.topToBottomThen')}</option>
              </Select>
            </Field>
            <Label><Check checked={partial} onChange={e => setPartial(e.target.checked)} /> {t('dialog.importSheet.keepCellsCutBy')}</Label>
          </> : <>
            <Row>
              <Button type="button" onClick={async () => { const f = await pickFile('.json,application/json'); if (f) setDataFile(f); }}>{t('dialog.importSheet.chooseJson')}</Button>
              <Muted>{dataFile?.name ?? 'No file'}</Muted>
            </Row>
            {jsonError && <Muted>{t('dialog.importSheet.couldNotReadThe')}</Muted>}
            {json != null && !rects.length && <Muted>{t('dialog.importSheet.noFramesFoundIn')}</Muted>}
            <Muted>{t('dialog.importSheet.framePositionsTrimmingDurations')}</Muted>
            <Label title={t('dialog.importSheet.onlyWhenTheDescription')}>
              <Check checked={tagByName || givenTags > 0} disabled={givenTags > 0} onChange={e => setTagByName(e.target.checked)} /> {t('dialog.importSheet.tagFramesByTheir')}
            </Label>
          </>}
          {bmp && <Muted>{t('dialog.importSheet.nFrames', { n: rects.length })}{tags ? ` · ${t('dialog.importSheet.nTags', { n: tags })}` : ''}</Muted>}
          {bmp && <SheetCuts bmp={bmp} rects={rects} />}
      </div>
    </Dialog>
  );
};

const HistoryItem = styled.div`
  padding: 2px 6px;
  cursor: pointer;

  &[data-current=true] { background: var(--sel); color: var(--sel-fg); }
  &[data-future=true] { color: var(--fg-dim); }
  &:hover:not([data-current=true]) { background: var(--face-hot); }
`;

const History: FC<{ close: () => void; }> = ({ close }) => {
  useSignals();
  const { sprite } = state;
  const steps = [sprite.historyBoundary ? t('dialog.history.boundary') : 'Opened', ...sprite.history];
  const future = sprite.future;
  return (
    <Dialog title={t('dialog.history.title')} onClose={close} cancelLabel={t('common.close')}>
      <VirtualList measurementKey={`${state.ui.font}:${state.prefs.uiFont}`} items={[...steps, ...future]} itemKey={(_, i) => i} estimate={state.ui.row} maxHeight={320}
        current={steps.length - 1} style={{ minWidth: 220, border: '1px solid var(--b1)', background: 'var(--field)' }}
        render={(label, i) => <HistoryItem tabIndex={0} role="button" data-current={i === steps.length - 1} data-future={i >= steps.length}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sprite.goToStep(i); state.save(); } }}
          onClick={() => { sprite.goToStep(i); state.save(); }}>{label}</HistoryItem>} />
      <Muted>{t('dialog.history.nSteps', { n: sprite.history.length + future.length })} · {t('dialog.history.memory')}: {(sprite.historyBytes() / (1 << 20)).toFixed(1)} MB</Muted>
      <Muted>{t('dialog.history.accounting')}</Muted>
      {sprite.historyLimitNotice && <Muted role="status">{t(sprite.historyLimitNotice === 'operation' ? 'dialog.history.operationExceeded' : 'dialog.history.memoryExceeded')}</Muted>}
      <NumberField label={t('dialog.history.keepSteps')} value={String(state.prefs.historySteps ?? 256)} min={1} max={10000}
        onChange={v => state.setPrefs({ historySteps: Math.max(1, Math.round(+v) || 1) })} />
      <NumberField label={t('dialog.history.memoryLimit')} suffix={t('dialog.history.mb0NoLimit')} value={String(state.prefs.historyMB ?? 0)} min={0} max={4096}
        onChange={v => state.setPrefs({ historyMB: Math.max(0, +v || 0) })} />
      <NumberField label={t('dialog.history.operationLimit')} suffix={t('dialog.history.mb0NoLimit')} value={String(state.prefs.historyOperationMB ?? 0)} min={0} max={4096}
        onChange={v => state.setPrefs({ historyOperationMB: Math.max(0, +v || 0) })} />
      <Muted>{t('dialog.history.policy')}</Muted>
    </Dialog>
  );
};

const Preferences: FC<{ close: () => void; section?: string; }> = ({ close }) => {
  const [p, setP] = useState<Prefs>(state.prefs);
  const set = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    state.prefs = next; // live preview
  };
  const initial = useMemo(() => state.prefs, []);
  return (
    <Dialog title={t('dialog.preferences.title')} onClose={close} cancelLabel={null} submitLabel={t('dialog.preferences.done')} width={460} onSubmit={() => { }}
      extraButtons={<>
        <Button type="button" onClick={() => set({ ...DEFAULT_PREFS })}>{t('dialog.preferences.defaults')}</Button>
        <Button type="button" onClick={() => set(initial)}>{t('dialog.preferences.revert')}</Button>
      </>}>
      <Section>{t('common.look')}</Section>
      <Field label={t('common.language')}>
        <Select value={p.language} onChange={e => set({ language: e.target.value })}>
          {Object.entries(LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </Field>
      <Field label={t('dialog.preferences.keyNames')}>
        <Select value={p.keyStyle} onChange={e => set({ keyStyle: e.target.value as Prefs['keyStyle'] })}>
          <option value="auto">{t('dialog.preferences.likeThisSystem')}</option>
          <option value="mac">{t('dialog.preferences.mac')}</option>
          {/* Shown literally: the key names here must not follow the chosen style */}
          <option value="pc"><span>Windows / Linux (Ctrl Alt Shift)</span></option>
        </Select>
      </Field>
      <Field label={t('common.font')}>
        <Select value={p.uiFont} onChange={e => set({ uiFont: e.target.value as Prefs['uiFont'] })}>
          {Object.entries(UI_FONTS).map(([id, f]) => <option key={id} value={id}>{t(f.label)}</option>)}
        </Select>
      </Field>
      <Field label={t('dialog.preferences.interface')}>
        <Select value={p.uiSize} onChange={e => set({ uiSize: e.target.value as Prefs['uiSize'] })}>
          <option value="small">{t('dialog.preferences.smallText')}</option>
          <option value="medium">{t('dialog.preferences.mediumText')}</option>
          <option value="large">{t('dialog.preferences.largeText')}</option>
        </Select>
      </Field>
      <Field label={t('common.theme')}>
        <Select value={p.theme} onChange={e => set({ theme: e.target.value as Prefs['theme'] })}>
          {Object.entries(THEMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </Field>

      <Section>{t('dialog.preferences.canvas')}</Section>
      <Field label={t('dialog.preferences.checkerboard')}>
        <ColorInput value={p.checkerA} onChange={v => set({ checkerA: v })} />
        <ColorInput value={p.checkerB} onChange={v => set({ checkerB: v })} />
        <Select value={p.checkerSize} onChange={e => set({ checkerSize: +e.target.value })}>
          {[1, 2, 4, 8, 16, 32].map(s => <option key={s} value={s}>{s}px</option>)}
        </Select>
      </Field>
      <Label><Check checked={p.checkerFollowsZoom} onChange={e => set({ checkerFollowsZoom: e.target.checked })} /> {t('dialog.preferences.checkerboardFollowsTheZoom')}</Label>
      <Field label={t('dialog.preferences.brushPreview')}>
        <Select value={p.brushPreview} onChange={e => set({ brushPreview: e.target.value as Prefs['brushPreview'] })}>
          <option value="full">{t('dialog.preferences.showTheRealDab')}</option>
          <option value="outline">{t('dialog.preferences.outlineOnly')}</option>
          <option value="none">{t('dialog.preferences.crosshairOnly')}</option>
        </Select>
      </Field>
      <Label><Check checked={p.autoGuides} onChange={e => set({ autoGuides: e.target.checked })} /> {t('dialog.preferences.ctrlWithTheMove')}</Label>
      <Label><Check checked={p.sliceKeysPerFrame} onChange={e => set({ sliceKeysPerFrame: e.target.checked })} /> {t('dialog.preferences.sliceEditsMakeA')}</Label>
      <Label><Check checked={p.alwaysShowTabs} onChange={e => set({ alwaysShowTabs: e.target.checked })} /> {t('dialog.preferences.showDocumentTabsEven')}</Label>
      <Field label={t('dialog.preferences.rightButton')}>
        <Select value={p.rightClick} onChange={e => set({ rightClick: e.target.value as Prefs['rightClick'] })}>
          <option value="secondary">{t('dialog.preferences.paintWithTheSecondary')}</option>
          <option value="pick">{t('dialog.preferences.pickAColor')}</option>
          <option value="erase">{t('dialog.preferences.erase')}</option>
          <option value="scroll">{t('dialog.preferences.scrollTheCanvas')}</option>
        </Select>
      </Field>
      <Label><Check checked={p.keepSelectionOnClear} onChange={e => set({ keepSelectionOnClear: e.target.checked })} /> {t('dialog.preferences.keepTheSelectionAfter')}</Label>

      <Section>{t('dialog.preferences.grid')}</Section>
      <Row>
        <FieldLabel>{t('common.cell')}</FieldLabel>
        <Input type="number" min={1} value={p.gridW} onChange={e => set({ gridW: Math.max(1, +e.target.value) })} />
        ×
        <Input type="number" min={1} value={p.gridH} onChange={e => set({ gridH: Math.max(1, +e.target.value) })} />
        <Muted>{t('dialog.preferences.offset')}</Muted>
        <Input type="number" value={p.gridX} onChange={e => set({ gridX: Math.round(+e.target.value) })} />
        <Input type="number" value={p.gridY} onChange={e => set({ gridY: Math.round(+e.target.value) })} />
      </Row>
      <Field label={t('dialog.preferences.gridColor')}><ColorInput value={p.gridColor} onChange={v => set({ gridColor: v })} /></Field>
      <Label><Check checked={p.gridAutoOpacity} onChange={e => set({ gridAutoOpacity: e.target.checked })} /> {t('dialog.preferences.fadeTheGridWhen')}</Label>

      <Section>{t('dialog.preferences.animation')}</Section>
      <Row>
        <FieldLabel>{t('common.onionSkin')}</FieldLabel>
        <Muted>{t('dialog.preferences.before')}</Muted>
        <Input type="number" min={0} max={8} value={p.onionBefore} onChange={e => set({ onionBefore: Math.max(0, Math.min(8, +e.target.value)) })} />
        <Muted>{t('dialog.preferences.after')}</Muted>
        <Input type="number" min={0} max={8} value={p.onionAfter} onChange={e => set({ onionAfter: Math.max(0, Math.min(8, +e.target.value)) })} />
        <Select value={p.onionMode} onChange={e => set({ onionMode: e.target.value as Prefs['onionMode'] })}>
          <option value="merge">{t('common.plain')}</option>
          <option value="tint">{t('dialog.preferences.redBlue')}</option>
        </Select>
      </Row>
      <Field label={t('dialog.preferences.onionOpacity')}>
        <Range min={5} max={100} value={Math.round(p.onionOpacity * 100)} onChange={e => set({ onionOpacity: +e.target.value / 100 })} />
        <Muted>{Math.round(p.onionOpacity * 100)}%, −{Math.round(p.onionStep * 100)}% per frame</Muted>
      </Field>
      <Label><Check checked={p.playOnce} onChange={e => set({ playOnce: e.target.checked })} /> {t('common.playOnce')}</Label>
      <Label><Check checked={p.rewindOnStop} onChange={e => set({ rewindOnStop: e.target.checked })} /> {t('dialog.preferences.returnToTheStart')}</Label>

      <Section>{t('dialog.preferences.behaviour')}</Section>
      <Label><Check checked={p.autosave} onChange={e => set({ autosave: e.target.checked })} /> {t('dialog.preferences.keepWorkInThe')}</Label>

      <Section>{t('dialog.preferences.extensionCatalogs')}</Section>
      <Muted style={{ whiteSpace: 'normal' }}>{t('dialog.preferences.extensionCatalogsHint')}</Muted>
      {p.extensionCatalogs.map((url, i) => (
        <Row key={i}>
          <Input value={url} placeholder="https://…/registry.json" style={{ flex: '1 1 auto', width: 'auto' }}
            onChange={e => set({ extensionCatalogs: p.extensionCatalogs.map((u, k) => k === i ? e.target.value : u) })} />
          <Button type="button" title={t('common.delete')} onClick={() => set({ extensionCatalogs: p.extensionCatalogs.filter((_, k) => k !== i) })}>×</Button>
        </Row>
      ))}
      <Row>
        <Button type="button" onClick={() => set({ extensionCatalogs: [...p.extensionCatalogs, ''] })}>{t('dialog.preferences.addCatalog')}</Button>
        <Button type="button" onClick={() => set({ extensionCatalogs: [...DEFAULT_PREFS.extensionCatalogs] })}>{t('dialog.preferences.defaults')}</Button>
      </Row>
    </Dialog>
  );
};

const ShortcutTable = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 0 24px;
  max-height: 60vh;
  overflow-y: auto;
`;

const ShortcutRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 1px 0;
  border-bottom: 1px dotted var(--b2);
`;

const Shortcuts: FC<{ close: () => void; }> = ({ close }) => {
  const groups = [...new Set(COMMANDS.map(c => c.group))];
  return (
    <Dialog title={t('common.keyboardShortcuts')} onClose={close} cancelLabel={t('common.close')} width={620}>
      <ShortcutTable>
        {groups.map(g => (
          <div key={g}>
            <Section>{t(g)}</Section>
            {COMMANDS.filter(c => c.group === g && c.keys).map(c => (
              <ShortcutRow key={c.id}><span>{commandLabel(c)}</span><Muted>{c.keys!.map(prettyCombo).join(', ')}</Muted></ShortcutRow>
            ))}
          </div>
        ))}
        <div>
          <Section>{t('dialog.shortcuts.tools')}</Section>
          <ShortcutRow><span>{t('dialog.shortcuts.nextToolSharingA')}</span><Muted>{keyNames('Shift')}+key</Muted></ShortcutRow>
          <ShortcutRow><span>{t('dialog.shortcuts.eyedropperWhileHeld')}</span><Muted>{keyNames('Alt')}</Muted></ShortcutRow>
          <ShortcutRow><span>{t('dialog.shortcuts.handWhileHeld')}</span><Muted>{t('key.space')}</Muted></ShortcutRow>
          <ShortcutRow><span>{t('dialog.shortcuts.finishPolygonCurve')}</span><Muted>{keyNames('Enter')}</Muted></ShortcutRow>
          <ShortcutRow><span>{t('dialog.shortcuts.cancelCurrentShape')}</span><Muted>{keyNames('Escape')}</Muted></ShortcutRow>
        </div>
      </ShortcutTable>
    </Dialog>
  );
};

const About: FC<{ close: () => void; }> = ({ close }) => (
  <Dialog title={t('dialog.about.aboutPixprite')} onClose={close} cancelLabel={t('common.close')}>
    <span style={{ fontSize: 20, color: 'var(--accent)' }}>Pixprite</span>
    <span>{t('dialog.about.aPixelArtAnd')}</span>
    <Muted>{t('dialog.about.fontsPixelifySansAnd')}</Muted>
    <a href="https://github.com/vicimpa/pixprite" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>github.com/vicimpa/pixprite</a>
  </Dialog>
);

export const dialogs = {
  canvasSize: () => openDialog(close => <CanvasSize close={close} />),
  spriteSize: () => openDialog(close => <SpriteSize close={close} />),
  spriteProperties: () => openDialog(close => <SpriteProperties close={close} />),
  layerProperties: (index = state.sprite.layer) => openDialog(close => <LayerProperties close={close} index={index} />),
  frameProperties: () => openDialog(close => <FrameProperties close={close} />),
  tagProperties: (index: number) => openDialog(close => <TagProperties close={close} index={index} />),
  saveAs: () => openDialog(close => <SaveAs close={close} />),
  exportImage: () => openDialog(close => <ExportImage close={close} />),
  importSheet: (file?: File, data?: File) => openDialog(close => <ImportSheet close={close} file={file} data={data} />),
  history: () => openDialog(close => <History close={close} />),
  preferences: (section?: string) => openDialog(close => <Preferences close={close} section={section} />),
  about: () => openDialog(close => <About close={close} />),
  gotoFrame: () => openDialog(close => <GotoFrame close={close} />),
  tweenFrames: () => openDialog(close => <TweenFrames close={close} />),
  celProperties: () => openDialog(close => <CelProperties close={close} />),
  guidePosition: (index: number) => openDialog(close => <GuidePosition close={close} index={index} />),
};
