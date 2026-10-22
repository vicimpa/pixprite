/**
 * Interface translations. Texts are looked up by semantic keys grouped by area:
 * `menu.file`, `cmd.<command id>`, `tool.<tool name>`, `hint.tool.<tool name>`, `dialog.<dialog>.<text>`,
 * `home.*`, `options.*`, `timeline.*`… and shared short words in `common.*` (`common.ok`, `common.cancel`).
 * Dictionaries are flat `src/locales/<lang>.json` files (`"key": "text"`, sorted by key), all with
 * the same key set; `bun run i18n:check` reports keys missing from a locale or no longer used.
 * They are fetched on demand; `t()` reads the language preference and the loaded dictionaries,
 * so components re-render when either changes. A key missing in a language falls back to the
 * base language (`pt-BR` → `pt`), then English, then the key itself (one-time warning in development).
 * Languages live in a registry (`languages`) that language packs extend with registerLanguage; texts are
 * layered per source (built-in < packs < user) by addDictionary/removeDictionary, so removing an
 * extension removes its texts. `vars.count` picks a plural form `key.one|few|many|other` by Intl.PluralRules.
 * Extension texts are namespaced `ext.<id>.*` and read through createTranslator(id).
 * Only literal keys and props named as keys are translated: names typed by the user are shown as is.
 */

import { state } from "~/core/State";
import { computed, effect, signal } from "@preact/signals-react";

export type Dict = Record<string, string>;
export type Language = string;
export type TextDir = 'ltr' | 'rtl';
type Vars = Record<string, string | number>;

/** A registered language: native name, writing direction and who added it ('core' for built-in ones) */
export interface LanguageInfo { code: Language, name: string, dir: TextDir, source: string }

// Locale files are emitted as plain .json assets and fetched on demand, never bundled as code.
// Adding a built-in language is just dropping `<code>.json` into src/locales.
const URLS = import.meta.glob<string>('../locales/*.json', { query: '?url', import: 'default', eager: true });

/** Language name in that language itself, e.g. "Русский" for ru */
const nativeName = (code: string) => {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch { return code; }
};

/** Registry of available languages, English first; language packs add to it at run time */
export const languages = signal<Record<Language, LanguageInfo>>({});
const loaders = new Map<Language, () => Promise<Dict>>();

const ordered = (all: Record<Language, LanguageInfo>) => Object.fromEntries(
  Object.entries(all).sort(([a], [b]) => a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));

/**
 * Adds a language to the registry. `load` fetches its base dictionary (layered under `source`)
 * when the language is first needed; a pack may also push texts with addDictionary instead.
 */
export function registerLanguage(code: Language, name = nativeName(code), dir: TextDir = 'ltr', load?: () => Promise<Dict>, source = 'core') {
  if (load) loaders.set(code, async () => { addDictionary(code, await load(), source); return {}; });
  languages.value = ordered({ ...languages.peek(), [code]: { code, name, dir, source } });
}

/** Removes a language from the registry (its dictionaries stay until removeDictionary) */
export function unregisterLanguage(code: Language) {
  const { [code]: _, ...rest } = languages.peek();
  languages.value = rest;
  loaders.delete(code);
  loaded.delete(code);
}

/** Available languages as code → native name; reading it in a render subscribes to the registry */
export const LANGUAGES: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, k) => typeof k === 'string' ? languages.value[k]?.name : undefined,
  has: (_, k) => typeof k === 'string' && k in languages.value,
  ownKeys: () => Object.keys(languages.value),
  getOwnPropertyDescriptor: (_, k) => typeof k === 'string' && k in languages.value
    ? { value: languages.value[k].name, enumerable: true, configurable: true, writable: false } : undefined,
});

for (const path of Object.keys(URLS)) {
  const code = path.match(/([^/]+)\.json$/)![1];
  registerLanguage(code, nativeName(code), 'ltr', () => fetch(URLS[path])
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Dict>; }));
}

// Dictionary layers per language: built-in < language packs < the user's own edits
interface Layer { source: string, dict: Dict }
const rank = (source: string) => source === 'core' ? 0 : source === 'user' ? 2 : 1;
const layers = signal<Partial<Record<Language, Layer[]>>>({});

/** Merged dictionaries, rebuilt when a layer is added or removed */
const dicts = computed(() => Object.fromEntries(Object.entries(layers.value)
  .map(([lang, ls]) => [lang, Object.assign({}, ...ls!.map(l => l.dict)) as Dict])) as Partial<Record<Language, Dict>>);

