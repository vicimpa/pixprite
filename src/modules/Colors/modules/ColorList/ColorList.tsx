import { Color } from "~/core/Color";
import { savePalette } from "~/core/Files";
import { gradientPalette, moveInPalette, recentColors, removeDuplicates, removeFromPalette, removeUnused, reversePalette, selectPixelsOf, setTransparentIndex, sortPalette, type RampSpace, type SortKey } from "~/core/PaletteOps";
import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { openContextMenu, type MenuItems } from "~/ui/Menu";
import { Icon } from "~/ui/Icon";
import { Button } from "~/ui/Button";
import { Panel } from "~/ui/Panel";
import { paletteDialogs } from "~/modules/Dialogs/Palette";
import { useSignals } from "@preact/signals-react/runtime";
import { useRef, useState, type FC, type PointerEvent } from "react";
import * as styled from "./styled";
import { useViewport } from "~/ui/useViewport";
import { indices, visibleRange } from "~/ui/virtualGeometry";

const SORTS: [SortKey, string][] = [
  ['hue', 'common.hue'], ['saturation', 'common.saturation'], ['lightness', 'common.lightness'], ['luminance', 'colors.luminance'],
  ['red', 'colors.red'], ['green', 'colors.green'], ['blue', 'colors.blue'], ['alpha', 'common.alpha'],
];

function paletteMenu(): MenuItems {
  const sel = state.paletteSelection.length;
  return [
    { label: t('colors.addPrimaryColor'), run: () => state.addToPalette(state.colorA) },
    { label: t('colors.deleteSelected'), disabled: !sel, run: () => removeFromPalette() },
    '-',
    {
      label: sel > 1 ? t('colors.sortSelectedBy', { n: sel }) : t('colors.sortBy'), items: [
        ...SORTS.map(([k, l]) => ({ label: t(l), run: () => sortPalette(k) })),
        '-',
        ...SORTS.map(([k, l]) => ({ label: t('colors.descending', { name: t(l) }), run: () => sortPalette(k, true) })),
      ]
    },
    { label: t('colors.reverse'), run: () => reversePalette() },
    {
      label: t('colors.gradientBetweenEndsOf'), disabled: sel < 2, items: ([['rgb', 'colors.rgb'], ['hsv', 'colors.hsv'], ['oklab', 'common.perceptualOklab']] as [RampSpace, string][]).map(([k, l]) => ({
        label: t(l), run: () => { if (!gradientPalette(k)) state.showTip(t('colors.selectARangeOf')); },
      })),
    },
    { label: t('colors.insertColorRamp'), run: () => paletteDialogs.ramp() },
    '-',
    { label: t('colors.removeDuplicates'), run: () => { const n = removeDuplicates(); state.showTip(t('colors.removedN', { n })); if (n) state.save(); } },
    { label: t('colors.removeUnusedColors'), run: () => { const n = removeUnused(); state.showTip(t('colors.removedN', { n })); if (n) state.save(); } },
    { label: t('colors.selectPixelsOfThis'), disabled: sel !== 1, run: () => selectPixelsOf(state.palette[state.paletteSelection[0]]) },
    ...(state.sprite.colorMode === 'indexed' ? [{
      label: t('colors.transparentEntry'), items: [
        { label: t('common.none'), checked: state.sprite.transparentIndex < 0, run: () => setTransparentIndex(-1) },
        { label: t('colors.selectedEntry'), disabled: sel !== 1, checked: sel === 1 && state.sprite.transparentIndex === state.paletteSelection[0], run: () => setTransparentIndex(state.paletteSelection[0]) },
      ],
    }] : []),
    '-',
    { label: t('colors.paletteSize'), run: () => paletteDialogs.size() },
    { label: t('colors.fromTheSpriteColors'), run: () => paletteDialogs.fromSprite() },
    { label: t('colors.presets'), run: () => paletteDialogs.presets() },
    '-',
    {
      label: t('colors.ownPaletteFromThis'), disabled: state.sprite.framePalettes.some(k => k.frame === state.sprite.frame),
      run: () => { state.sprite.addFramePalette(state.palette); state.save(); },
    },
    {
      label: t('colors.removeThisFramesPalette'), disabled: !state.sprite.framePaletteAt(),
      run: () => { state.sprite.removeFramePalette(); state.save(); },
    },
    '-',
    {
      label: t('colors.savePaletteAs'), items: [
        { label: t('colors.gimpGpl'), run: () => savePalette('gpl') },
        { label: t('colors.jascPal'), run: () => savePalette('pal') },
        { label: t('colors.hexListHex'), run: () => savePalette('hex') },
        { label: t('colors.adobeAct'), run: () => savePalette('act') },
      ]
    },
    '-',
    { label: t('colors.smallSwatches'), checked: state.layout.paletteBox === 12, run: () => state.setLayout({ paletteBox: 12 }) },
    { label: t('colors.mediumSwatches'), checked: state.layout.paletteBox === 16, run: () => state.setLayout({ paletteBox: 16 }) },
    { label: t('colors.largeSwatches'), checked: state.layout.paletteBox === 24, run: () => state.setLayout({ paletteBox: 24 }) },
  ];
}

