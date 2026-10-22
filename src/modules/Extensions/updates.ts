/**
 * Extension catalogs and updates. The catalogs (registry.json urls) are set in Preferences;
 * the store reads all of them at once and searches the merged list. Installed extensions are
 * checked against it at start and every few hours (while the tab is visible); newer versions are
 * listed in `updates` and announced once. Updating asks again only for new permissions.
 */

import { t } from "~/core/i18n";
import { DEFAULT_PREFS, LOCAL_CATALOG, PUBLIC_CATALOG, state } from "~/core/State";
import { signal } from "@preact/signals-react";
import { extensionsHost } from "./bridge";
import { confirmInstall } from "./Extensions";
import type { Registry, RegistryEntryLike } from "./types";

export const DEFAULT_REGISTRY = DEFAULT_PREFS.extensionCatalogs[0];

/** Catalog urls from Preferences, resolved against the page */
export function catalogUrls() {
  const list = state.prefs.extensionCatalogs ?? DEFAULT_PREFS.extensionCatalogs;
  const out: string[] = [];
  for (let u of list) {
    // The local folder exists only in development; a deployed editor reads the published catalog instead
    if (!import.meta.env.DEV && u.trim() === LOCAL_CATALOG) u = PUBLIC_CATALOG;
    try { out.push(new URL(u.trim(), document.baseURI).href); } catch { /* not a url: skipped */ }
  }
  return [...new Set(out)];
}

/** A store entry and the catalog it came from */
export type CatalogEntry = RegistryEntryLike & { registry: string; };

export type Catalog = { entries: CatalogEntry[]; errors: { url: string; error: string; }[]; };

/** Reads every catalog; an extension in several of them is listed once, at its newest version */
export async function loadCatalogs(): Promise<Catalog> {
  const errors: Catalog['errors'] = [];
  const lists = await Promise.all(catalogUrls().map(async url => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as Registry;
      return (Array.isArray(json) ? json : json.extensions ?? []).map(e => ({ ...e, registry: url }));
    } catch (e) {
      errors.push({ url, error: String((e as Error)?.message ?? e) });
      return [];
    }
  }));
  const byId = new Map<string, CatalogEntry>();
  for (const e of lists.flat()) {
    const have = byId.get(e.id);
    if (!have || newer(e.version, have.version)) byId.set(e.id, e);
  }
  return { entries: [...byId.values()].sort((a, b) => localized(a).name.localeCompare(localized(b).name)), errors };
}

export function localized(e: RegistryEntryLike) {
  const lang = state.prefs.language;
  const l = e.i18n?.[lang] ?? e.i18n?.[lang.split('-')[0]];
  return { name: l?.name ?? e.name, description: l?.description ?? e.description };
}

/** Case-insensitive match on name, id and description, in the interface language and English; every word must be found */
export function matches(e: RegistryEntryLike, query: string) {
  const l = localized(e);
  const text = `${l.name} ${l.description ?? ''} ${e.name} ${e.id} ${e.description ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => text.includes(w));
}

export type Update = { entry: CatalogEntry; from: string; };

/** Installed extensions with a newer version in a catalog, by id */
export const updates = signal<ReadonlyMap<string, Update>>(new Map());

/** 1.10.0 > 1.9.2; pre-release and build tails are ignored */
export function newer(a: string, b: string) {
  const pa = a.split(/[-+]/)[0].split('.').map(Number), pb = b.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Refreshes `updates` from the catalogs (already loaded ones may be passed in) */
export async function checkUpdates(announce = false, catalog?: Catalog) {
  const host = extensionsHost.peek();
  if (!host) return;
  const { entries } = catalog ?? await loadCatalogs();
  const next = new Map<string, Update>();
  for (const e of host.installed.peek()) {
    // Dev extensions follow their server instead
    if (e.devUrl) continue;
    const entry = entries.find(x => x.id === e.manifest.id);
    if (entry && newer(entry.version, e.manifest.version)) next.set(entry.id, { entry, from: e.manifest.version });
  }
  const fresh = [...next.keys()].filter(id => !updates.peek().has(id));
  updates.value = next;
  if (announce && fresh.length) {
    const names = fresh.map(id => { const u = next.get(id)!; return `${localized(u.entry).name} ${u.from} → ${u.entry.version}`; });
    state.showTip(t('extensions.updatesAvailable', { list: names.join(', ') }), 6000);
  }
}

/** Installs the newer version; asks first when it wants permissions the current one doesn't have */
export async function applyUpdate(id: string) {
  const host = extensionsHost.peek();
  const u = updates.peek().get(id);
  const cur = host?.installed.peek().find(e => e.manifest.id === id);
  if (!host || !u || !cur) return false;
  const had = new Set<string>(cur.manifest.permissions ?? []);
  const added = (u.entry.permissions ?? []).filter(p => !had.has(p));
  if (added.length && !await confirmInstall(localized(u.entry).name, added)) return false;
  await host.install(u.entry, u.entry.registry);
  const next = new Map(updates.peek());
  next.delete(id);
  updates.value = next;
  return true;
}

export async function applyAllUpdates() {
  for (const id of [...updates.peek().keys()]) await applyUpdate(id);
}

const EVERY = 6 * 60 * 60 * 1000;
let started = false;

/** Checks once the extensions have started, then every few hours while the tab is open and visible */
export function watchUpdates() {
  if (started) return;
  started = true;
  void checkUpdates(true);
  let last = Date.now();
  setInterval(() => {
    if (document.hidden || Date.now() - last < EVERY) return;
    last = Date.now();
    void checkUpdates(true);
  }, 60_000);
}