/** Adds (or replaces) the texts `source` provides for `lang` */
export function addDictionary(lang: Language, dict: Dict, source: string) {
  const ls = (layers.peek()[lang] ?? []).filter(l => l.source !== source);
  ls.push({ source, dict });
  ls.sort((a, b) => rank(a.source) - rank(b.source));
  layers.value = { ...layers.peek(), [lang]: ls };
}

/** Drops every text and language `source` added (an extension being disabled or removed) */
export function removeDictionary(source: string) {
  const next: Partial<Record<Language, Layer[]>> = {};
  for (const [lang, ls] of Object.entries(layers.peek())) {
    const kept = ls!.filter(l => l.source !== source);
    if (kept.length) next[lang] = kept;
  }
  layers.value = next;
  for (const info of Object.values(languages.peek())) if (info.source === source) unregisterLanguage(info.code);
}

const loaded = new Map<Language, Promise<void>>();

/** Fetches a language's base dictionary once; until then the fallback text is shown */
export function loadLanguage(lang: Language) {
  const load = loaders.get(lang);
  if (!load) return Promise.resolve();
  let p = loaded.get(lang);
  if (!p) {
    p = load().then(() => { }, err => { loaded.delete(lang); console.error(`Failed to load "${lang}" texts`, err); });
    loaded.set(lang, p);
  }
  return p;
}

/** `pt-BR` → `pt`; undefined when the code has no region part */
const baseOf = (lang: Language) => { const b = lang.split('-')[0]; return b !== lang ? b : undefined; };

/** Languages a key is looked up in, in order: the language, its base language, English */
const chain = (lang: Language) => [...new Set([lang, baseOf(lang), 'en'].filter(Boolean) as Language[])];

/** Interface language (falls back to English when the chosen one isn't registered) */
export const currentLanguage = computed<Language>(() => {
  const l = state.prefs.language ?? 'en';
  return l in languages.value ? l : 'en';
});
/** Writing direction of the interface language */
export const currentDir = computed<TextDir>(() => languages.value[currentLanguage.value]?.dir ?? 'ltr');

/** Keeps the dictionary of the chosen language loaded; resolves once the current one is in */
export function installI18n() {
  // A language whose file or pack was removed falls back to English
  effect(() => {
    const l = state.prefs.language;
    if (l && !(l in languages.value)) state.setPrefs({ language: 'en' });
  });
  effect(() => { for (const l of chain(currentLanguage.value)) void loadLanguage(l); });
  effect(() => {
    document.documentElement.lang = currentLanguage.value;
    document.documentElement.dir = currentDir.value;
  });
  // English is the fallback for keys a language doesn't have yet
  return Promise.all(chain((state.prefs.language ?? 'en') as Language).map(loadLanguage));
}

/** First guess from the browser, used until the user picks a language */
export function browserLanguage(): Language {
  const all = languages.peek();
  const full = navigator.language;
  if (full && full in all) return full;
  const l = full?.slice(0, 2);
  return l && l in all ? l as Language : 'en';
}

const warned = new Set<string>();

/** Development-only notice of a key some loaded dictionary lacks, once per key and language */
function warnMissing(lang: Language, key: string) {
  if (!import.meta.env.DEV || warned.has(`${lang}:${key}`)) return;
  warned.add(`${lang}:${key}`);
  console.warn(`[i18n] "${key}" is missing in ${lang}.json`);
}

const pluralRules = new Map<Language, Intl.PluralRules>();
/** CLDR plural category of `count` in `lang` (`one`, `few`, `many`, `other`…) */
export function pluralForm(lang: Language, count: number) {
  let r = pluralRules.get(lang);
  if (!r) {
    try { r = new Intl.PluralRules(lang); } catch { r = new Intl.PluralRules('en'); }
    pluralRules.set(lang, r);
  }
  return r.select(count);
}

/**
 * Raw lookup through the fallback chain; with a numeric `count` the plural forms
 * `key.<form>` and `key.other` are tried before `key` itself. Undefined when no dictionary has it.
 */
export function lookup(key: string, lang: Language = currentLanguage.value, count?: number, warn = false): string | undefined {
  const all = dicts.value;
  const keys = typeof count === 'number' ? [`${key}.${pluralForm(lang, count)}`, `${key}.other`, key] : [key];
  const langs = chain(lang);
  for (const l of langs) {
    const d = all[l];
    if (!d) continue;
    // Plural forms are per language: the form for this count may differ between languages
    const ks = typeof count === 'number' && l !== lang ? [`${key}.${pluralForm(l, count)}`, `${key}.other`, key] : keys;
    for (const k of ks) if (d[k] !== undefined) return d[k];
    if (warn) warnMissing(l, key);
  }
  return undefined;
}

