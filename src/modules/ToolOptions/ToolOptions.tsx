import { t } from "~/core/i18n";
import { runCommand } from "~/core/Commands";
import { dialogs } from "~/modules/Dialogs";
import type { SelectMode } from "~/core/Mask";
import { state, TEXT_FONTS, type Ink, type PaintPattern, type PickChannel, type PivotAnchor } from "~/core/State";
import { toolDef } from "~/core/Tools";
import { applyPreset, deletePreset, removeItem, saveCurrentToLibrary, savePreset, useItem } from "~/core/Brushes";
import { askText } from "~/ui/Dialog";
import { Button, Check, Input, Label, Muted, Range as Slider, Select, Separator } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import styled from "styled-components";
import * as styled2 from "./styled";

const Bar = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  background-color: var(--bg);
  border-bottom: 1px solid var(--b1);
`;

const ToolName = styled.span`
  color: var(--accent);
  min-width: 72px;
  white-space: nowrap;
`;

const Popup = styled.div`
  position: fixed;
  z-index: 950;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px;
  background-color: var(--menu);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 3px 3px 0 var(--shadow);
`;

const PopupRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

/** A button with a drop-down of secondary settings, so the bar stays one short row */
const More: FC<{ children: ReactNode; }> = ({ children }) => {
  const [at, setAt] = useState<{ x: number; y: number; } | null>(null);
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!pop.current?.contains(el) && !btn.current?.contains(el)) setAt(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key); };
  }, [at]);
  return <>
    <Button ref={btn} $active={!!at} title={t('options.moreBrushSettings')} onClick={() => {
      const r = btn.current!.getBoundingClientRect();
      setAt(at ? null : { x: r.left, y: r.bottom + 2 });
    }}>{t('options.more')} ▾</Button>
    {at && <Popup ref={pop} style={{ left: Math.min(at.x, innerWidth - 320), top: at.y }}>{children}</Popup>}
  </>;
};

const BRUSH = ['pencil', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'blur', 'jumble', 'spray'];
const INK = ['pencil', 'spray', 'line', 'curve', 'rect', 'ellipse', 'contour', 'polygon', 'fill'];
const DITHERS = [0, 2, 4, 8] as const;
const EFFECTS = ['eraser', 'blur', 'jumble'];
const SELECT = ['marquee', 'ellipseMarquee', 'lasso', 'polyLasso', 'wand'];
const SYMMETRY = ['pencil', 'eraser', 'spray', 'line', 'curve', 'rect', 'ellipse', 'contour', 'polygon', 'fill', 'gradient'];

const INKS: [Ink, string][] = [
  ['simple', 'options.simple'],
  ['alpha', 'options.blendWithAlpha'],
  ['copy', 'options.copyColorAlpha'],
  ['lockAlpha', 'options.keepAlpha'],
  ['shade', 'options.shadeByPalette'],
];

const PIVOTS: PivotAnchor[] = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'];

const MODES: [SelectMode, string][] = [
  ['replace', 'options.selectNew'],
  ['add', 'options.selectAdd'],
  ['subtract', 'options.selectSubtract'],
  ['intersect', 'options.selectIntersect'],
];

const Num: FC<{ label: string; value: number; min: number; max: number; set: (v: number) => void; title?: string; }> =
  ({ label, value, min, max, set, title }) => (
    <Label title={title}>
      {label}
      <Input type="number" min={min} max={max} value={value}
        onChange={e => set(Math.max(min, Math.min(max, Math.round(+e.target.value) || min)))} />
    </Label>
  );

/** Evaluates simple arithmetic typed into a field ("32*2", "+8" relative to the current value) */
function evalExpr(text: string, current: number): number | null {
  const t = text.trim();
  if (!/^[-+*/().\d\s%]+$/.test(t)) return null;
  try {
    const rel = /^[+*/]/.test(t) ? `${current}${t}` : t;
    const v = Function(`"use strict"; return (${rel.replace(/(\d+(?:\.\d+)?)%/g, `(${current}*$1/100)`)});`)() as number;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** Number field that accepts expressions and commits on Enter / blur */
const ExprField: FC<{ label: string; value: number; set: (v: number) => void; title?: string; }> = ({ label, value, set, title }) => {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(shown); }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    const v = evalExpr(text, value);
    if (v !== null) set(v);
  };
  return (
    <Label title={title}>
      {label}
      <Input value={editing ? text : shown} style={{ width: 52 }}
        onFocus={e => { setEditing(true); setText(shown); e.currentTarget.select(); }}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setText(shown); setEditing(false); e.currentTarget.blur(); }
        }} />
    </Label>
  );
};

/** X / Y / W / H / angle of the pixels being transformed */
const TransformFields: FC = () => {
  useSignals();
  const sprite = state.sprite;
  const f = sprite.floating;
  if (!f) return null;
  const p = f.place;
  const place = (patch: Partial<typeof p>) => sprite.placeFloating({ ...p, ...patch });
  // Size changes keep the pivot where it is relative to the box
  const resize = (w: number, h: number) => {
    const rx = p.w ? (p.px - p.x) / p.w : 0.5, ry = p.h ? (p.py - p.y) / p.h : 0.5;
    place({ w, h, x: Math.round(p.px - rx * w), y: Math.round(p.py - ry * h) });
  };
  return <>
    <ExprField label="X" value={p.x} set={x => place({ x: Math.round(x), px: p.px + Math.round(x) - p.x })} />
    <ExprField label="Y" value={p.y} set={y => place({ y: Math.round(y), py: p.py + Math.round(y) - p.y })} />
    <ExprField label="W" value={Math.abs(p.w)} set={w => resize(Math.sign(p.w || 1) * Math.max(1, Math.round(w)), p.h)} title={t('options.widthExpr')} />
    <ExprField label="H" value={Math.abs(p.h)} set={h => resize(p.w, Math.sign(p.h || 1) * Math.max(1, Math.round(h)))} />
    <ExprField label="%" value={Math.round(Math.abs(p.w) / f.src.w * 1000) / 10} set={k => {
      const r = Math.max(0.01, k / 100);
      resize(Math.sign(p.w || 1) * Math.max(1, Math.round(f.src.w * r)), Math.sign(p.h || 1) * Math.max(1, Math.round(f.src.h * r)));
    }} title={t('options.scaleInPercentOf')} />
    <ExprField label="°" value={p.angle} set={a => place({ angle: ((a % 360) + 360) % 360 })} title={t('options.rotationInDegrees')} />
    <ExprField label={t('options.skew')} value={p.skew ?? 0} set={k => place({ skew: Math.max(-85, Math.min(85, k)) })} title={t('options.horizontalSlantInDegrees')} />
  </>;
};

/** Named tool settings: pick one to switch, save the current ones under a name */
const Presets: FC = () => {
  useSignals();
  const [picked, setPicked] = useState('');
  const list = state.toolPresets;
  return <>
    <Label title={t('options.toolPresetsNamedSets')}>
      {t('options.preset')}
      <Select value={list.some(p => p.name === picked) ? picked : ''} onChange={e => { setPicked(e.target.value); applyPreset(e.target.value); }}>
        <option value="">—</option>
        {list.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
      </Select>
    </Label>
    <Button $square title={t('options.saveTheCurrentTool')} onClick={async () => {
      const name = (await askText(t('options.presetName'), picked || `${t(toolDef(state.tool).title)} ${list.length + 1}`))?.trim();
      if (name) { savePreset(name); setPicked(name); }
    }}>+</Button>
    {list.some(p => p.name === picked) && (
      <Button $square title={t('options.deleteThisPreset')} onClick={() => { deletePreset(picked); setPicked(''); }}><Icon name="trash" scale="glyph" /></Button>
    )}
  </>;
};

/** Saved brushes and patterns: quick pick, save the current one, remove */
const BrushLibrary: FC = () => {
  useSignals();
  const [picked, setPicked] = useState('');
  const lib = state.brushLibrary, doc = state.docBrushes;
  const all = [...doc, ...lib];
  const canSave = !!state.customBrush || !!state.patternBits;
  if (!all.length && !canSave) return null;
  const option = (i: typeof all[number]) => <option key={i.id} value={i.id}>{i.name} ({i.w}×{i.h}{i.kind === 'pattern' ? ', ' + t('options.pattern') : ''})</option>;
  return <>
    {all.length > 0 && (
      <Label title={t('options.savedBrushesAndPatterns')}>
        {t('options.library')}
        <Select value={all.some(i => i.id === picked) ? picked : ''} onChange={e => {
          const item = all.find(i => i.id === e.target.value);
          setPicked(e.target.value);
          if (item) useItem(item);
        }}>
          <option value="">—</option>
          {doc.length > 0 && <optgroup label={t('options.thisProject')}>{doc.map(option)}</optgroup>}
          {lib.length > 0 && <optgroup label={t('common.allProjects')}>{lib.map(option)}</optgroup>}
        </Select>
      </Label>
    )}
    {canSave && <>
      <Button title={t('options.keepTheCurrentBrush')} onClick={() => saveCurrentToLibrary('library')}>{t('common.save')}</Button>
      <Button title={t('options.keepTheCurrentBrushOr')} onClick={() => { saveCurrentToLibrary('document'); state.save(); }}>{t('options.inProject')}</Button>
    </>}
    {all.some(i => i.id === picked) && (
      <Button $square title={t('options.removeFromTheLibrary')} onClick={() => { removeItem(picked); setPicked(''); }}><Icon name="trash" scale="glyph" /></Button>
    )}
  </>;
};

const Pressure: FC<{ spray: boolean; }> = ({ spray }) => {
  useSignals();
  const m = state.pressure;
  const set = (patch: Partial<typeof m>) => { state.pressure = { ...m, ...patch }; };
  return <>
    <Muted title={t('options.penPressureAMouse')}>{t('options.pen')}</Muted>
    <Label><Check checked={m.size} onChange={e => set({ size: e.target.checked })} /> {t('common.size')}</Label>
    <Label><Check checked={m.opacity} onChange={e => set({ opacity: e.target.checked })} /> {t('options.alpha')}</Label>
    {spray && <Label><Check checked={m.density} onChange={e => set({ density: e.target.checked })} /> {t('options.density')}</Label>}
    {(m.size || m.opacity || m.density) && (
      <Num label={t('options.min')} value={m.min} min={0} max={100} set={v => set({ min: v })} title={t('options.lowestShareAtThe')} />
    )}
  </>;
};

export const ToolOptions: FC = () => {
  useSignals();
  const tool = state.activeTool;
  const def = toolDef(tool);
  const has = (list: string[]) => list.includes(tool);
  const floating = !!state.sprite.floating;
  // Opacity only matters for blending inks, custom brushes and effect tools
  const showOpacity = has(EFFECTS) || tool === 'gradient' || has(INK) && (state.ink === 'alpha' || state.ink === 'lockAlpha' || !!state.customBrush);

  return (
    <Bar>
      <ToolName>{t(def.title)}</ToolName>
      <Separator />
      <Presets />
      <Separator />

      {has(BRUSH) && !state.customBrush && <>
        <Button $square $active={state.brushShape === 'square'} title={t('options.squareBrush')} onClick={() => { state.brushShape = 'square'; }}><Icon name="square" scale="glyph" /></Button>
        <Button $square $active={state.brushShape === 'circle'} title={t('options.roundBrush')} onClick={() => { state.brushShape = 'circle'; }}><Icon name="circle" scale="glyph" /></Button>
        <Button $square $active={state.brushShape === 'line'} title={t('options.lineBrushCalligraphy')} onClick={() => { state.brushShape = 'line'; }}><Icon name="line" scale="glyph" /></Button>
        <Num label={t('common.size')} value={state.brushSize} min={1} max={64} set={v => { state.brushSize = v; }} title={t('options.brushSizeAnd')} />
        <Slider min={1} max={32} value={Math.min(32, state.brushSize)} onChange={e => { state.brushSize = +e.target.value; }} style={{ width: 64 }} />
        {state.brushShape !== 'circle' && state.brushSize > 1 && (
          <Num label={t('options.angle')} value={state.brushAngle} min={0} max={180} set={v => { state.brushAngle = v; }} />
        )}
      </>}

      {has(INK) && state.customBrush && <>
        <Muted>Custom brush {state.customBrush.bmp.w}×{state.customBrush.bmp.h}</Muted>
        <Label title={t('options.howTheBrushPattern')}>
          {t('common.pattern')}
          <Select value={state.customBrush.align} onChange={e => { state.customBrush = { ...state.customBrush!, align: e.target.value as 'source' | 'stroke' | 'dab' }; }}>
            <option value="dab">{t('options.movesWithTheBrush')}</option>
            <option value="stroke">{t('options.startsAtEachStroke')}</option>
            <option value="source">{t('options.fixedToTheCanvas')}</option>
          </Select>
        </Label>
        <Button onClick={() => { state.customBrush = null; }}>{t('options.dropBrush')}</Button>
      </>}

      {tool === 'pencil' && (
        <Button $active={state.pixelPerfect} title={t('options.removesDoubledCornerPixels')}
          onClick={() => { state.pixelPerfect = !state.pixelPerfect; }}>
          <Icon name="pixelPerfect" scale="glyph" /> {t('options.cleanLines')}
        </Button>
      )}

      {(tool === 'rect' || tool === 'ellipse') && (
        <Label><Check checked={state.filled} onChange={e => { state.filled = e.target.checked; }} /> {t('options.filled')}</Label>
      )}

      {(tool === 'rect' || tool === 'marquee') && (
        <Num label={t('options.corners')} value={state.cornerRadius} min={0} max={64} set={v => { state.cornerRadius = v; }} title={t('options.cornerRadiusInPixels')} />
      )}

      {tool === 'slice' && (() => {
        const sp = state.sprite;
        const sel = sp.selectedSlices;
        return <>
          {sp.slices.length > 0 && (
            <Label title={t('options.pickASliceTo')}>
              {t('options.slice')}
              <Select value={sel.length === 1 ? sel[0] : -1} onChange={e => {
                const i = +e.target.value;
                if (i < 0) return;
                sp.selectedSlices = [i];
                const k = sp.slices[i].keys[0];
                state.panTo(k.x + k.w / 2, k.y + k.h / 2);
              }}>
                <option value={-1}>{sel.length > 1 ? `${sel.length} selected` : '—'}</option>
                {sp.slices.map((sl, i) => ({ sl, i })).sort((a, b) => a.sl.name.localeCompare(b.sl.name)).map(({ sl, i }) => <option key={i} value={i}>{sl.name}</option>)}
              </Select>
            </Label>
          )}
          <Button onClick={() => { sp.selectedSlices = sp.slices.map((_, i) => i); }} disabled={!sp.slices.length}>{t('options.selectAll')}</Button>
          <Button onClick={() => { sp.selectedSlices = []; }} disabled={!sel.length}>{t('options.deselect')}</Button>
          <Button onClick={() => dialogs.sliceProperties(sel[0])} disabled={!sel.length}>{t('options.properties')}</Button>
          <Button onClick={() => { sp.removeSlices(); state.save(); }} disabled={!sel.length}><Icon name="trash" scale="glyph" /></Button>
          <Muted>{sp.slices.length} slices</Muted>
        </>;
      })()}

      {tool === 'text' && <>
        <Label>
          {t('common.font')}
          <Select value={state.textFont} onChange={e => { state.textFont = e.target.value; }}>
            {Object.keys(TEXT_FONTS).map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Label>
        <Num label={t('common.size')} value={state.textSize} min={4} max={256} set={v => { state.textSize = v; }} />
        <Button $active={state.textBold} onClick={() => { state.textBold = !state.textBold; }} title={t('options.bold')}><b>B</b></Button>
        <Button $active={state.textItalic} onClick={() => { state.textItalic = !state.textItalic; }} title={t('options.italic')}><i>I</i></Button>
        <Label title={t('options.offKeepsHardPixel')}><Check checked={state.textAntialias} onChange={e => { state.textAntialias = e.target.checked; }} /> {t('options.smoothEdges')}</Label>
      </>}

      {tool === 'gradient' && <>
        <Button $active={state.gradientType === 'linear'} onClick={() => { state.gradientType = 'linear'; }} title={t('options.alongTheDrag')}>{t('options.linear')}</Button>
        <Button $active={state.gradientType === 'radial'} onClick={() => { state.gradientType = 'radial'; }} title={t('options.anEllipseFittedTo')}>{t('options.radial')}</Button>
        <Label title={t('options.orderedDitheringUsesOnly')}>
          {t('options.dither')}
          <Select value={state.gradientDither} onChange={e => { state.gradientDither = +e.target.value as 0 | 2 | 4 | 8 | -1; }}>
            {DITHERS.map(n => <option key={n} value={n}>{n ? `Pattern ${n}×${n}` : t('options.smooth')}</option>)}
            <option value={-1} disabled={!state.customBrush && !state.patternBits}>{t('options.customPattern')}</option>
          </Select>
        </Label>
      </>}

      {tool === 'spray' && <>
        <Num label={t('common.width')} value={state.sprayWidth} min={2} max={64} set={v => { state.sprayWidth = v; }} />
        <Num label={t('options.density')} value={state.spraySpeed} min={10} max={200} set={v => { state.spraySpeed = v; }} />
      </>}

      {has(INK) && <>
        <Separator />
        <Label>
          {t('options.ink')}
          <Select value={state.ink} onChange={e => { state.ink = e.target.value as Ink; }}>
            {INKS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </Select>
        </Label>
      </>}

      {showOpacity && <>
        <Label title={tool === 'blur' || tool === 'jumble' ? t('options.strength') : t('common.opacity')}>
          {tool === 'blur' || tool === 'jumble' ? t('options.strength') : t('options.alpha')}
          <Slider min={1} max={255} value={state.opacity} onChange={e => { state.opacity = +e.target.value; }} style={{ width: 64 }} />
          <Muted style={{ width: 24 }}>{Math.round(state.opacity / 2.55)}%</Muted>
        </Label>
      </>}

      {(tool === 'fill' || tool === 'wand' || tool === 'gradient') && <>
        <Separator />
        <Num label={t('common.tolerance')} value={state.tolerance} min={0} max={255} set={v => { state.tolerance = v; }} />
        <Label><Check checked={state.contiguous} onChange={e => { state.contiguous = e.target.checked; }} /> {t('options.contiguous')}</Label>
        <Label title={t('options.alsoSpreadThroughCorners')}><Check checked={state.fillDiagonal} onChange={e => { state.fillDiagonal = e.target.checked; }} /> {t('options.diagonal')}</Label>
        <Label><Check checked={state.sampleAll} onChange={e => { state.sampleAll = e.target.checked; }} /> {t('options.allLayers')}</Label>
        <Label title={t('options.whenTheGridIs')}><Check checked={state.stopAtGrid} onChange={e => { state.stopAtGrid = e.target.checked; }} /> {t('options.stopAtGrid')}</Label>
      </>}

      {tool === 'picker' && (
        <Label>
          {t('options.take')}
          <Select value={state.pickChannel} onChange={e => { state.pickChannel = e.target.value as PickChannel; }}>
            <option value="all">{t('options.colorAlpha')}</option>
            <option value="color">{t('options.colorOnly')}</option>
            <option value="alpha">{t('options.alphaOnly')}</option>
          </Select>
        </Label>
      )}

      {tool === 'picker' && (
        <Label>
          {t('options.sample')}
          <Select value={state.pickMerged ? 'merged' : 'layer'} onChange={e => { state.pickMerged = e.target.value === 'merged'; }}>
            <option value="merged">{t('options.visibleImage')}</option>
            <option value="layer">{t('options.currentLayer')}</option>
          </Select>
        </Label>
      )}

      {(has(SELECT) || tool === 'move') && (floating || state.sprite.mask) && <>
        <Label title={t('options.resamplingForScaledRotated')}>
          {t('options.resample')}
          <Select value={state.sprite.transformAlgo} onChange={e => { state.sprite.transformAlgo = e.target.value as 'fast' | 'rotsprite' | 'edge'; state.sprite.rerenderFloating(); }}>
            <option value="fast">{t('options.fastNearest')}</option>
            <option value="rotsprite">{t('options.smoothPixelArtRotsprite')}</option>
            <option value="edge">{t('options.edgePreservingRoundedCorners')}</option>
          </Select>
        </Label>
        <styled2.PivotGrid title={t('options.pivotForRotationAnd')}>
          {PIVOTS.map(p => (
            <styled2.PivotCell key={p} data-active={state.pivotAnchor === p} onClick={() => { state.pivotAnchor = p; }} />
          ))}
        </styled2.PivotGrid>
        <Label><Check checked={state.showPivot} onChange={e => { state.showPivot = e.target.checked; }} /> {t('common.pivot')}</Label>
        {floating && <>
          <TransformFields />
          <Button $primary title={t('options.applyEnter')} onClick={() => runCommand('select.drop')}><Icon name="check" scale="glyph" /> {t('common.apply')}</Button>
          <Button title={t('options.undoTheWholeTransformation')} onClick={() => runCommand('select.cancelTransform')}><Icon name="close" scale="glyph" /> {t('common.cancel')}</Button>
        </>}
        <Separator />
      </>}

      {has(SELECT) && !floating && <>
        {MODES.map(([mode, label]) => (
          <Button key={mode} $active={state.selectMode === mode} onClick={() => { state.selectMode = mode; }}>{t(label)}</Button>
        ))}
        <Separator />
        <Button onClick={() => runCommand('select.all')}>{t('options.all')}</Button>
        <Button onClick={() => runCommand('select.none')}>{t('common.none')}</Button>
        <Button onClick={() => runCommand('select.invert')}>Invert</Button>
      </>}

      {tool === 'move' && <>
        <Label title={t('options.pickTheTopmostLayer')}><Check checked={state.autoSelectLayer} onChange={e => { state.autoSelectLayer = e.target.checked; }} /> {t('options.autoSelectLayer')}</Label>
        <Button onClick={() => runCommand('edit.flipH')}>{t('options.mirrorH')}</Button>
        <Button onClick={() => runCommand('edit.flipV')}>{t('options.mirrorV')}</Button>
        <Button onClick={() => runCommand('edit.rotateCw')}>Turn 90°</Button>
      </>}

      {(tool === 'zoom' || tool === 'hand') && <>
        <Button onClick={() => runCommand('view.actual')}>100%</Button>
        <Button onClick={() => runCommand('view.fit')}>{t('options.fit')}</Button>
        <Button onClick={() => runCommand('view.center')}>{t('options.center')}</Button>
      </>}

      {(has(INK) || tool === 'eraser') && <>
        <Separator />
        <More>
          {(tool === 'pencil' || tool === 'eraser' || tool === 'spray') && <PopupRow><Pressure spray={tool === 'spray'} /></PopupRow>}
          {(tool === 'pencil' || tool === 'eraser') && (
            <Num label={t('options.smooth')} value={state.stabilizer} min={0} max={64} set={v => { state.stabilizer = v; }}
              title={t('options.stabilizerTheBrushTrails')} />
          )}
          {has(INK) && !state.customBrush && state.ink !== 'shade' && <PopupRow>
        <Label title={t('options.mixThePrimaryAnd')}>
          {t('common.pattern')}
          <Select value={state.paintPattern} onChange={e => { state.paintPattern = e.target.value as PaintPattern; }}>
            <option value="none">{t('options.solid')}</option>
            <option value="checker">{t('options.checker')}</option>
            <option value="ordered2">{t('options.ordered2x2')}</option>
            <option value="ordered4">{t('options.ordered4x4')}</option>
            <option value="custom" disabled={!state.patternBits}>{t('options.fromSelection')}</option>
          </Select>
        </Label>
        {(state.paintPattern === 'ordered2' || state.paintPattern === 'ordered4') && (
          <Num label={t('options.density')} value={state.patternDensity} min={1} max={99} set={v => { state.patternDensity = v; }} title={t('options.shareOfPrimaryColor')} />
        )}
        <Button title={t('options.opaquePixelsOfThe')} onClick={() => runCommand('edit.patternFromSelection')}>{t('options.patternFromSelection')}</Button>
          </PopupRow>}
          {has(INK) && <PopupRow><BrushLibrary /></PopupRow>}
        </More>
      </>}

      {has(SYMMETRY) && <>
        <Separator />
        <Button $square $active={state.symmetryX} title={t('options.mirrorDrawingLeftRight')} onClick={() => { state.symmetryX = !state.symmetryX; }}><Icon name="symmetryX" scale="glyph" /></Button>
        <Button $square $active={state.symmetryY} title={t('options.mirrorDrawingTopBottom')} onClick={() => { state.symmetryY = !state.symmetryY; }}><Icon name="symmetryY" scale="glyph" /></Button>
        <Button $square $active={state.symmetryD1} title={t('options.mirrorAcrossTheDiagonal')} onClick={() => { state.symmetryD1 = !state.symmetryD1; }}><Icon name="symmetryD1" scale="glyph" /></Button>
        <Button $square $active={state.symmetryD2} title={t('options.mirrorAcrossTheDiagonalWith')} onClick={() => { state.symmetryD2 = !state.symmetryD2; }}><Icon name="symmetryD2" scale="glyph" /></Button>
        <Button $square $active={state.tiledX || state.tiledY} title={t('options.wrapAroundEdgesTile')}
          onClick={() => { const on = !(state.tiledX || state.tiledY); state.tiledX = on; state.tiledY = on; }}><Icon name="tile" scale="glyph" /></Button>
      </>}


    </Bar>
  );
};
