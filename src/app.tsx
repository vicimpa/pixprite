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
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <DocTabs />
    <MainMenu />
    <DesktopUpdate />
    {state.home ? <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}><Home /></div> : <EditorWorkspace />}
    <DropZone /><ExtPanels dock="float" /><ExtensionNotices />
    <DialogHost /><ContextMenuHost /><CommandPalette /><ProgressOverlay />
  </div>;
};