const fill = (text: string, vars?: Vars) => {
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};

/** Text of `key` in the interface language; `{name}` placeholders are filled from `vars`, `vars.count` picks the plural form */
export function t(key: string, vars?: Vars) {
  const count = typeof vars?.count === 'number' ? vars.count : undefined;
  return keyNames(fill(lookup(key, currentLanguage.value, count, true) ?? key, vars));
}

/** English text of a key (command search also matches the English names) */
export function english(key: string) {
  return dicts.value.en?.[key] ?? key;
}

/** Share of the English core keys `lang` translates, 0..1 */
export function completeness(lang: Language, prefix = '') {
  const en = Object.keys(dicts.value.en ?? {}).filter(k => k.startsWith(prefix) && (prefix || !k.startsWith('ext.')));
  if (!en.length) return lang === 'en' ? 1 : 0;
  const d = dicts.value[lang] ?? {};
  return en.filter(k => d[k] !== undefined).length / en.length;
}

/** The whole dictionary of `lang` with fallbacks applied, keys under `prefix` with the prefix removed */
export function dictionaryFor(lang: Language = currentLanguage.value, prefix = '') {
  const out: Dict = {};
  for (const l of chain(lang).reverse()) for (const [k, v] of Object.entries(dicts.value[l] ?? {})) {
    if (prefix ? k.startsWith(prefix) : !k.startsWith('ext.')) out[k.slice(prefix.length)] = v;
  }
  return out;
}

/** `Intl` formatting in the interface language */
export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(currentLanguage.value, opts).format(n);
export const formatDate = (d: Date | number, opts?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(currentLanguage.value, opts).format(d);
export const formatList = (items: string[], opts?: Intl.ListFormatOptions) => new Intl.ListFormat(currentLanguage.value, opts).format(items);

/** Translator of one extension: `t` reads its own `ext.<id>.*` keys, `core` the editor's */
export interface Translator {
  t(key: string, vars?: Vars): string
  core(key: string, vars?: Vars): string
  readonly lang: Language
  readonly dir: TextDir
  /** Called on every language change (and when dictionaries change); returns the unsubscribe */
  on(event: 'change', cb: (lang: Language) => void): () => void
  /** The extension's own texts and the core ones for the current language, fallbacks applied (the `init` / `i18n:change` payload) */
  snapshot(): { lang: Language, dir: TextDir, strings: Dict, core: Dict }
  number: typeof formatNumber
  date: typeof formatDate
  list: typeof formatList
}

/** Host-side translator for extension `extId` */
export function createTranslator(extId: string): Translator {
  const prefix = `ext.${extId}.`;
  return {
    t: (key, vars) => {
      const count = typeof vars?.count === 'number' ? vars.count : undefined;
      return fill(lookup(prefix + key, currentLanguage.value, count) ?? key, vars);
    },
    core: (key, vars) => t(key, vars),
    get lang() { return currentLanguage.value; },
    get dir() { return currentDir.value; },
    on: (_event, cb) => {
      let first = true;
      return effect(() => {
        const lang = currentLanguage.value;
        void dicts.value;
        if (first) { first = false; return; }
        cb(lang);
      });
    },
    snapshot: () => ({
      lang: currentLanguage.value, dir: currentDir.value,
      strings: dictionaryFor(currentLanguage.value, prefix), core: dictionaryFor(currentLanguage.value),
    }),
    number: formatNumber, date: formatDate, list: formatList,
  };
}

/** Mac users read ⌘ / ⌥ / ⇧ where the text says Ctrl / Alt / Shift */
export function keyNames(text: string) {
  const style = state.prefs.keyStyle;
  const mac = style === 'mac' || (style !== 'pc' && /Mac|iPhone|iPad/.test(navigator.platform));
  if (!mac) return text;
  return text
    .replace(/\bCtrl\b\+?/g, '⌘').replace(/\bAlt\b\+?/g, '⌥').replace(/\bShift\b\+?/g, '⇧')
    .replace(/\bBackspace\b/g, '⌫').replace(/\bEnter\b/g, '↩').replace(/\bEsc(ape)?\b/g, '⎋');
}

/** Translates only text that is itself a known key (for text that may come from the user); anything else is returned as is */
export function tMaybe(text: string) {
  return lookup(text) !== undefined ? t(text) : text;
}
