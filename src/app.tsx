import { state } from "~/core/State";
import { MainMenu } from "~/modules/MainMenu";
import { CommandPalette } from "~/modules/CommandPalette";
import { DocTabs } from "~/modules/DocTabs";
import { DropZone } from "~/modules/DropZone";
import { ProgressOverlay } from "~/modules/Progress";
import { ContextMenuHost } from "~/ui/Menu";
import { DialogHost } from "~/ui/Dialog";
import { LazyFeature } from "~/ui/LazyFeature";
import { ExtPanels, ExtensionNotices } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";

const home = () => import("~/modules/Home").then(m => ({ default: m.Home }));
const editor = () => import("~/modules/Editor/EditorWorkspace").then(m => ({ default: m.EditorWorkspace }));

export const App = () => {
  useSignals();
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <DocTabs />
    <div style={{ position: 'relative', height: state.ui.row + 2, flexShrink: 0 }}><MainMenu /></div>
    {state.home ? <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}><LazyFeature key="home" load={home} /></div> : <LazyFeature key="editor" load={editor} />}
    <DropZone /><ExtPanels dock="float" /><ExtensionNotices />
    <DialogHost /><ContextMenuHost /><CommandPalette /><ProgressOverlay />
  </div>;
};
