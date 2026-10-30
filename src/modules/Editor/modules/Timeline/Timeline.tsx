import { t } from "~/core/i18n";
import { runCommand } from "~/core/Commands";
import { parentOf, subtreeStart, type Range } from "~/core/Sprite";
import { state } from "~/core/State";
import { Button, Check, Label, Muted, Range as Slider, Select, Separator } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { openContextMenu, type MenuItems } from "~/ui/Menu";
import { item } from "~/modules/MainMenu";
import { dialogs } from "~/modules/Dialogs";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type FC, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import * as styled from "./styled";
import { useViewport } from "~/ui/useViewport";
import { indices, visibleRange } from "~/ui/virtualGeometry";

type Hit =
  | { kind: 'frame'; f: number; }
  | { kind: 'layer'; l: number; }
  | { kind: 'cel'; l: number; f: number; };

/** A drag in the timeline: extending a range, or moving/copying the selected block */
type Drag =
  | { mode: 'select'; anchor: Hit; }
  | { mode: 'move'; range: Range; from: Hit; target: { l: number; f: number; } | null; };

const LAYER_MENU = (): MenuItems => [
  item('layer.new'), item('layer.duplicate'), item('layer.delete'), '-',
  item('layer.mask'), item('layer.properties'), item('layer.continuous'), '-',
  item('layer.toBackground'), item('layer.fromBackground'), '-',
  item('layer.mergeDown'), item('layer.flatten'),
];

const FRAME_MENU = (): MenuItems => [
  item('anim.frameProperties'), '-',
  item('anim.newFrame'), item('anim.newEmptyFrame'), item('anim.deleteFrame'), '-',
  item('anim.newTag'), item('anim.loop'), item('anim.reverse'),
];

const CEL_MENU = (): MenuItems => [
  item('cel.properties'), '-',
  item('cel.clear'), item('cel.unlink'), item('cel.link'), '-',
  item('cel.duplicate'), item('cel.duplicateLinked'),
];

function hitOf(el: Element | null): Hit | null {
  const t = el?.closest<HTMLElement>('[data-hit]');
  if (!t) return null;
  const { hit, l, f } = t.dataset;
  if (hit === 'frame') return { kind: 'frame', f: +f! };
  if (hit === 'layer') return { kind: 'layer', l: +l! };
  if (hit === 'cel') return { kind: 'cel', l: +l!, f: +f! };
  return null;
}

/** Normalized range spanning two hits */
function rangeOf(a: Hit, b: Hit): Range {
  const { sprite } = state;
  const allLayers: [number, number] = [0, sprite.layers.length - 1];
  const allFrames: [number, number] = [0, sprite.frames.length - 1];
  const span = (x: number, y: number): [number, number] => [Math.min(x, y), Math.max(x, y)];
  if (a.kind === 'frame') return { type: 'frames', layers: allLayers, frames: span(a.f, b.kind === 'layer' ? a.f : b.f) };
  if (a.kind === 'layer') return { type: 'layers', layers: span(a.l, b.kind === 'frame' ? a.l : b.l), frames: allFrames };
  const bl = b.kind === 'frame' ? a.l : b.l, bf = b.kind === 'layer' ? a.f : b.f;
  return { type: 'cels', layers: span(a.l, bl), frames: span(a.f, bf) };
}

function inRange(r: Range | null, l: number | null, f: number | null) {
  if (!r) return false;
  const inL = l === null || (l >= r.layers[0] && l <= r.layers[1]);
  const inF = f === null || (f >= r.frames[0] && f <= r.frames[1]);
  return inL && inF;
}

