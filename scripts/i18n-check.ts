/**
 * Checks the interface texts: `bun run i18n:check`.
 * Reports keys used in the code but missing in a locale, keys a locale has and another doesn't,
 * keys no code refers to, and translations whose `{placeholders}` differ from English.
 *
 * A key counts as used when it appears as a string literal in src (`t('menu.file')`, tables of keys,
 * `title: 'tool.pencil'`…). Keys built at run time are matched by pattern: a template literal such as
 * t(`layout.${name}`) covers every `layout.*` key, and command labels (`cmd.<id>`) are derived
 * from the ids in src/core/Commands.ts.
 *
 * Extensions: `bun run i18n:check --ext extensions/<id>` checks one extension (without `--ext`, every
 * folder in extensions/ is checked after the core). An extension's `locales/<lang>.json` are compared
 * with its `en.json`, and every `%key%` in manifest.json must be in it. A language pack
 * (`contributes.languages`) is compared with src/locales/en.json and, for the extensions it
 * translates, with their en.json; a pack may be incomplete, so missing keys only lower its completeness.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import ts from "typescript";
import { referencedKeys } from "../src/core/extensions/manifest";

type Dict = Record<string, string>;

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'src');
const LOCALES = join(SRC, 'locales');

/** Placeholder names of a text, sorted: `{count} of {total}` → `count,total` */
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
/** Plural forms (`key.one`, `key.few`…) all stand for `key.other` in English */
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const enText = (en: Dict, k: string) => en[k] ?? (PLURAL.test(k) ? en[k.replace(PLURAL, '.other')] : undefined);

/** Translated share of the English keys, 0..100 (a plural key counts when any of its forms is present) */
export function completeness(en: Dict, dict: Dict) {
  const keys = Object.keys(en).filter(k => !PLURAL.test(k) || k.endsWith('.other'));
  if (!keys.length) return 100;
  const has = (k: string) => k in dict || (k.endsWith('.other') && Object.keys(dict).some(d => d.startsWith(k.slice(0, -5))));
  return Math.round(keys.filter(has).length / keys.length * 1000) / 10;
}

/** Keys whose placeholders differ from English */
export const placeholderMismatches = (en: Dict, dict: Dict) =>
  Object.keys(dict).filter(k => enText(en, k) !== undefined && vars(dict[k]) !== vars(enText(en, k)!));

/** Keys a translation has that English doesn't */
export const extraKeys = (en: Dict, dict: Dict) => Object.keys(dict).filter(k => enText(en, k) === undefined);

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const readDict = (dir: string) => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.json'))
  .map(f => [f.slice(0, -5), readJson(join(dir, f)) as Dict]));

/** Completeness of every language a pack contributes, against the core English texts: code → 0..100 */
export function packCompleteness(dir: string): Record<string, number> {
  const manifest = readJson(join(dir, 'manifest.json'));
  const en = readJson(join(LOCALES, 'en.json')) as Dict;
  return Object.fromEntries((manifest.contributes?.languages ?? []).map((l: { code: string, dict: string }) =>
    [l.code, completeness(en, readJson(join(dir, l.dict)))]));
}


let problems = 0;
const report = (title: string, lines: string[]) => {
  if (!lines.length) return;
  problems += lines.length;
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines.sort()) console.log(`  ${l}`);
};

