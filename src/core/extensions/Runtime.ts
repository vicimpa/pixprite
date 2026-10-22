/**
 * Starts and stops installed extensions. At app start every enabled extension's data parts
 * (themes, languages, menus…) are loaded before the first render; workers start in the background.
 */
import { signal } from "@preact/signals-react";
import { lockOwners } from "~/core/Sprite";
import { state } from "~/core/State";
import { hosts } from "./api/common";
import { installDevLink } from "./DevLink";
import { dropTexts, installValidation, loadContributions, loadLocales } from "./Contributions";
import { ExtensionHost } from "./Host";
import { installed, lifecycle, loadInstalled, type InstalledExtension } from "./Registry";

/** Bumped when an extension starts or stops */
export const hostsVersion = signal(0);

/** The running host of an extension (status, error, exports), if any */
export const hostFor = (id: string) => (void hostsVersion.value, hosts.get(id) ?? null);

function refreshLocks() {
  for (const doc of state.docs) doc.refreshLockOwner();
}

/** Loads the extension's contributions; `worker: false` leaves starting its code to the caller */
async function launch(ext: InstalledExtension, worker = true) {
  await stopExtension(ext.id);
  const host = new ExtensionHost(ext);
  hosts.set(ext.id, host);
  hostsVersion.value++;
  try {
    await loadContributions(host);
  } catch (e) {
    console.error(`[ext ${ext.id}] contributions failed to load`, e);
    host.error.value = e instanceof Error ? e.message : String(e);
  }
  refreshLocks();
  const started = host.start().then(() => { hostsVersion.value++; });
  if (worker) await started;
  return host;
}

export async function startExtension(ext: InstalledExtension) {
  await launch(ext);
}

export async function stopExtension(id: string) {
  const host = hosts.get(id);
  // A disabled extension has only its texts loaded
  dropTexts(id);
  if (!host) return;
  hosts.delete(id);
  host.dispose();
  hostsVersion.value++;
  refreshLocks();
}

let installedOnce = false;

/** Call once at app start, before the first render (and before the interface language is checked) */
export async function installExtensions() {
  if (installedOnce) return;
  installedOnce = true;
  lifecycle.start = startExtension;
  lifecycle.stop = stopExtension;
  lifecycle.texts = ext => loadLocales(ext).catch(e => console.error(`[ext ${ext.id}] texts failed to load`, e));
  // Locks owned by extensions that aren't installed can be unlocked by the user
  lockOwners.installed = id => installed.peek().some(e => e.id === id);
  installValidation();
  installDevLink();
  const list = await loadInstalled();
  await Promise.all(list.map(e => e.enabled ? launch(e, false) : lifecycle.texts(e)));
}
