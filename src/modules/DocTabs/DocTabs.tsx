import type { Sprite } from "~/core/Sprite";
import { state } from "~/core/State";
import { dialogs } from "~/modules/Dialogs";
import { openContextMenu } from "~/ui/Menu";
import { t } from "~/core/i18n";
import { Icon } from "~/ui/Icon";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";
import { WindowControls } from "./WindowControls";

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  gap: 1px;
  height: calc(var(--row) + 4px);
  padding: 2px 4px 0;
  background: var(--bg);
  border-bottom: 1px solid var(--b1);
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  &[data-desktop=true] { padding-right: 112px; -webkit-app-region: drag; }
  &[data-desktop=true][data-platform=darwin] { padding-left: 78px; padding-right: 4px; }
  &[data-desktop=true] > * { -webkit-app-region: no-drag; }
  &[data-desktop=true] > [data-window-drag] { -webkit-app-region: drag; min-width: 48px; }
  &[data-local-drag=true], &[data-local-drag=true] > [data-window-drag] { -webkit-app-region: no-drag; }
`;

const Tab = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  /* Tabs shrink evenly when there are many */
  flex: 0 1 180px;
  min-width: 24px;
  padding: 0 4px 0 8px;
  color: var(--fg-dim);
  background: var(--face);
  border: 1px solid var(--b1);
  border-bottom: none;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;

  &[data-active=true] { color: var(--fg); background: var(--face-hot); box-shadow: inset 0 2px 0 var(--accent); }
  &[data-drop=true] { box-shadow: inset 3px 0 0 var(--accent); }
  &[data-home] { justify-content: center; padding: 0 6px; }
  & > span { overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
`;

/** Close box; shows a dot while the document has unsaved changes */
const Close = styled.button`
  width: 16px;
  height: 16px;
  padding: 0;
  font: inherit;
  line-height: 14px;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;

  &:hover { color: var(--fg); background: var(--b2); }
  &[data-modified=true]:not(:hover)::before { content: '●'; font-size: 9px; }
  &[data-modified=true]:not(:hover) > i { display: none; }
`;

const Fill = styled.div`
  flex: 1 1 0;
`;

export const DocTabs: FC = () => {
  useSignals();
  const desktop = window.pixpriteDesktop;
  const [drag, setDrag] = useState<{ doc: WeakRef<Sprite>; over: number; } | null>(null);
  const title = state.home ? 'Pixprite' : `${state.sprite.name} — Pixprite`;
  useEffect(() => { if (desktop) document.title = title; }, [desktop, title]);
  const drop = (e: React.DragEvent, index: number) => {
    e.preventDefault(); e.stopPropagation();
    const source = drag?.doc.deref();
    if (source && state.docs.includes(source)) state.moveDocument(source, index);
    setDrag(null);
  };
  return <>
    <Bar data-testid="document-tabs" data-desktop={!!desktop} data-platform={desktop?.platform} data-local-drag={!!drag}
      onDragOver={e => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={e => drop(e, state.docs.length)}
      onWheel={e => {
        const i = (state.home ? -1 : state.docs.indexOf(state.sprite)) + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
        if (state.docs[i]) state.switchTo(state.docs[i]); else if (i < 0) state.showHome();
      }}
      onDoubleClick={e => { if (!desktop && e.target === e.currentTarget) dialogs.newSprite(); }}>
      <Tab data-active={state.home} data-home title={t('tabs.home')} style={{ flex: '0 0 auto' }}
        onPointerDown={e => { if (e.button === 0) state.showHome(); }}><Icon name="home" scale="glyph" /></Tab>
      {state.docs.map((doc, i) => {
        const sid = doc.sessionId ??= crypto.randomUUID();
        const ref = new WeakRef(doc);
        const resolve = () => { const current = ref.deref(); return current && state.docs.includes(current) ? current : null; };
        return <Tab key={sid} data-session={sid}
          data-active={!state.home && doc === state.sprite}
          data-drop={!!drag && drag.over === i && drag.doc.deref() !== doc}
          title={`${doc.name} · ${doc.width}×${doc.height}`} draggable
          onDragStart={e => {
            setDrag({ doc: ref, over: i });
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-pixprite-tab', sid);
          }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (drag) setDrag({ ...drag, over: i }); }}
          onDragEnd={() => setDrag(null)}
          onDrop={e => drop(e, i)}
          onPointerDown={e => {
            const current = resolve(); if (!current) return;
            if (e.button === 1) { e.preventDefault(); void state.closeDocument(current); }
            else if (e.button === 0) state.switchTo(current);
          }}
          onContextMenu={e => {
            e.preventDefault();
            const { clientX, clientY } = e;
            openContextMenu([
              { label: t('common.close'), run: () => { const current = resolve(); if (current) void state.closeDocument(current); } },
              { label: t('tabs.closeOthers'), run: () => { const current = resolve(); if (current) for (const d of state.docs.slice()) if (d !== current) void state.closeDocument(d); } },
              { label: t('common.duplicate'), run: () => { const current = resolve(); if (current) state.duplicateDocument(current); } },
            ], clientX, clientY);
          }}>
          <span>{doc.name}</span>
          <Close data-modified={doc.modified} title={t('tabs.closeMiddleClick')} onPointerDown={e => e.stopPropagation()}
            onClick={() => { const current = resolve(); if (current) void state.closeDocument(current); }}><i>×</i></Close>
        </Tab>;
      })}
      {desktop && <Close style={{ alignSelf: 'center', width: 26 }} title={t('common.newSprite')} onClick={() => dialogs.newSprite()}>+</Close>}
      <Fill data-window-drag data-tauri-drag-region onDoubleClick={() => { if (!desktop) dialogs.newSprite(); }} title={desktop ? undefined : t('tabs.doubleClickForA')} />
      {desktop && <WindowControls bridge={desktop} />}
    </Bar>
  </>;
};
