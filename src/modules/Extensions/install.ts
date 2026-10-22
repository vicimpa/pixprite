/**
 * Starts the extension host at app start. The host is loaded lazily and a failure is only logged,
 * so the editor still runs (the store then says extensions are unavailable).
 */

let started: Promise<void> | null = null;

/** Resolves once installed extensions (themes, language packs…) are registered; never rejects */
export function startExtensions(): Promise<void> {
  return started ??= import("~/core/extensions/UiHost")
    .then(m => m.installExtensions())
    // Not awaited: the editor shouldn't wait for the network
    .then(() => { void import("./updates").then(u => u.watchUpdates()); })
    .catch(err => console.error('Extensions failed to start', err));
}