/** Closes on any outside pointer press */
function useOutside(close: () => void) {
  useEffect(() => {
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, []);
}

const OnionOptions: FC<{ close: () => void; x: number; y: number; }> = ({ close, x, y }) => {
  useSignals();
  useOutside(close);
  const { prefs } = state;
  const set = state.setPrefs.bind(state);
  return createPortal(
    <styled.Popup style={{ left: x, top: y }} onPointerDown={e => e.stopPropagation()}>
      <Label><Check checked={state.onion} onChange={e => { state.onion = e.target.checked; }} /> {t('common.onionSkin')}</Label>
      <Label>{t('timeline.before')} <styled.Num type="number" min={0} max={8} value={prefs.onionBefore} onChange={e => set({ onionBefore: Math.max(0, Math.min(8, +e.target.value)) })} /></Label>
      <Label>{t('timeline.after')} <styled.Num type="number" min={0} max={8} value={prefs.onionAfter} onChange={e => set({ onionAfter: Math.max(0, Math.min(8, +e.target.value)) })} /></Label>
      <Label>{t('common.opacity')} <Slider min={5} max={100} value={Math.round(prefs.onionOpacity * 100)} onChange={e => set({ onionOpacity: +e.target.value / 100 })} /></Label>
      <Label>{t('timeline.fadePerFrame')} <Slider min={0} max={50} value={Math.round(prefs.onionStep * 100)} onChange={e => set({ onionStep: +e.target.value / 100 })} /></Label>
      <Label>
        {t('common.look')}
        <Select value={prefs.onionMode} onChange={e => set({ onionMode: e.target.value as 'merge' | 'tint' })}>
          <option value="merge">{t('common.plain')}</option>
          <option value="tint">{t('timeline.redPastBlueFuture')}</option>
        </Select>
      </Label>
      <Label><Check checked={prefs.onionFront} onChange={e => set({ onionFront: e.target.checked })} /> {t('timeline.drawOnTop')}</Label>
      <Label><Check checked={prefs.onionInTag} onChange={e => set({ onionInTag: e.target.checked })} /> {t('timeline.wrapInsideTheTag')}</Label>
    </styled.Popup>,
    document.body
  );
};

const PlayOptions: FC<{ close: () => void; x: number; y: number; }> = ({ close, x, y }) => {
  useSignals();
  useOutside(close);
  const { prefs } = state;
  const set = state.setPrefs.bind(state);
  return createPortal(
    <styled.Popup style={{ left: x, top: y }} onPointerDown={e => e.stopPropagation()}>
      <Label>
        {t('timeline.speed')}
        <Select value={prefs.playSpeed} onChange={e => set({ playSpeed: +e.target.value })}>
          {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map(v => <option key={v} value={v}>×{v}</option>)}
        </Select>
      </Label>
      <Label><Check checked={prefs.playOnce} onChange={e => set({ playOnce: e.target.checked })} /> {t('common.playOnce')}</Label>
      <Label><Check checked={prefs.rewindOnStop} onChange={e => set({ rewindOnStop: e.target.checked })} /> {t('timeline.returnToTheStart')}</Label>
    </styled.Popup>,
    document.body
  );
};

const LayerName: FC<{ index: number; }> = ({ index }) => {
  useSignals();
  const { sprite } = state;
  const layer = sprite.layers[index];
  const [edit, setEdit] = useState(false);

  if (edit) return (
    <styled.NameInput
      autoFocus
      defaultValue={layer.name}
      onFocus={e => e.currentTarget.select()}
      onPointerDown={e => e.stopPropagation()}
      onBlur={e => {
        if (e.target.value && e.target.value !== layer.name)
          sprite.updateLayer(index, { name: e.target.value }, 'Rename layer');
        setEdit(false);
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { e.currentTarget.value = layer.name; e.currentTarget.blur(); }
      }} />
  );

  return (
    <styled.Name onDoubleClick={e => { e.stopPropagation(); setEdit(true); }} title={t('timeline.doubleClickToRename')}
      style={{ paddingLeft: 6 + layer.depth * 10, fontWeight: layer.group ? 600 : undefined }}>
      {layer.clip && <Muted title={t('timeline.clippedToTheLayer')}>↳ </Muted>}
      {layer.name}
      {layer.reference && <Muted> · ref</Muted>}
      {layer.background && <Muted> · bg</Muted>}
      {layer.blend !== 'source-over' && <Muted> · {layer.blend}</Muted>}
      {layer.opacity < 1 && <Muted> · {Math.round(layer.opacity * 100)}%</Muted>}
    </styled.Name>
  );
};

/** Black or white, whichever reads better on `hex` */
function contrastText(hex: string) {
  const v = parseInt(hex.slice(1, 7), 16);
  const lum = 0.299 * (v >> 16 & 255) + 0.587 * (v >> 8 & 255) + 0.114 * (v & 255);
  return lum > 140 ? '#111' : '#fff';
}

/** Tags laid out in as few rows as possible; a long name reserves the frames it covers too */
function tagRows() {
  const { tags } = state.sprite;
  const cell = state.ui.cell;
  // Rough label width in frames (the label can stick out past a short tag)
  const end = (i: number) => Math.max(tags[i].to, tags[i].from + Math.ceil((tags[i].name.length * 7 + 14) / cell) - 1);
  const rows: number[][] = [];
  tags.forEach((t, i) => {
    const row = rows.find(r => r.every(j => end(i) < tags[j].from || t.from > end(j)));
    if (row) row.push(i);
    else rows.push([i]);
  });
  return rows;
}

export const Timeline: FC = () => {
  useSignals();
  const { sprite, ui } = state;
  void sprite.version;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [popup, setPopup] = useState<{ kind: 'onion' | 'play'; x: number; y: number; } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const viewport = useViewport(scroll);
  const cell = ui.cell;
  const nameWidth = 160;
  // Topmost first; layers inside folded groups are left out
  const folded = (i: number) => {
    for (let p = parentOf(sprite.layers, i); p >= 0; p = parentOf(sprite.layers, p))
      if (sprite.layers[p].collapsed) return true;
    return false;
  };
  const order = sprite.layers.map((_, i) => sprite.layers.length - 1 - i).filter(i => !folded(i));
  const rows = tagRows();
  const r = sprite.range;
  const total = sprite.frames.reduce((a, f) => a + f.duration, 0);
  const headTop = rows.length * cell;
  const frames = indices(visibleRange(sprite.frames.length, cell, viewport.left, viewport.width - cell * 3 - nameWidth));
  const layerRows = indices(visibleRange(order.length, cell, viewport.top, viewport.height - headTop - cell));

  // Keep the current frame in view horizontally (also while playing)
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const left = cell * 3 + nameWidth;
    const x = left + sprite.frame * cell;
    if (x < el.scrollLeft + left) el.scrollLeft = x - left;
    else if (x + cell > el.scrollLeft + el.clientWidth) el.scrollLeft = x + cell - el.clientWidth;
  }, [sprite.frame, sprite.frames.length, cell, viewport.width]);

  // ...and the current layer vertically, only when the layer changes (playback leaves rows alone)
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const top = headTop + cell;
    const y = order.indexOf(sprite.layer) * cell;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + cell + top > el.scrollTop + el.clientHeight) el.scrollTop = y + cell + top - el.clientHeight;
  }, [sprite.layer, sprite.layers.length, cell, headTop, viewport.height, order.join(",")]);

  const pick = (h: Hit) => {
    sprite.dropFloating();
    state.playing = false;
    if (h.kind !== 'frame') sprite.layer = h.l;
    if (h.kind !== 'layer') sprite.frame = h.f;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const h = hitOf(e.target as Element);
    if (!h || e.button === 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const l = h.kind === 'frame' ? null : h.l, f = h.kind === 'layer' ? null : h.f;
    const sameKind = !!r && (h.kind === 'frame' ? r.type === 'frames' : h.kind === 'layer' ? r.type === 'layers' : r.type === 'cels');
    const inside = sameKind && inRange(r, l, f);

    if (e.button === 2) {
      // Right click keeps a range it lands in, so the menu acts on all of it
      if (!inside) { pick(h); sprite.range = rangeOf(h, h); }
      const menu = h.kind === 'frame' ? FRAME_MENU() : h.kind === 'layer' ? LAYER_MENU() : CEL_MENU();
      openContextMenu(menu, e.clientX, e.clientY);
      return;
    }

    // Dragging inside the selection moves (or with Ctrl/Alt copies) it
    if (inside && r) {
      setDrag({ mode: 'move', range: r, from: h, target: null });
      return;
    }
    if (e.shiftKey && sameKind) {
      const anchor: Hit = h.kind === 'frame' ? { kind: 'frame', f: sprite.frame } : h.kind === 'layer' ? { kind: 'layer', l: sprite.layer } : { kind: 'cel', l: sprite.layer, f: sprite.frame };
      sprite.range = rangeOf(anchor, h);
      setDrag({ mode: 'select', anchor });
      return;
    }
    pick(h);
    sprite.range = rangeOf(h, h);
    setDrag({ mode: 'select', anchor: h });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const h = hitOf(target);
    if (!drag) {
      // Status text for whatever is under the mouse
      if (!h) return;
      if (h.kind === 'frame' || h.kind === 'cel') {
        // Frame, its duration, the span of the tag (or range) it is in, and the whole animation
        const ms = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n}ms`;
        const total = (a: number, b: number) => sprite.frames.slice(a, b + 1).reduce((t, fr) => t + fr.duration, 0);
        const tag = sprite.tagAt(h.f);
        const span = tag ? [tag.from, tag.to] : sprite.range && sprite.range.type !== 'layers' && sprite.range.frames[1] > sprite.range.frames[0] ? sprite.range.frames : null;
        let text = `Frame ${h.f + 1}`;
        if (span) text += ` [${span[0] + 1}…${span[1] + 1}]`;
        text += ` · ${ms(sprite.frames[h.f].duration)}`;
        if (span) text += ` [${ms(total(span[0], span[1]))}]`;
        if (sprite.frames.length > 1) text += ` / ${ms(total(0, sprite.frames.length - 1))}`;
        if (h.kind === 'cel') {
          const c = sprite.layers[h.l].cels[h.f];
          if (c) text += ` · cel ${c.x}, ${c.y} ${c.w}×${c.h}`;
          else text += ' · empty';
          if (sprite.isLinked(h.l, h.f)) text += ` · linked ×${sprite.linkedFrames(h.l, h.f).length}`;
        }
        state.hint = text;
      } else if (h.kind === 'layer') {
        const ly = sprite.layers[h.l];
        state.hint = `${ly.name} · ${ly.visible ? 'visible' : 'hidden'}${ly.locked ? ' · locked' : ''}${ly.continuous ? ' · links new frames' : ''}`;
      }
      return;
    }
    if (!h) return;
    if (drag.mode === 'select') {
      if (drag.anchor.kind === 'frame' && h.kind === 'layer') return;
      if (drag.anchor.kind === 'layer' && h.kind === 'frame') return;
      sprite.range = rangeOf(drag.anchor, h);
      if (h.kind !== 'layer' && drag.anchor.kind !== 'layer') sprite.frame = h.f;
      if (h.kind !== 'frame' && drag.anchor.kind !== 'frame') sprite.layer = h.l;
      return;
    }
    // Moving a block: frames/layers insert at the hovered half, cels shift by the offset
    const box = target?.closest<HTMLElement>('[data-hit]')?.getBoundingClientRect();
    const kind = drag.range.type;
    let t: { l: number; f: number; } | null = null;
    if (kind === 'frames' && h.kind !== 'layer' && box) t = { l: 0, f: h.f + (e.clientX > box.left + box.width / 2 ? 1 : 0) };
    if (kind === 'layers' && h.kind !== 'frame' && box) t = { l: h.l + (e.clientY < box.top + box.height / 2 ? 1 : 0), f: 0 };
    if (kind === 'cels' && h.kind === 'cel' && drag.from.kind === 'cel') t = { l: h.l - drag.from.l, f: h.f - drag.from.f };
    // Hovering the start cell means "no move yet"
    if (t && kind === 'cels' && !t.l && !t.f) t = null;
    setDrag({ ...drag, target: t });
    const copy = e.ctrlKey || e.metaKey || e.altKey;
    state.hint = !t ? '' : kind === 'frames' ? `${copy ? 'Copy' : 'Move'} to before frame ${t.f + 1}`
      : kind === 'layers' ? `${copy ? 'Copy' : 'Move'} layers to position ${t.l + 1}`
        : `${copy ? 'Copy' : 'Move'} cels by ${t.f} frame(s), ${t.l} layer(s)`;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag;
    setDrag(null);
    if (!d || d.mode !== 'move') return;
    const h = hitOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!d.target) {
      // A plain click inside a range selects just that cell
      if (h) { pick(h); sprite.range = rangeOf(h, h); }
      return;
    }
    const copy = e.ctrlKey || e.metaKey || e.altKey;
    const { range } = d;
    if (range.type === 'frames') sprite.moveFrames(range.frames, d.target.f, copy);
    else if (range.type === 'layers') {
      if (!sprite.moveLayers(range.layers, d.target.l, copy)) state.showTip(t('timeline.theBackgroundLayerStays'));
    } else sprite.moveCels(range, d.target.l, d.target.f, copy);
    state.hint = '';
    state.save();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const h = hitOf(e.target as Element);
    if (h?.kind === 'frame') dialogs.frameProperties();
    if (h?.kind === 'cel') dialogs.celProperties();
  };

  const toggle = (l: number, flag: 'visible' | 'locked' | 'continuous') => (e: React.MouseEvent) => {
    e.stopPropagation();
    // Alt+click on the eye shows only this layer, again brings the others back
    if (flag === 'visible' && e.altKey) sprite.soloLayer(l);
    else sprite.updateLayer(l, { [flag]: !sprite.layers[l][flag] }, 'Layer flags');
    state.save();
  };

  const groupHas = (g: number, f: number) => {
    for (let k = subtreeStart(sprite.layers, g); k < g; k++) if (!sprite.layers[k].group && sprite.layers[k].cels[f]) return true;
    return false;
  };

  // Cels linked to the active cel get highlighted
  const activeCel = sprite.getCel();
  // The copied range stays outlined until it is pasted
  const clip = state.clipSource?.sprite === sprite ? state.clipSource.range : null;
  const moving = drag?.mode === 'move' ? drag : null;
  const target = moving?.target ?? null;

  const popupAt = (e: React.MouseEvent, kind: 'onion' | 'play', h: number) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setPopup({ kind, x: box.left, y: Math.max(4, box.top - h) });
  };

  return (
    <styled.Root>
      <styled.Toolbar>
        <Button $square $active={state.playing} title={t('timeline.playStopEnterRight')}
          onClick={() => runCommand('anim.play')}
          onContextMenu={e => popupAt(e, 'play', 110)}>
          <Icon name={state.playing ? 'pause' : 'play'} scale="glyph" />
        </Button>
        <Button $square $active={state.onion} title={t('timeline.onionSkinORight')}
          onClick={() => runCommand('anim.onion')}
          onContextMenu={e => popupAt(e, 'onion', 260)}>
          <Icon name="onion" scale="glyph" />
        </Button>
        <Button $square title={t('timeline.onionSkinAndPlayback')} onClick={e => popupAt(e, 'onion', 260)}>
          <Icon name="gear" scale="glyph" />
        </Button>
        <Separator />
        <Button title={t('timeline.newFrameAltN')} onClick={() => runCommand('anim.newFrame')}><Icon name="plus" scale="glyph" /> {t('common.frame')}</Button>
        <Button $square title={t('timeline.deleteFrameS')} disabled={sprite.frames.length < 2} onClick={() => runCommand('anim.deleteFrame')}><Icon name="trash" scale="glyph" /></Button>
        <Button title={t('timeline.frameTimingAltT')} onClick={() => runCommand('anim.frameProperties')}>{sprite.frames[sprite.frame]?.duration}ms</Button>
        <Button title={t('timeline.tagTheSelectedFrames')} onClick={() => runCommand('anim.newTag')}>{t('timeline.tag')}</Button>
        <Button $active={!!sprite.loop} title={t('timeline.loopTheSelectedFrames')} onClick={() => runCommand('anim.loop')}>{t('timeline.loop')}</Button>
        <Separator />
        <Button title={t('timeline.newLayerShiftN')} onClick={() => runCommand('layer.new')}><Icon name="plus" scale="glyph" /> {t('timeline.layer')}</Button>
        <Button $square title={t('timeline.duplicateLayer')} onClick={() => runCommand('layer.duplicate')}><Icon name="duplicate" scale="glyph" /></Button>
        <Button $square title={t('timeline.deleteLayer')} disabled={sprite.layers.length < 2} onClick={() => runCommand('layer.delete')}><Icon name="trash" scale="glyph" /></Button>
        <Button title={t('common.layerProperties')} onClick={() => dialogs.layerProperties()}>{t('timeline.props')}</Button>
        <Button title={t('mask.title')} disabled={!!sprite.current?.reference} onClick={() => dialogs.layerMask()}>{t('mask.button')}{sprite.current?.mask ? ' ●' : ''}</Button>
        {(sprite.current?.mask || sprite.editingChannel === 'mask') && <>
          <Button data-testid="mask-channel" data-active={sprite.editingMask} onClick={() => sprite.setEditingChannel(sprite.editingChannel === 'mask' ? 'color' : 'mask')}>
            {t(sprite.editingMask ? 'mask.editing' : 'mask.colorChannel')}
          </Button>
          <Button data-testid="mask-view" data-active={sprite.maskView && sprite.editingMask} disabled={!sprite.editingMask}
            onClick={() => { sprite.maskView = !sprite.maskView; }}>{t('mask.view')}</Button>
        </>}
        <Button title={t('dialog.layerFX.title')} disabled={!!sprite.current?.reference} onClick={() => dialogs.layerEffects()}>FX{sprite.current?.effects?.length ? ` (${sprite.current.effects.length})` : ''}</Button>
        <span style={{ flexGrow: 1 }} />
        <Muted>
          {sprite.frames.length} frames · {(total / 1000).toFixed(2)}s
          {r && (r.frames[1] > r.frames[0] || r.layers[1] > r.layers[0]) ? ' · drag the selection to move, Ctrl/Alt to copy' : ''}
        </Muted>
      </styled.Toolbar>

      <styled.Scroll
        ref={scroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag) state.hint = ''; }}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => e.preventDefault()}
        onWheel={e => {
          if (e.ctrlKey || e.metaKey) e.currentTarget.scrollLeft += (e.deltaY || e.deltaX) * (e.shiftKey ? 3 : 1);
        }}
      >
        <styled.Grid style={{
          gridTemplateRows: `repeat(${rows.length + 1 + order.length}, ${cell}px)`,
          gridTemplateColumns: `${cell}px ${cell}px ${cell}px ${nameWidth}px repeat(${sprite.frames.length}, ${cell}px) 1fr`,
        }}>
          {rows.map((row, ri) => (
            <div key={'tags' + ri} className="contents">
              <styled.Corner style={{ gridRow: ri + 1, gridColumn: '1 / 5', top: ri * cell }} />
              {row.filter(i => sprite.tags[i].from < frames.at(-1)! + 1 && Math.max(sprite.tags[i].to, sprite.tags[i].from + Math.ceil((sprite.tags[i].name.length * 7 + 14) / cell) - 1) >= (frames[0] ?? 0)).map(i => {
                const tag = sprite.tags[i];
                return (
                  <styled.TagCell key={i} style={{ gridColumn: `${tag.from + 5} / ${tag.to + 6}`, gridRow: ri + 1, top: ri * cell }}>
                    <styled.Tag
                      style={{ borderColor: tag.color }}
                      title={`${tag.name}: frames ${tag.from + 1}–${tag.to + 1} (${tag.direction}). Click selects its frames, drag moves it, drag an end to resize, double click to edit`}
                      onPointerMove={e => {
                        // Half a frame at each end resizes
                        const r = e.currentTarget.getBoundingClientRect();
                        const edge = Math.min(cell / 2, r.width / 3);
                        e.currentTarget.style.cursor = e.clientX - r.left < edge || r.right - e.clientX < edge ? 'ew-resize' : 'grab';
                      }}
                      onPointerDown={e => {
                        e.stopPropagation();
                        if (e.button !== 0) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const edge = Math.min(cell / 2, r.width / 3);
                        const mode = e.clientX - r.left < edge ? 'from' : r.right - e.clientX < edge ? 'to' : 'move';
                        const start = { ...tag }, sx = e.clientX, last = sprite.frames.length - 1;
                        let changed = false;
                        const move = (ev: globalThis.PointerEvent) => {
                          const df = Math.round((ev.clientX - sx) / cell);
                          let { from, to } = start;
                          if (mode === 'move') {
                            const d = Math.max(-from, Math.min(last - to, df));
                            from += d; to += d;
                          } else if (mode === 'from') from = Math.max(0, Math.min(to, from + df));
                          else to = Math.min(last, Math.max(from, to + df));
                          const cur = sprite.tags[i];
                          if (cur.from === from && cur.to === to) return;
                          if (!changed) sprite.checkpoint(mode === 'move' ? 'Move tag' : 'Resize tag');
                          changed = true;
                          sprite.updateTag(i, { from, to }, false);
                          state.hint = `${tag.name}: frames ${from + 1}–${to + 1}`;
                        };
                        const up = () => {
                          removeEventListener('pointermove', move);
                          removeEventListener('pointerup', up);
                          if (changed) return state.save();
                          // A plain click selects the tag's frames
                          sprite.range = { type: 'frames', layers: [0, sprite.layers.length - 1], frames: [tag.from, tag.to] };
                          sprite.frame = tag.from;
                        };
                        addEventListener('pointermove', move);
                        addEventListener('pointerup', up);
                      }}
                      onDoubleClick={() => dialogs.tagProperties(i)}
                      onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        openContextMenu([
                          { label: t('timeline.tagProperties'), run: () => dialogs.tagProperties(i) },
                          { label: t('common.deleteTag'), run: () => { sprite.removeTag(i); state.save(); } },
                        ], e.clientX, e.clientY);
                      }}
                    >
                      <styled.TagLabel style={{ background: tag.color, color: contrastText(tag.color) }}>
                        {tag.name}{tag.direction === 'reverse' ? ' ←' : tag.direction === 'pingpong' ? ' ↔' : tag.direction === 'pingpong-reverse' ? ' ⇆' : ''}
                      </styled.TagLabel>
                    </styled.Tag>
                  </styled.TagCell>
                );
              })}
              {/* Opaque band under the whole row, so layer rows scrolling beneath don't show through */}
              <styled.TagFill style={{ gridRow: ri + 1, gridColumn: `5 / ${sprite.frames.length + 6}`, top: ri * cell }} />
            </div>
          ))}

          {/* Header: all-layer toggles and frame numbers */}
          <styled.Corner style={{ gridRow: rows.length + 1, gridColumn: 1, top: headTop, left: 0 }} title={t('timeline.showHideAllLayers')} onClick={() => sprite.toggleAllLayers('visible')}>
            <Icon name={sprite.layers.every(l => !l.visible) ? 'eyeOff' : 'eye'} scale="glyph" />
          </styled.Corner>
          <styled.Corner style={{ gridRow: rows.length + 1, gridColumn: 2, top: headTop, left: cell }} title={t('timeline.lockUnlockAllLayers')} onClick={() => sprite.toggleAllLayers('locked')}>
            <Icon name={sprite.layers.every(l => l.locked) ? 'lock' : 'unlock'} scale="glyph" />
          </styled.Corner>
          <styled.Corner style={{ gridRow: rows.length + 1, gridColumn: 3, top: headTop, left: cell * 2 }} title={t('timeline.linkNewFramesOn')} onClick={() => sprite.toggleAllLayers('continuous')}>
            <Icon name="link" scale="glyph" />
          </styled.Corner>
          <styled.Corner style={{ gridRow: rows.length + 1, gridColumn: 4, top: headTop, left: cell * 3, justifyContent: 'flex-start', padding: '0 6px', cursor: 'default' }}>
            <Muted>{t('common.layers')}</Muted>
          </styled.Corner>
          {frames.map(f => {
            const frame = sprite.frames[f];
            const onionBand = state.onion && f !== sprite.frame && f >= sprite.frame - state.prefs.onionBefore && f <= sprite.frame + state.prefs.onionAfter;
            // Outer ends of the onion range can be dragged to change how many frames show
            const onionStart = Math.max(0, sprite.frame - state.prefs.onionBefore);
            const onionEnd = Math.min(sprite.frames.length - 1, sprite.frame + state.prefs.onionAfter);
            const onionEdge = !state.onion ? '' : f === onionStart ? 'start' : f === onionEnd ? 'end' : '';
            const loop = !!sprite.loop && f >= sprite.loop[0] && f <= sprite.loop[1];
            const drop = moving?.range.type === 'frames' && target
              ? target.f === f ? 'before' : target.f === f + 1 && f === sprite.frames.length - 1 ? 'after' : ''
              : '';
            return (
              <styled.FrameHead
                key={f}
                data-hit="frame"
                data-f={f}
                data-current={f === sprite.frame}
                data-selected={r?.type !== 'layers' && inRange(r, null, f)}
                data-onion={onionBand}
                data-onion-edge={onionEdge}
                data-loop={loop}
                onPointerMove={e => {
                  if (!onionEdge) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const near = onionEdge === 'start' ? e.clientX - r.left < 5 : r.right - e.clientX < 5;
                  e.currentTarget.style.cursor = near ? 'ew-resize' : '';
                }}
                onPointerDown={e => {
                  if (!onionEdge || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  if (onionEdge === 'start' ? e.clientX - r.left >= 5 : r.right - e.clientX >= 5) return;
                  e.stopPropagation();
                  const sx = e.clientX, base = onionEdge === 'start' ? state.prefs.onionBefore : state.prefs.onionAfter;
                  const move = (ev: globalThis.PointerEvent) => {
                    const df = Math.round((ev.clientX - sx) / cell);
                    const n = Math.max(0, base + (onionEdge === 'start' ? -df : df));
                    state.setPrefs(onionEdge === 'start' ? { onionBefore: n } : { onionAfter: n });
                    state.hint = `Onion skin: ${state.prefs.onionBefore} before, ${state.prefs.onionAfter} after`;
                  };
                  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
                  addEventListener('pointermove', move);
                  addEventListener('pointerup', up);
                }}
                data-drop={drop}
                style={{ gridRow: rows.length + 1, gridColumn: f + 5, top: headTop }}
                title={`Frame ${f + 1}, ${frame.duration}ms`}
              >
                {f + 1}
              </styled.FrameHead>
            );
          })}
          <styled.HeadFill style={{ gridRow: rows.length + 1, gridColumn: sprite.frames.length + 5, top: headTop }} />

          {/* Layer rows, topmost first */}
          {layerRows.map(k => {
            const l = order[k];
            const layer = sprite.layers[l];
            const current = l === sprite.layer;
            // Explicit rows: auto-placement would otherwise fill gaps in the tag rows
            const gridRow = rows.length + 2 + k;
            const layerSel = r?.type !== 'frames' && inRange(r, l, null);
            const drop = moving?.range.type === 'layers' && target
              ? target.l === l + 1 ? 'above' : target.l === l && l === 0 ? 'below' : ''
              : '';
            const shifted = moving?.range.type === 'cels' && target ? {
              ...moving.range,
              layers: [moving.range.layers[0] + target.l, moving.range.layers[1] + target.l] as [number, number],
              frames: [moving.range.frames[0] + target.f, moving.range.frames[1] + target.f] as [number, number],
            } : null;
            return (
              <div key={l} className="contents">
                <styled.Flag data-dim={!layer.visible} data-inherited={layer.visible && !sprite.visibleDeep(l)} data-current={current} style={{ left: 0, gridRow, gridColumn: 1 }} title={t('timeline.showHideAltClick')} onPointerDown={e => e.stopPropagation()} onClick={toggle(l, 'visible')}>
                  <Icon name={layer.visible ? 'eye' : 'eyeOff'} scale="glyph" />
                </styled.Flag>
                <styled.Flag data-dim={!layer.locked} data-current={current} style={{ left: cell, gridRow, gridColumn: 2 }} title={t('timeline.lockUnlock')} onPointerDown={e => e.stopPropagation()} onClick={toggle(l, 'locked')}>
                  <Icon name={layer.locked ? 'lock' : 'unlock'} scale="glyph" />
                </styled.Flag>
                {layer.group ? (
                  <styled.Flag data-current={current} style={{ left: cell * 2, gridRow, gridColumn: 3 }} title={t('timeline.foldUnfoldTheGroup')} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); sprite.toggleCollapsed(l); state.save(); }}>
                    <Icon name={layer.collapsed ? 'right' : 'down'} scale="glyph" />
                  </styled.Flag>
                ) : (
                  <styled.Flag data-dim={!layer.continuous} data-current={current} style={{ left: cell * 2, gridRow, gridColumn: 3 }} title={t('timeline.linkCelsInNew')} onPointerDown={e => e.stopPropagation()} onClick={toggle(l, 'continuous')}>
                    <Icon name="link" scale="glyph" />
                  </styled.Flag>
                )}
                <styled.LayerCell data-hit="layer" data-l={l} data-current={current} data-selected={layerSel} data-drop={drop} style={{ left: cell * 3, gridRow, gridColumn: 4 }}>
                  <LayerName index={l} />
                </styled.LayerCell>
                {frames.map(f => {
                  const c = layer.cels[f];
                  if (layer.group) return (
                    <styled.Cel key={f} data-hit="cel" data-l={l} data-f={f} data-group
                      data-current={current && f === sprite.frame} data-selected={inRange(r, l, f)} data-cross={current || f === sprite.frame}
                      style={{ gridRow, gridColumn: f + 5 }}>
                      {/* A folded group still shows which frames have something inside it */}
                      {layer.collapsed && groupHas(l, f) && <styled.Key data-folded />}
                    </styled.Cel>
                  );
                  return (
                    <styled.Cel
                      key={f}
                      data-hit="cel"
                      data-l={l}
                      data-f={f}
                      data-current={current && f === sprite.frame}
                      data-selected={inRange(r, l, f)}
                      data-cross={current || f === sprite.frame}
                      data-clip={!!clip && inRange(clip, l, f)}
                      data-drop={!!shifted && inRange(shifted, l, f)}
                      style={{ gridRow, gridColumn: f + 5 }}
                    >
                      {c ? (
                        <styled.Key
                          data-prev={f > 0 && layer.cels[f - 1] === c}
                          data-next={layer.cels[f + 1] === c}
                          data-linked={current && c === activeCel && f !== sprite.frame}
                          style={{ opacity: layer.celOpacity[f] < 1 ? 0.35 + layer.celOpacity[f] * 0.65 : 1 }} />
                      ) : <styled.Empty />}
                    </styled.Cel>
                  );
                })}
                <styled.RowFill data-current={current} style={{ gridRow, gridColumn: sprite.frames.length + 5 }} />
              </div>
            );
          })}
        </styled.Grid>
      </styled.Scroll>

      {popup?.kind === 'onion' && <OnionOptions x={popup.x} y={popup.y} close={() => setPopup(null)} />}
      {popup?.kind === 'play' && <PlayOptions x={popup.x} y={popup.y} close={() => setPopup(null)} />}
    </styled.Root>
  );
};