/** Last primary colors; click picks (right click: secondary) */
const RecentStrip: FC = () => {
  useSignals();
  const list = recentColors.value;
  if (!list.length) return null;
  return (
    <styled.Recent title={t('colors.recentColors')} onContextMenu={e => e.preventDefault()}>
      {list.map(hex => (
        <span key={hex} style={{ background: hex }} title={hex}
          onPointerDown={e => { const c = Color.fromHex(hex); if (e.button === 2) state.colorB = c; else state.colorA = c; }} />
      ))}
    </styled.Recent>
  );
};

type Drag =
  | { mode: 'pick'; anchor: number; button: number; }
  | { mode: 'move'; from: number; target: number | null; };

/**
 * Palette grid. Left/right click pick primary/secondary (also while dragging across swatches),
 * Ctrl/Shift extend the selection, dragging a selected swatch moves the block (Ctrl/Alt copies).
 */
export const ColorList: FC = () => {
  useSignals();
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { palette, paletteSelection: sel } = state;
  const a = state.colorA.toHexString(false), b = state.colorB.toHexString(false);
  const box = state.layout.paletteBox;
  const viewport = useViewport(ref);
  const columns = Math.max(1, Math.floor((viewport.width - 5) / (box + 1)));
  const rows = Math.ceil(palette.length / columns);
  const window = visibleRange(rows, box + 1, viewport.top, viewport.height);
  const entries = indices({ start: window.start * columns, end: Math.min(palette.length, window.end * columns) });

  const indexAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-i]');
    return el ? +el.dataset.i! : null;
  };

  const pick = (i: number, secondary: boolean) => {
    const c = Color.fromHex(palette[i]);
    if (secondary) state.colorB = c;
    else state.colorA = c;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.clientX, e.clientY);
    if (i === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.altKey && !sel.includes(i)) return removeFromPalette([i]);
    if (e.button === 0 && sel.includes(i) && sel.length > 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setDrag({ mode: 'move', from: i, target: null });
      return;
    }
    if (e.shiftKey && sel.length) {
      const anchor = sel[0];
      state.paletteSelection = Array.from({ length: Math.abs(i - anchor) + 1 }, (_, k) => Math.min(i, anchor) + k);
    } else if (e.ctrlKey || e.metaKey) {
      state.paletteSelection = sel.includes(i) ? sel.filter(s => s !== i) : [...sel, i];
    } else {
      state.paletteSelection = [i];
    }
    pick(i, e.button === 2);
    setDrag({ mode: 'pick', anchor: i, button: e.button });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.clientX, e.clientY);
    if (i !== null) state.hint = `Entry ${i}: ${palette[i]}`;
    if (!drag || i === null) return;
    if (drag.mode === 'pick') {
      // Dragging across swatches selects a range and keeps picking
      state.paletteSelection = Array.from({ length: Math.abs(i - drag.anchor) + 1 }, (_, k) => Math.min(i, drag.anchor) + k);
      pick(i, drag.button === 2);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-i]');
    const r = el?.getBoundingClientRect();
    const target = r ? i + (e.clientX > r.left + r.width / 2 ? 1 : 0) : i;
    if (target !== drag.target) setDrag({ ...drag, target });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag;
    setDrag(null);
    if (d?.mode !== 'move') return;
    if (d.target === null || d.target === d.from || d.target === d.from + 1 && sel.length === 1) {
      // Plain click on a selected swatch: pick it
      state.paletteSelection = [d.from];
      pick(d.from, false);
      return;
    }
    moveInPalette(sel, d.target, e.ctrlKey || e.metaKey || e.altKey);
    state.save();
  };

  const notInPalette = (c: Color) => !palette.some(p => p.slice(0, 7).toLowerCase() === c.toHexString(false).toLowerCase());

  return (
    <Panel>
      <styled.Root>
        <styled.Bar>
          <Button $square title={t('colors.paletteOptions')} onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            openContextMenu(paletteMenu(), r.left, r.bottom);
          }}><Icon name="gear" scale="glyph" /></Button>
          <Button $square title={t('colors.addThePrimaryColor')} onClick={() => state.addToPalette(state.colorA)}><Icon name="plus" scale="glyph" /></Button>
          <Button $square title={t('colors.deleteSelectedEntriesAlt')} disabled={!sel.length} onClick={() => removeFromPalette()}><Icon name="trash" scale="glyph" /></Button>
          <Button $active={state.editPaletteEntry} disabled={sel.length !== 1}
            title={t('colors.editModeTheColor')}
            onClick={() => { state.editPaletteEntry = !state.editPaletteEntry; }}>{t('colors.edit')}</Button>
          <span style={{ flexGrow: 1 }} />
          {notInPalette(state.colorA) && (
            <styled.Warn title={t('colors.thePrimaryColorIs')} onClick={() => state.addToPalette(state.colorA)}>
              <Icon name="plus" scale="glyph" /> {a}
            </styled.Warn>
          )}
          <styled.Count>{palette.length}</styled.Count>
        </styled.Bar>
        <styled.List
          ref={ref}
          style={{ position: 'relative', display: 'block', padding: 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!drag) state.hint = ''; }}
          onContextMenu={e => e.preventDefault()}
          onWheel={e => {
            if (!(e.ctrlKey || e.metaKey)) return;
            state.setLayout({ paletteBox: Math.max(8, Math.min(40, box + (e.deltaY < 0 ? 2 : -2))) });
          }}
        >
          <div style={{ height: rows * (box + 1) + 5, position: 'relative' }}>
          {entries.map(i => { const hex = palette[i]; return (
            <styled.Swatch
              key={i}
              data-i={i}
              data-selected={sel.includes(i)}
              data-drop={drag?.mode === 'move' && drag.target === i}
              style={{ backgroundColor: hex, position: 'absolute', left: 3 + (i % columns) * (box + 1), top: 3 + Math.floor(i / columns) * (box + 1), width: box, height: box }}
            >
              {hex.slice(0, 7).toLowerCase() === a.toLowerCase() && <styled.MarkA />}
              {hex.slice(0, 7).toLowerCase() === b.toLowerCase() && <styled.MarkB />}
              {state.sprite.colorMode === 'indexed' && state.sprite.transparentIndex === i && <styled.MarkT title={t('colors.transparentEntry')} />}
            </styled.Swatch>
          ); })}
          </div>
        </styled.List>
        <RecentStrip />
      </styled.Root>
    </Panel>
  );
};
