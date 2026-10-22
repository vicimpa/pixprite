/**
 * Installed extensions: packages kept in IndexedDB (manifest + every file as a blob),
 * installed from a registry (registry.json + sha256 checks), from loose files, or live from a dev server.
 */
import { signal } from "@preact/signals-react";
import { languages } from "~/core/i18n";
import { parseManifest, type Manifest } from "./manifest";
import { idb, INSTALLED, STORAGE } from "./idb";

export type ExtensionSource = 'registry' | 'file' | 'dev';

export type InstalledExtension = {
  id: string;
  manifest: Manifest;
  /** Package path → content; empty for dev extensions, which are read from `url` */
  files: Record<string, Blob>;
  enabled: boolean;
  source: ExtensionSource;
  /** Folder the package came from (registry) or the dev server address */
  url?: string;
  installedAt: number;
};

/** One row of registry.json */
export type RegistryEntry = {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  permissions?: string[];
  /** Folder of the package, relative to registry.json */
  path: string;
  /** `sha256-<base64>` or hex of `files.json` (or of `manifest.json` when there is none) */
  integrity?: string;
  /** Package path → `sha256-<base64>` of every file; the package is these files, each checked */
  files?: Record<string, string>;
  /** Language packs: share of the core keys translated, 0..100 (per language code or overall) */
  completeness?: number | Record<string, number>;
};

export const DEFAULT_REGISTRY = './extensions/registry.json';
const REGISTRY_KEY = 'pixprite:extensionRegistry';

const loadRegistryUrl = () => { try { return localStorage.getItem(REGISTRY_KEY) || DEFAULT_REGISTRY; } catch { return DEFAULT_REGISTRY; } };

/** Where the store reads registry.json from */
export const registryUrl = signal(loadRegistryUrl());

export function setRegistryUrl(url: string) {
  registryUrl.value = url.trim() || DEFAULT_REGISTRY;
  try { localStorage.setItem(REGISTRY_KEY, registryUrl.value); } catch { }
}

/** Installed extensions, in install order */
export const installed = signal<InstalledExtension[]>([]);

export const installedById = (id: string) => installed.peek().find(e => e.id === id) ?? null;

/** Hooks of the runtime: start / stop an extension when it is installed, enabled or removed */
export const lifecycle = {
  start: async (_ext: InstalledExtension) => { },
  stop: async (_id: string) => { },
  /** A disabled extension still shows its own name and description in the interface language */
  texts: async (_ext: InstalledExtension) => { },
};

export async function loadInstalled() {
  try {
    const all = await idb<InstalledExtension[]>(INSTALLED, 'readonly', s => s.getAll());
    installed.value = all.sort((a, b) => a.installedAt - b.installedAt);
  } catch (e) {
    console.error('Failed to read installed extensions', e);
  }
  return installed.peek();
}

async function store(ext: InstalledExtension) {
  // Dev extensions are never stored: they live as long as the session
  if (ext.source !== 'dev') await idb(INSTALLED, 'readwrite', s => s.put(ext));
  const list = installed.peek().filter(e => e.id !== ext.id);
  installed.value = [...list, ext].sort((a, b) => a.installedAt - b.installedAt);
}

async function sha256(data: ArrayBuffer) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Accepts `sha256-<base64>`, `sha256-<hex>` or plain hex */
async function matches(data: ArrayBuffer, integrity: string) {
  const digest = await sha256(data);
  const want = integrity.replace(/^sha256-/, '');
  return want === base64(digest) || want.toLowerCase() === hex(digest);
}

async function get(url: string) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
}

/** Files a manifest points at (packages without files.json); locales for every known language */
function manifestFiles(m: Manifest) {
  const out = new Set<string>(['manifest.json']);
  const c = m.contributes ?? {};
  if (m.entry) out.add(m.entry);
  if (m.icon) out.add(m.icon);
  for (const t of c.tools ?? []) out.add(t.icon);
  for (const p of [...c.panels ?? [], ...c.widgets ?? []]) out.add(p.page);
  for (const l of c.languages ?? []) {
    out.add(l.dict);
    for (const f of Object.values(l.extensions ?? {})) out.add(f);
  }
  if (c.locales) {
    const dir = c.locales.replace(/\/?$/, '/');
    for (const code of new Set(['en', ...Object.keys(languages.peek()), ...(c.languages ?? []).map(l => l.code)])) out.add(`${dir}${code}.json`);
  }
  return [...out];
}

/** Reads a package folder; `integrity` is checked against files.json (whose hashes check each file) or manifest.json */
async function fetchPackage(base: string, integrity?: string, listed?: Record<string, string>) {
  const at = (p: string) => new URL(p, base).href;
  const files: Record<string, Blob> = {};
  const manifestBuf = await (await get(at('manifest.json'))).arrayBuffer();
  // A listed package is checked file by file, the manifest included: a list without its hash proves nothing
  if (listed && (!listed['manifest.json'] || !await matches(manifestBuf, listed['manifest.json']))) throw new Error(`Integrity check failed for ${base}manifest.json`);
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestBuf)));
  files['manifest.json'] = new Blob([manifestBuf], { type: 'application/json' });

  let list: Record<string, string> | null = listed ?? null;
  if (!list) try {
    const r = await fetch(at('files.json'), { cache: 'no-cache' });
    if (r.ok) {
      const buf = await r.arrayBuffer();
      if (integrity && !await matches(buf, integrity)) throw new Error('integrity');
      list = JSON.parse(new TextDecoder().decode(buf));
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'integrity') throw new Error(`Integrity check failed for ${manifest.id}`);
  }
  if (!list && integrity && !await matches(manifestBuf, integrity)) throw new Error(`Integrity check failed for ${manifest.id}`);
  for (const p of Object.keys(list ?? {})) if (!safePath(p)) throw new Error(`Bad file path "${p}"`);

  const paths = list ? Object.keys(list) : manifestFiles(manifest);
  await Promise.all(paths.filter(p => p !== 'manifest.json').map(async p => {
    if (!safePath(p)) throw new Error(`Bad file path "${p}"`);
    const r = await fetch(at(p), { cache: 'no-cache' });
    // Without a list the locale guesses may be missing; listed files must all be there
    if (!r.ok) { if (list) throw new Error(`HTTP ${r.status} for ${p}`); return; }
    const buf = await r.arrayBuffer();
    if (list && (!list[p] || !await matches(buf, list[p]))) throw new Error(`Integrity check failed for ${manifest.id}/${p}`);
    files[p] = new Blob([buf], { type: r.headers.get('content-type') ?? mimeOf(p) });
  }));
  return { manifest, files };
}

