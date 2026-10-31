/**
 * Extensions as source folders (`extensions/<id>/`): checks and the catalog. Nothing is built here:
 * the editor compiles an extension's TypeScript itself when it installs or runs it. The catalog
 * (registry.json) lists each extension with its texts and every file with its sha256, so the editor
 * knows what to download and can check it. Used by the CLI (build-extensions.ts) and by Vite.
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import type { Manifest } from "@pixprite/api";
import { referencedKeys, resolveString, validateManifest } from "../src/core/extensions/manifest";
import { MAX_ICON_PACK_BYTES, parseIconPack } from '../src/core/extensions/iconPack';

export const ROOT = join(import.meta.dirname ?? __dirname, '..');
export const SRC = join(ROOT, 'extensions');
const CORE_EN: Record<string, string> = JSON.parse(readFileSync(join(ROOT, 'src/locales/en.json'), 'utf8'));

export type RegistryEntry = {
  id: string; name: string; version: string; description?: string; icon?: string; author?: string;
  permissions: string[]; path: string;
  /** Package path → `sha256-<base64>` of every file the editor downloads */
  files: Record<string, string>;
  /** Language packs: share of core keys translated, 0..100, per language code */
  completeness?: Record<string, number>;
  /** Name and description in other languages (the top-level ones are English) */
  i18n?: Record<string, { name: string; description?: string; }>;
};

/** Files that are the author's tooling, not part of the extension */
const IGNORED = /(^|\/)(\.[^/]*|node_modules|tsconfig\.json|package\.json|bun\.lockb?|README\.md)(\/|$)/;

export const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('base64');
export const listFiles = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? listFiles(p) : [p];
});

/** Package paths of an extension's files, `/`-separated */
export const packageFiles = (dir: string) =>
  listFiles(dir).map(f => relative(dir, f).split(sep).join('/')).filter(p => !IGNORED.test(p)).sort();

/** Ids of the extension folders (those with a manifest) */
export const extensionIds = (root = SRC) =>
  readdirSync(root).filter(f => existsSync(join(root, f, 'manifest.json'))).sort();

/** The source of a built name the manifest uses: `main.js` → `src/main.ts`, `panel.html` → `src/panel.ts` */
export const sourceOf = (dir: string, file: string) => {
  if (/\.(ts|tsx|js|mjs)$/.test(file) && !file.endsWith('.js') && existsSync(join(dir, file))) return join(dir, file);
  const base = file.replace(/\.(js|html)$/, '');
  return [join(dir, 'src', base), join(dir, base)].flatMap(b => ['.ts', '.tsx', '.js'].map(e => b + e)).find(existsSync);
};

/** Plural forms (`key.few`) differ per language; only `key.other` must exist in English */
const pluralForm = (k: string, en: Record<string, string>) =>
  /\.(zero|one|two|few|many)$/.test(k) && k.replace(/\.\w+$/, '.other') in en;

