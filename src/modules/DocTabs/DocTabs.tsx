import type { Sprite } from "~/core/Sprite";
import { state } from "~/core/State";
import { dialogs } from "~/modules/Dialogs";
import { openContextMenu } from "~/ui/Menu";
import { t } from "~/core/i18n";
import { Icon } from "~/ui/Icon";
import { useSignals } from "@preact/signals-react/runtime";
import { useState, type FC } from "react";
import styled from "styled-components";

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
  const [drag, setDrag] = useState<{ doc: WeakRef<Sprite>; over: number; } | null>(null);

  return (
    <Bar
      onWheel={e => {
        // The wheel steps through tabs (no wrap)
        const i = (state.home ? -1 : state.docs.indexOf(state.sprite)) + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
        if (state.docs[i]) state.switchTo(state.docs[i]);
        else if (i < 0) state.showHome();
      }}
      onDoubleClick={e => { if (e.target === e.currentTarget) dialogs.newSprite(); }}
    >
      <Tab data-active={state.home} data-home title={t('tabs.home')} style={{ flex: '0 0 auto' }}
        onPointerDown={e => { if (e.button === 0) state.showHome(); }}>
        <Icon name="home" scale="glyph" />
      </Tab>
      {state.docs.map((doc, i) => {
        // React keeps the previous render in its alternate tree. Event props must not
        // keep an entire closed document alive through that tree or a context menu.
        const ref = new WeakRef(doc);
        const resolve = () => { const current = ref.deref(); return current && state.docs.includes(current) ? current : null; };
        return (
          <Tab
            key={i}
            data-active={!state.home && doc === state.sprite}
            data-drop={!!drag && drag.over === i && drag.doc.deref() !== doc}
            title={`${doc.name} · ${doc.width}×${doc.height}`}
            draggable
            onDragStart={() => setDrag({ doc: ref, over: i })}
            onDragOver={e => { e.preventDefault(); if (drag) setDrag({ ...drag, over: i }); }}
            onDragEnd={() => setDrag(null)}
            onDrop={() => { const source = drag?.doc.deref(); if (source && state.docs.includes(source)) state.moveDocument(source, i); setDrag(null); }}
            onPointerDown={e => {
              const current = resolve(); if (!current) return;
              if (e.button === 1) { e.preventDefault(); state.closeDocument(current); }
              else if (e.button === 0) state.switchTo(current);
            }}
            onContextMenu={e => {
              e.preventDefault();
              openContextMenu([
                { label: t('common.close'), run: () => { const current = resolve(); if (current) state.closeDocument(current); } },
                { label: t('tabs.closeOthers'), run: () => { const current = resolve(); if (current) for (const d of state.docs.slice()) if (d !== current) state.closeDocument(d); } },
                { label: t('common.duplicate'), run: () => { const current = resolve(); if (current) state.duplicateDocument(current); } },
              ], e.clientX, e.clientY);
            }}
          >
            <span>{doc.name}</span>
            <Close data-modified={doc.modified} title={t('tabs.closeMiddleClick')} onPointerDown={e => e.stopPropagation()} onClick={() => { const current = resolve(); if (current) state.closeDocument(current); }}><i>×</i></Close>
          </Tab>
        );
      })}
      <Fill onDoubleClick={() => dialogs.newSprite()} title={t('tabs.doubleClickForA')} />
    </Bar>
  );
};