export const safePath = (p: string) => !!p && !p.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(p) && !/^[a-z]+:/i.test(p);

const MIME: Record<string, string> = {
  js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', html: 'text/html', css: 'text/css',
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', gif: 'image/gif', wasm: 'application/wasm',
};
export const mimeOf = (p: string) => MIME[p.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/** Rows of a registry.json (`[...]` or `{ extensions: [...] }`), each `path` made absolute */
export async function fetchRegistry(url = registryUrl.peek()): Promise<RegistryEntry[]> {
  const base = new URL(url, location.href).href;
  const json = await (await get(base)).json();
  const rows: RegistryEntry[] = Array.isArray(json) ? json : json?.extensions ?? [];
  return rows
    .filter(r => r && typeof r.id === 'string' && typeof r.path === 'string')
    .map(r => ({ ...r, path: new URL(r.path.replace(/\/?$/, '/'), base).href }));
}

/** Installs (or updates) an extension from a registry row; enabled right away */
export async function installFromRegistry(entry: RegistryEntry) {
  const { manifest, files } = await fetchPackage(entry.path, entry.integrity, entry.files);
  if (manifest.id !== entry.id) throw new Error(`Package id "${manifest.id}" doesn't match "${entry.id}"`);
  return install({ id: manifest.id, manifest, files, enabled: true, source: 'registry', url: entry.path, installedAt: installedById(manifest.id)?.installedAt ?? Date.now() });
}

/** Installs a package from loose files (a dropped folder / zip unpacked by the caller) keyed by package path */
export async function installFromFiles(files: Record<string, Blob>) {
  const raw = files['manifest.json'];
  if (!raw) throw new Error('manifest.json is missing');
  const manifest = parseManifest(JSON.parse(await raw.text()));
  for (const p of Object.keys(files)) if (!safePath(p)) throw new Error(`Bad file path "${p}"`);
  return install({ id: manifest.id, manifest, files, enabled: true, source: 'file', installedAt: installedById(manifest.id)?.installedAt ?? Date.now() });
}

/** Loads an extension straight from a dev server (`http://localhost:5174`); not stored, reload with reloadDev */
export async function loadDev(url: string) {
  const base = new URL(url.replace(/\/?$/, '/'), location.href).href;
  const r = await get(new URL('manifest.json', base).href);
  const manifest = parseManifest(await r.json());
  return install({ id: manifest.id, manifest, files: {}, enabled: true, source: 'dev', url: base, installedAt: installedById(manifest.id)?.installedAt ?? Date.now() });
}

export async function reloadDev(id: string) {
  const ext = installedById(id);
  if (!ext?.url || ext.source !== 'dev') throw new Error(`${id} is not a dev extension`);
  return loadDev(ext.url);
}

async function install(ext: InstalledExtension) {
  await lifecycle.stop(ext.id);
  await store(ext);
  if (ext.enabled) await lifecycle.start(ext);
  return ext;
}

export async function setEnabled(id: string, enabled: boolean) {
  const ext = installedById(id);
  if (!ext || ext.enabled === enabled) return;
  const next = { ...ext, enabled };
  await store(next);
  if (enabled) await lifecycle.start(next);
  else { await lifecycle.stop(id); await lifecycle.texts(next); }
}

export async function uninstall(id: string) {
  await lifecycle.stop(id);
  if (installedById(id)?.source !== 'dev') await idb(INSTALLED, 'readwrite', s => s.delete(id));
  // Its stored data goes too: a later package with the same id must not read it
  await idb(STORAGE, 'readwrite', s => s.delete(IDBKeyRange.bound(`${id}\n`, `${id}\n\uffff`)));
  installed.value = installed.peek().filter(e => e.id !== id);
}

/** Text of a package file (dev extensions: fetched from the dev server) */
export async function readFile(ext: InstalledExtension, path: string): Promise<Blob | null> {
  if (!safePath(path)) return null;
  if (ext.source === 'dev') {
    const r = await fetch(new URL(path, ext.url).href, { cache: 'no-cache' }).catch(() => null);
    return r?.ok ? new Blob([await r.arrayBuffer()], { type: r.headers.get('content-type') ?? mimeOf(path) }) : null;
  }
  return ext.files[path] ?? null;
}

export async function readJson<T>(ext: InstalledExtension, path: string): Promise<T | null> {
  const b = await readFile(ext, path);
  if (!b) return null;
  try { return JSON.parse(await b.text()); } catch { return null; }
}