/** Checks one extension; returns problems (empty = fine) */
export function check(dir: string, m: Manifest): string[] {
  const problems = validateManifest(m).map(p => `manifest ${p}`);
  if (problems.length) return problems;
  if (m.id !== dir.split(sep).pop()) problems.push(`folder name must equal id "${m.id}"`);

  const c = m.contributes ?? {};
  if (m.entry && !sourceOf(dir, m.entry)) problems.push(`entry ${m.entry}: no src/${m.entry.replace(/\.js$/, '.ts')}`);
  for (const p of [...c.panels ?? [], ...c.widgets ?? []]) if (!sourceOf(dir, p.page) && !existsSync(join(dir, 'src', p.page)) && !existsSync(join(dir, p.page)))
    problems.push(`page ${p.page}: no src/${p.page} or src/${p.page.replace(/\.html$/, '.ts')}`);
  for (const f of [m.icon, ...(c.tools ?? []).map(t => t.icon), ...(c.iconPacks ?? []).map(p => p.icons), ...(c.languages ?? []).flatMap(l => [l.dict, ...Object.values(l.extensions ?? {})])])
    if (f && !existsSync(join(dir, f))) problems.push(`missing file ${f}`);
  for (const pack of c.iconPacks ?? []) {
    try {
      const file = join(dir, pack.icons);
      if (statSync(file).size > MAX_ICON_PACK_BYTES) throw new Error('icon pack exceeds 256 KiB');
      parseIconPack(readJson(file));
    } catch (e) { problems.push(`${pack.icons}: ${e instanceof Error ? e.message : e}`); }
  }

  // Own strings: every locale has the keys of en.json, and every %key% in the manifest exists
  const locales = readLocales(dir, m);
  const en = locales.en;
  const refs = referencedKeys(m);
  if (refs.size && !en) problems.push(`manifest uses %keys% but there is no ${c.locales ?? 'locales/'}en.json`);
  if (en) {
    for (const k of refs) if (!(k in en)) problems.push(`%${k}% missing in en.json`);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort().join(',');
    for (const [lang, dict] of Object.entries(locales)) {
      if (lang === 'en') continue;
      for (const k of Object.keys(en)) if (!(k in dict) && !pluralForm(k, en)) problems.push(`${lang}.json: missing ${k}`);
      for (const k of Object.keys(dict)) {
        if (pluralForm(k, en)) continue;
        if (!(k in en)) problems.push(`${lang}.json: ${k} not in en.json`);
        else if (vars(dict[k]) !== vars(en[k])) problems.push(`${lang}.json: placeholders of ${k} differ from English`);
      }
    }
  }
  for (const l of c.languages ?? []) {
    const dict = readJson(join(dir, l.dict)) as Record<string, string>;
    for (const k of Object.keys(dict)) if (!(k in CORE_EN)) problems.push(`${l.dict}: ${k} is not a core key`);
  }
  return problems;
}

function readLocales(dir: string, m: Manifest) {
  const locDir = m.contributes?.locales ? join(dir, m.contributes.locales) : null;
  const out: Record<string, Record<string, string>> = {};
  if (locDir && existsSync(locDir)) for (const f of readdirSync(locDir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = readJson(join(locDir, f));
  return out;
}

/** The catalog row of an extension: texts resolved per language, files hashed */
export function indexEntry(dir: string, m: Manifest): RegistryEntry {
  const files = Object.fromEntries(packageFiles(dir).map(p => [p, 'sha256-' + sha256(readFileSync(join(dir, p)))]));
  const strings = readLocales(dir, m);
  const en = strings.en ?? {};
  const text = (v: string | undefined, lang = 'en') => v && resolveString(v, { ...en, ...strings[lang] });
  const entry: RegistryEntry = {
    id: m.id, name: text(m.name)!, version: m.version, description: text(m.description), icon: m.icon, author: m.author,
    permissions: m.permissions ?? [], path: `${m.id}/`, files,
  };
  const langs = Object.keys(strings).filter(l => l !== 'en');
  if (langs.length) entry.i18n = Object.fromEntries(langs.map(l => [l, { name: text(m.name, l)!, description: text(m.description, l) }]));
  const c = m.contributes ?? {};
  if (c.languages?.length) {
    const total = Object.keys(CORE_EN).length;
    entry.completeness = Object.fromEntries(c.languages.map(l => {
      const dict = readJson(join(dir, l.dict)) as Record<string, string>;
      const done = Object.keys(CORE_EN).filter(k => typeof dict[k] === 'string' && dict[k] !== '').length;
      return [l.code, Math.round(done / total * 1000) / 10];
    }));
  }
  return entry;
}

/**
 * The catalog of `root`; extensions that fail their checks are left out and reported.
 * `publicOnly` leaves out those with `"public": false` (the published catalog); `base` makes
 * every package path absolute (`<base><id>/`).
 */
export function buildIndex(root = SRC, only: string[] = [], { publicOnly = false, base = '' } = {}) {
  const extensions: RegistryEntry[] = [];
  const problems: { id: string; problems: string[]; }[] = [];
  for (const id of extensionIds(root)) {
    if (only.length && !only.includes(id)) continue;
    const dir = join(root, id);
    try {
      const m = readJson(join(dir, 'manifest.json')) as Manifest;
      const p = check(dir, m);
      if (p.length) { problems.push({ id, problems: p }); continue; }
      if (publicOnly && m.public === false) continue;
      const entry = indexEntry(dir, m);
      if (base) entry.path = `${base.replace(/\/?$/, '/')}${entry.path}`;
      extensions.push(entry);
    } catch (e) { problems.push({ id, problems: [String(e)] }); }
  }
  return { registry: { version: 2, extensions }, problems };
}
