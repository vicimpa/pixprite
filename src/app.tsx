import { activeViewer } from './core/ViewerTabs';
import { ViewerWorkspace } from './modules/Editor/ViewerWorkspace';
import { state } from "~/core/State";
import { MainMenu } from "~/modules/MainMenu";
import { CommandPalette } from "~/modules/CommandPalette";
import { DocTabs } from "~/modules/DocTabs";
import { DropZone } from "~/modules/DropZone";
import { ProgressOverlay } from "~/modules/Progress";
import { ContextMenuHost } from "~/ui/Menu";
import { DialogHost } from "~/ui/Dialog";
import { Home } from "~/modules/Home";
import { EditorWorkspace } from "~/modules/Editor/EditorWorkspace";
import { ExtPanels, ExtensionNotices } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { DesktopUpdate } from "~/modules/DesktopUpdate";

export const App = () => {
  useSignals();
  const panelVisibility = { display: state.home && !activeViewer.value ? 'none' : 'contents' };
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <DocTabs />
    <MainMenu />
    <DesktopUpdate />
    <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
      <div data-extension-dock="left" style={panelVisibility}><ExtPanels dock="left" /></div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0, minWidth: 0 }}>
        {activeViewer.value ? <ViewerWorkspace /> : state.home ? <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}><Home /></div> : <EditorWorkspace />}
        <div data-extension-dock="bottom" style={panelVisibility}><ExtPanels dock="bottom" /></div>
      </div>
      <div data-extension-dock="right" style={panelVisibility}><ExtPanels dock="right" /></div>
    </div>
    <DropZone /><div data-extension-dock="float" style={panelVisibility}><ExtPanels dock="float" /></div><ExtensionNotices />
    <DialogHost /><ContextMenuHost /><CommandPalette /><ProgressOverlay />
  </div>;
};