function checkCore() {
  const locales: Record<string, Dict> = {};
  for (const f of readdirSync(LOCALES)) if (f.endsWith('.json')) locales[f.slice(0, -5)] = JSON.parse(readFileSync(join(LOCALES, f), 'utf8'));
  const all = new Set(Object.values(locales).flatMap(Object.keys));
  const namespaces = new Set([...all].map(k => k.split('.')[0]));

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  }

  const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
  const used = new Map<string, string>(); // key → first file using it
  const patterns: RegExp[] = [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** `cmd.` + the id with each part starting lowercase, as commandKey() in Commands.ts */
  const commandKey = (id: string) => 'cmd.' + id.split('.').map(p => p[0].toLowerCase() + p.slice(1)).join('.');

  // Command ids (`brush.bigger`, `tiles.mode`) look like keys but aren't
  const commandIds = new Set([...readFileSync(join(SRC, 'core/Commands.ts'), 'utf8').matchAll(/\bid: '([^']+)'/g)].map(m => m[1]));

  for (const file of files(SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    // RPC method names of the extension protocol (`extensions.get`, `locks.set`) look like keys but aren't
    const rpc = rel === 'src/core/extensions/protocol.ts' || rel.startsWith('src/core/extensions/api/');
    // String literals found by the TypeScript parser (quotes inside JSX text don't confuse it)
    const literals: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
    for (const s of rpc ? [] : literals) {
      // Literals of a known area (`menu.…`, `dialog.…`); other dotted ids (`file.new`) are not keys
      if (KEY.test(s) && namespaces.has(s.split('.')[0]) && !commandIds.has(s) && !used.has(s)) used.set(s, rel);
    }
    // Run-time keys: t(`area.${x}`) covers the whole area after the fixed part
    for (const m of text.matchAll(/\bt\(`([a-z][\w.]*)\$\{/g)) patterns.push(new RegExp(`^${escape(m[1])}`));
    if (rel.endsWith('core/Commands.ts')) {
      for (const m of text.matchAll(/\bid: '([^']+)'/g)) if (!used.has(commandKey(m[1]))) used.set(commandKey(m[1]), rel);
      // Ids made from a template (`nudge.${key}`): every key under that prefix counts
      for (const m of text.matchAll(/\bid: `([\w.]+)\$\{/g)) patterns.push(new RegExp(`^${escape(commandKey(m[1] + 'x').slice(0, -1))}`));
    }
  }

  for (const [lang, dict] of Object.entries(locales)) {
    report(`Used in code, missing in ${lang}.json`, [...used].filter(([k]) => !(k in dict)).map(([k, f]) => `${k}  (${f})`));
    report(`In other locales, missing in ${lang}.json`, [...all].filter(k => !(k in dict) && !used.has(k)).map(k => k));
  }

  const isUsed = (k: string) => used.has(k) || patterns.some(p => p.test(k));
  report('In locales, not used in code', [...all].filter(k => !isUsed(k)));

  const en = locales.en ?? {};
  for (const [lang, dict] of Object.entries(locales)) {
    if (lang === 'en') continue;
    report(`Placeholders differ from English in ${lang}.json`,
      Object.keys(dict).filter(k => k in en && vars(dict[k]) !== vars(en[k])).map(k => `${k}: "${dict[k]}"`));
  }

  console.log(`i18n: ${all.size} keys in ${Object.keys(locales).join(', ')}`);
}

/** An extension's own locales against its en.json, or a language pack against the texts it translates */
function checkExtension(dir: string) {
  const manifest = readJson(join(dir, 'manifest.json'));
  const name = manifest.id ?? dir;
  const langs = manifest.contributes?.languages as { code: string, dict: string, extensions?: Record<string, string> }[] | undefined;
  const localesDir = join(dir, manifest.contributes?.locales ?? 'locales');
  if (existsSync(localesDir)) {
    const own = readDict(localesDir);
    const en = own.en;
    if (!en) report(`${name}: no en.json in ${manifest.contributes?.locales ?? 'locales/'}`, ['en.json']);
    else {
      report(`${name}: used in manifest.json, missing in en.json`, [...referencedKeys(manifest)].filter(k => !(k in en)));
      for (const [lang, dict] of Object.entries(own)) {
        if (lang === 'en') continue;
        report(`${name}: missing in ${lang}.json`, Object.keys(en).filter(k => !(k in dict)));
        report(`${name}: not in en.json, present in ${lang}.json`, extraKeys(en, dict));
        report(`${name}: placeholders differ from English in ${lang}.json`, placeholderMismatches(en, dict).map(k => `${k}: "${dict[k]}"`));
      }
    }
  } else if (referencedKeys(manifest).size) report(`${name}: manifest uses %keys% but has no locales folder`, [...referencedKeys(manifest)]);

  const coreEn = readJson(join(LOCALES, 'en.json')) as Dict;
  for (const l of langs ?? []) {
    const dict = readJson(join(dir, l.dict)) as Dict;
    report(`${name}: ${l.code} keys unknown to the editor`, extraKeys(coreEn, dict));
    report(`${name}: ${l.code} placeholders differ from English`, placeholderMismatches(coreEn, dict).map(k => `${k}: "${dict[k]}"`));
    console.log(`${name}: ${l.code} ${completeness(coreEn, dict)}% of the editor translated`);
    for (const [extId, file] of Object.entries(l.extensions ?? {})) {
      const enFile = join(ROOT, 'extensions', extId, 'locales', 'en.json');
      if (!existsSync(enFile)) { console.log(`${name}: ${l.code} translates ${extId}, not in extensions/ (skipped)`); continue; }
      const extEn = readJson(enFile) as Dict, ext = readJson(join(dir, file)) as Dict;
      report(`${name}: ${l.code} keys unknown to ${extId}`, extraKeys(extEn, ext));
      report(`${name}: ${l.code} placeholders differ from ${extId} English`, placeholderMismatches(extEn, ext).map(k => `${k}: "${ext[k]}"`));
      console.log(`${name}: ${l.code} ${completeness(extEn, ext)}% of ${extId} translated`);
    }
  }
}

if (import.meta.main) {
  const at = process.argv.indexOf('--ext');
  if (at >= 0) {
    if (!process.argv[at + 1]) { console.log('Usage: bun scripts/i18n-check.ts [--ext <extension dir>]'); process.exit(2); }
    checkExtension(resolve(process.argv[at + 1]));
  } else {
    checkCore();
    const EXT = join(ROOT, 'extensions');
    if (existsSync(EXT)) for (const d of readdirSync(EXT)) if (existsSync(join(EXT, d, 'manifest.json'))) checkExtension(join(EXT, d));
  }
  if (problems) {
    console.log(`\n${problems} problem(s)`);
    process.exit(1);
  }
  console.log('i18n: all used and translated');
}
