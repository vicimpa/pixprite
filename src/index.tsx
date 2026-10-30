import "~/index.css";

import { App } from "~/app";
import { installHotkeys } from "~/core/Hotkeys";
import { installPlayback } from "~/core/Playback";
import { state } from "~/core/State";
import { themeReady } from "~/core/Themes";
import { startSession } from "~/core/Projects";
import { installNumberFields } from "~/ui/numberFields";
import { installTooltips } from "~/ui/tooltips";
import { askChoice, askConfirm } from "~/ui/Dialog";
import { installI18n, t } from "~/core/i18n";
import { installPwa, isDesktop } from "~/core/Pwa";
import { MobileStub } from "~/modules/MobileStub";
import { startExtensions } from "~/modules/Extensions";
import * as tools from "~/core/Tools";
import * as commands from "~/core/Commands";
import { Color } from "~/core/Color";
import { createRoot } from "react-dom/client";

// Language packs from extensions must be registered before the saved language is checked
const textsReady = startExtensions().then(() => installI18n());

addEventListener('contextmenu', e => e.preventDefault());
addEventListener('dblclick', e => e.preventDefault());
// Leaving or hiding the page writes pending changes right away
addEventListener('beforeunload', () => void state.persist());
addEventListener('visibilitychange', () => { if (document.hidden) void state.persist(); });

// Closing a tab with unsaved changes asks first
state.confirmClose = async doc => {
  const i = await askChoice(t('app.saveChangesToName', { name: doc.name }), [t('common.save'), t('app.dontSave'), t('common.cancel')], { title: t('app.unsavedChanges') });
  return i === 0 ? 'save' : i === 1 ? 'discard' : 'cancel';
};

// Noticed before anything is written: the last visit may have ended in a crash
state.uncleanExit = startSession();
const restored = state.restore();
void restored.then(async () => {
  await textsReady;
  // After a crash, offer the snapshot list (on the home page)
  if (state.uncleanExit && !state.home && await askConfirm(t('app.theLastSessionDid'), { title: t('app.recovery'), ok: t('app.showSnapshots') }))
    state.showHome();
});
installHotkeys();
installNumberFields();
installTooltips();
installPlayback();
// Files opened with the installed app wait for the restored session, then open as tabs
installPwa(Promise.all([restored, textsReady]));

// Devtools convenience uses the already loaded command/kernel modules.
if (import.meta.env.DEV) Object.assign(window, { pixprite: { state, tools, commands, Color } });

// The first paint waits for the interface texts and the theme, so nothing flashes
// Phones and tablets get a notice first; going on anyway is remembered on that device
const MOBILE_OK = 'pixprite.mobileOk';
const mobileOk = () => { try { return localStorage.getItem(MOBILE_OK) === '1'; } catch { return false; } };

void Promise.all([textsReady, themeReady()]).then(() => {
  const root = createRoot(document.getElementById('root')!);
  if (isDesktop() || mobileOk()) return root.render(<App />);
  root.render(<MobileStub onContinue={() => {
    try { localStorage.setItem(MOBILE_OK, '1'); } catch { /* private mode: ask again next time */ }
    root.render(<App />);
  }} />);
});
