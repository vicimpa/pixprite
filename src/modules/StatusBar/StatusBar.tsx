import { keyNames, t } from "~/core/i18n";
import { runCommand } from "~/core/Commands";
import { unpackRgba } from "~/core/Image";
import { state } from "~/core/State";
import { Button, Muted, Separator } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { AdaptiveBar, AdaptiveItem } from "~/ui/AdaptiveBar/AdaptiveBar";
import { ExtWidgets } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";

const Bar = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  background-color: var(--face);
  border-top: 1px solid var(--b1);
  box-shadow: inset 0 1px 0 var(--hilite);
  white-space: nowrap;
  overflow: hidden;
`;

const Swatch = styled.span`
  width: calc(var(--font-size) + 2px);
  height: calc(var(--font-size) + 2px);
  border: 1px solid var(--b1);
  flex-shrink: 0;
  background-image: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%);
  background-size: 6px 6px;
  position: relative;

  & > span { position: absolute; inset: 0; }
`;

const Field = styled.input`
  font: inherit;
  color: var(--fg);
  background: var(--field);
  border: 1px solid var(--b1);
  height: calc(var(--row) - 4px);
  width: 3.2em;
  text-align: center;
  user-select: text;

  &:focus { border-color: var(--accent); outline: none; }
`;

const Tip = styled.div`
  position: fixed;
  right: 12px;
  bottom: calc(var(--row) + 8px);
  z-index: 800;
  padding: 4px 10px;
  color: var(--tooltip-fg);
  background: var(--tooltip);
  border: 1px solid var(--b1);
  box-shadow: 2px 2px 0 var(--shadow);
  pointer-events: none;
  max-width: calc(100vw - 24px);
  white-space: normal;
  overflow-wrap: anywhere;
`;

const Snap = styled.button`
  font: inherit;
  padding: 0 6px;
  color: var(--accent-fg);
  background: var(--accent);
  border: 1px solid var(--b1);
  cursor: pointer;
`;

/** Number field that commits on Enter / blur and selects itself on focus */
const NumberEntry: FC<{ value: number; onCommit: (n: number) => void; suffix?: string; title?: string; }> = ({ value, onCommit, suffix, title }) => {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = parseFloat(text);
    if (Number.isFinite(n)) onCommit(n);
  };
  return (
    <>
      <Field
        value={text}
        title={title}
        onFocus={e => { setEditing(true); e.currentTarget.select(); }}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setText(String(value)); setEditing(false); e.currentTarget.blur(); }
        }} />
      {suffix}
    </>
  );
};

export const StatusBar: FC = () => {
  useSignals();
  const { sprite, cursorX: x, cursorY: y, prefs } = state;
  const inside = sprite.inBounds(x, y);
  const [r, g, b, a] = unpackRgba(inside ? sprite.pick(x, y) : 0);
  const sel = sprite.mask?.bounds;
  const frame = sprite.frames[sprite.frame];
  const cell = state.showGrid && inside
    ? `cell ${Math.floor((x - prefs.gridX) / prefs.gridW)}, ${Math.floor((y - prefs.gridY) / prefs.gridH)}`
    : '';

  return (
    <Bar>
      <AdaptiveBar label={t('status.moreControls')}>
        <AdaptiveItem priority={-5}>
        <span style={{ minWidth: '5.5em' }}>{x > -50 ? `${x}, ${y}` : '–'}</span>
        {inside && <>
          <Swatch title={`rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`}><span style={{ background: `rgba(${r},${g},${b},${a / 255})` }} /></Swatch>
          <Muted>{a ? `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}${a < 255 ? ` ${Math.round(a / 2.55)}%` : ''}` : 'empty'}</Muted>
        </>}
        {cell && <Muted>{cell}</Muted>}
        {inside && a > 0 && sprite.colorMode === 'indexed' && sprite.palette && <Muted>index {sprite.palette.index(sprite.pick(x, y))}</Muted>}
        </AdaptiveItem>
        <AdaptiveItem priority={5}><Muted>{sel ? `Selection ${sel.w}×${sel.h} at ${sel.x}, ${sel.y}` : `${sprite.width}×${sprite.height}`}{sprite.colorMode !== 'rgb' ? ` · ${sprite.colorMode}` : ''}</Muted></AdaptiveItem>
        {state.snapToGrid && <Snap title={`${t('status.snapToGridOn')} · ${t('status.clickToTurnSnapping')}`} aria-label={t('status.snapToGridOn')} onClick={() => { state.snapToGrid = false; }}><Icon name="grid" scale="glyph" /></Snap>}
        <AdaptiveItem priority={state.notice ? 20 : -20}><span title={state.notice || keyNames(state.hint)} style={{ maxWidth: '28em', overflow: 'hidden', textOverflow: 'ellipsis', color: state.notice ? undefined : 'var(--fg-dim)' }}>{state.notice || keyNames(state.hint)}</span></AdaptiveItem>
        <ExtWidgets slot="statusbar" />
        <Separator />
        <AdaptiveItem priority={-10}><Muted title={sprite.current?.name} style={{ maxWidth: '8em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sprite.current?.name}</Muted></AdaptiveItem>
        <Separator />
        <AdaptiveItem priority={50}>
        <Button $square title={t('status.firstFrameHome')} onClick={() => runCommand('anim.first')}><Icon name="first" scale="glyph" /></Button>
        <Button $square title={t('status.previousFrameLeft')} onClick={() => runCommand('anim.prev')}><Icon name="prev" scale="glyph" /></Button>
        <Button $square $active={state.playing} title={t('status.playEnter')} onClick={() => runCommand('anim.play')}>
          <Icon name={state.playing ? 'pause' : 'play'} scale="glyph" />
        </Button>
        <Button $square title={t('status.nextFrameRight')} onClick={() => runCommand('anim.next')}><Icon name="next" scale="glyph" /></Button>
        <Button $square title={t('status.lastFrameEnd')} onClick={() => runCommand('anim.last')}><Icon name="last" scale="glyph" /></Button>
        <span>
          <NumberEntry
            value={sprite.frame + 1}
            title={t('common.goToFrame')}
            onCommit={n => { sprite.dropFloating(); sprite.frame = Math.max(0, Math.min(sprite.frames.length - 1, Math.round(n) - 1)); }}
            suffix={` / ${sprite.frames.length}`} />
        </span>
        {sprite.frames.length > 1 && <Muted>{frame?.duration}ms</Muted>}
        <Separator />
        </AdaptiveItem>
        <AdaptiveItem priority={100}>
        <Button $square title={t('status.zoomOut')} onClick={() => runCommand('view.zoomOut')}><Icon name="minus" scale="glyph" /></Button>
        <span>
          <NumberEntry value={Math.round(state.zoomTarget * 100)} title={t('status.zoom')} onCommit={n => state.zoomTo(Math.max(25, n) / 100)} suffix="%" />
        </span>
        <Button $square title={t('status.zoomIn')} onClick={() => runCommand('view.zoomIn')}><Icon name="plus" scale="glyph" /></Button>
        </AdaptiveItem>
      </AdaptiveBar>
      {state.tip && <Tip>{state.tip}</Tip>}
    </Bar>
  );
};
