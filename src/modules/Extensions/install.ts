import { watchUpdates } from "./updates";

/**
 * Starts the extension host at app start. The host is loaded lazily and a failure is only logged,
 * so the editor still runs (the store then says extensions are unavailable).
 */

let started: Promise<void> | null = null;

/** Resolves once installed extensions (themes, language packs…) are registered; never rejects */
export function startExtensions(): Promise<void> {
  return started ??= Promise.all([import("~/core/extensions/UiHost"), import("~/core/extensions")])
    .then(([m, ext]) => {
      // `ctx.ui.showForm` opens the app's own dialog
      ext.uiBridge.showForm = (title, schema) => import("~/ui/Form").then(form => form.askForm(title, schema));
      return m.installExtensions();
    })
    // Not awaited: the editor shouldn't wait for the network
    .then(() => { watchUpdates(); })
    .catch(err => console.error('Extensions failed to start', err));
}
