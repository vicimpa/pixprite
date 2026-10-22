/**
 * The extension host as the extensions UI sees it (`ExtensionsHost` in modules/Extensions/bridge.ts).
 * Maps the UI's view (manifest-centric, per-extension status) onto the registry, runtime and contributions.
 */
import { computed } from "@preact/signals-react";
import { t } from "~/core/i18n";
import { lockedNotice as spriteLockedNotice } from "~/core/Sprite";
import { state } from "~/core/State";
import { setExtensionsHost, type ExtensionsHost, type ExtensionStatus, type InstalledExtension as UiInstalled } from "~/modules/Extensions/bridge";
import { hosts } from "./api/common";
import { framePage, problems, runExtensionCommand, toolOverlay, validateNow } from "./Contributions";
import * as registry from "./Registry";
import { hostFor, hostsVersion, installExtensions as installRuntime } from "./Runtime";

const STATUS: Record<string, ExtensionStatus> = { starting: 'loading', running: 'active', failed: 'failed', stopped: 'inactive' };

const byId = (id: string) => {
  const ext = registry.installedById(id);
  if (!ext) throw new Error(`${id} is not installed`);
  return ext;
};

const blobUrls = new Map<string, string>();

const installed = computed<UiInstalled[]>(() => {
  void hostsVersion.value;
  return registry.installed.value.map(e => {
    const h = hostFor(e.id);
    return {
      manifest: e.manifest,
      enabled: e.enabled,
      status: h ? STATUS[h.status.value] ?? 'inactive' : 'inactive',
      error: h?.error.value ?? undefined,
      devUrl: e.source === 'dev' ? e.url : undefined,
      registry: e.source === 'registry' ? e.url : undefined,
    };
  });
});

const host: ExtensionsHost = {
  installed,
  problems: computed(() => {
    const groups = new Map<string, { ext: string; validator: string; problems: typeof problems.value; }>();
    for (const p of problems.value) {
      const k = `${p.ext}\n${p.validator}`;
      if (!groups.has(k)) groups.set(k, { ext: p.ext, validator: p.validator, problems: [] });
      groups.get(k)!.problems.push(p);
    }
    return [...groups.values()];
  }),
  overlay: computed(() => toolOverlay.value?.pixels ?? null),
  lockedNotice: computed(() => {
    const n = spriteLockedNotice.value;
    return n ? t(`locks.${n.kind}.${n.op}`) : null;
  }),
  orphanLocks: computed(() => {
    const doc = state.home ? null : state.sprite;
    const l = doc?.orphanLocks;
    return l ? { document: doc!.sessionId ?? '', owner: l.owner } : null;
  }),

  async install(entry, registryUrl) {
    const rows = await registry.fetchRegistry(registryUrl);
    const row = rows.find(r => r.id === entry.id);
    if (!row) throw new Error(`${entry.id} is not in ${registryUrl}`);
    await registry.installFromRegistry(row);
  },
  uninstall: registry.uninstall,
  setEnabled: registry.setEnabled,
  async loadDev(url) { return (await registry.loadDev(url)).manifest; },
  async reload(id) {
    const ext = byId(id);
    if (ext.source === 'dev') await registry.reloadDev(id);
    else { await registry.setEnabled(id, false); await registry.setEnabled(id, true); }
  },
  async readText(id, path) {
    const ext = byId(id);
    // Pages come with their scripts compiled from source and styles inlined
    if (path.endsWith('.html')) return (await framePage(ext, path)).srcdoc;
    const blob = await registry.readFile(ext, path);
    if (!blob) throw new Error(`${path} is missing from ${id}`);
    return blob.text();
  },
  async fileUrl(id, path) {
    const ext = byId(id);
    if (ext.source === 'dev') return new URL(path, ext.url).href;
    const key = `${id}/${path}/${ext.installedAt}`;
    if (!blobUrls.has(key)) {
      const blob = await registry.readFile(ext, path);
      if (!blob) throw new Error(`${path} is missing from ${id}`);
      blobUrls.set(key, URL.createObjectURL(blob));
    }
    return blobUrls.get(key)!;
  },
  label(id, text) {
    if (!text) return '';
    return hosts.get(id)?.label(text) ?? text.replace(/%([\w.-]+)%/g, (_, k: string) => t(`ext.${id}.${k}`));
  },
  instance(id) {
    void hostsVersion.value;
    return hosts.get(id) ?? null;
  },
  connectFrame(id, role, contribution, iframe) {
    const h = hosts.get(id);
    if (!h) return () => { };
    return h.connectFrame(iframe, role, contribution);
  },
  runCommand(id) {
    const at = id.indexOf(':');
    if (at > 0) void runExtensionCommand(id.slice(0, at), id.slice(at + 1));
  },
  runValidators: validateNow,
  unlockOrphan() {
    const doc = state.home ? null : state.sprite;
    const l = doc?.orphanLocks;
    if (doc && l) doc.clearLocks(l.owner);
  },
};

/** App start: loads installed extensions, then hands the UI its host */
export async function installExtensions() {
  await installRuntime();
  setExtensionsHost(host);
}
