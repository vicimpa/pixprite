import { state } from "~/core/State";
import { Colors } from "~/modules/Colors";
import { View } from "~/modules/Editor/modules/View";
import { Timeline } from "~/modules/Editor/modules/Timeline";
import { StatusBar } from "~/modules/StatusBar";
import { Toolbar } from "~/modules/Toolbar";
import { ToolOptions } from "~/modules/ToolOptions";
import { FullscreenPreview, PreviewWindow } from "~/modules/Preview";
import { TextEntry } from "~/modules/TextEntry";
import { CanvasHint } from "~/modules/Editor/modules/CanvasHint";
import { Splitter } from "~/ui/Splitter";
import { ExtPanels } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { type FC, type ReactNode } from "react";
import styled from "styled-components";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
`;

const Row = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
`;

/** Fixed-size slot whose content is absolutely positioned inside */
const Slot = styled.div<{ $w?: number; $h?: number; }>`
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  ${p => p.$w !== undefined ? `width: ${p.$w}px;` : ''}
  ${p => p.$h !== undefined ? `height: ${p.$h}px;` : ''}
`;

const Grow = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const Side = styled.div`
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--bg);
`;

export const EditorWorkspace: FC = () => {
  useSignals();
  const { layout, ui } = state;
  const set = state.setLayout.bind(state);

  const colors = layout.showColors && (
    <Side data-panel="colors" style={{ width: layout.colorsSize }}
      aria-hidden={layout.colorsSize === 0} inert={layout.colorsSize === 0}><Colors /></Side>
  );
  const colorsSplit = (dir: 1 | -1) => layout.showColors && (
    <Splitter vertical value={layout.colorsSize} dir={dir} min={0} max={480} onChange={v => set({ colorsSize: v })} />
  );
  const toolbar = layout.showToolbar && (
    <Side style={{ width: ui.tool * 11 + 16 }}><Toolbar /></Side>
  );
  const timeline = layout.showTimeline && (
    <Slot data-panel="timeline" style={{ height: layout.timelineSize }}
      aria-hidden={layout.timelineSize === 0} inert={layout.timelineSize === 0}><Timeline /></Slot>
  );
  const timelineSplit = (dir: 1 | -1) => layout.showTimeline && (
    <Splitter vertical={false} value={layout.timelineSize} dir={dir} min={0} max={600} onChange={v => set({ timelineSize: v })} />
  );

  let workspace: ReactNode = (
    <Column style={{ flex: '1 1 0' }}>
      {layout.timeline === 'top' && <>{timeline}{timelineSplit(1)}</>}
      <Grow><View /><TextEntry /><CanvasHint /><PreviewWindow /></Grow>
      <ExtPanels dock="bottom" />
      {layout.timeline === 'bottom' && <>{timelineSplit(-1)}{timeline}</>}
    </Column>
  );

  return <>
    {layout.showOptions && <Slot $h={ui.bar}><ToolOptions /></Slot>}
    <Row style={{ flex: '1 1 0' }}>
      {layout.colors === 'left' && <>{colors}{colorsSplit(1)}</>}
      {layout.toolbar === 'left' && toolbar}
      <ExtPanels dock="left" />{workspace}<ExtPanels dock="right" />
      {layout.toolbar === 'right' && toolbar}
      {layout.colors === 'right' && <>{colorsSplit(-1)}{colors}</>}
    </Row>
    {layout.showStatus && <Slot $h={ui.row}><StatusBar /></Slot>}
    <FullscreenPreview />
  </>;
};
