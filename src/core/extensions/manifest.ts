/**
 * Manifest validation and `%key%` resolution. No dependencies: also used by scripts/build-extensions.ts.
 */
import { API_VERSION, type FormSchema, type Manifest } from "@pixprite/api";

export type { Manifest } from "@pixprite/api";

const ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
const PERMISSIONS = new Set(['sprite:read', 'sprite:write', 'tags:lock', 'ui:panel', 'storage', 'clipboard']);
const FIELD_TYPES = new Set(['slider', 'number', 'color', 'select', 'checkbox', 'text', 'layer', 'tag']);
const DOCKS = new Set(['left', 'right', 'bottom', 'float']);
const SLOTS = new Set(['statusbar', 'toolbar']);
/** Relative path inside the extension: no scheme, no leading slash, no `..` */
const PATH = /^(?![a-z]+:|\/)(?!.*(^|\/)\.\.(\/|$))[\w\-./]+$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Checks a parsed manifest.json. Returns a list of problems (`path: message`), empty when valid.
 */
export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObj(m)) return ['manifest: not an object'];

  if (!isStr(m.id) || !ID.test(m.id)) err('id', 'lowercase letters, digits, "." and "-"');
  if (!isStr(m.name)) err('name', 'required');
  if (!isStr(m.version) || !SEMVER.test(m.version)) err('version', 'semver expected');
  if (m.apiVersion !== API_VERSION) err('apiVersion', `must be ${API_VERSION}`);
  for (const k of ['author', 'description'] as const) if (m[k] !== undefined && typeof m[k] !== 'string') err(k, 'string expected');
  for (const k of ['icon', 'entry'] as const) if (m[k] !== undefined && !(isStr(m[k]) && PATH.test(m[k]))) err(k, 'relative path expected');
  if (m.public !== undefined && typeof m.public !== 'boolean') err('public', 'boolean expected');

  const perms = m.permissions ?? [];
  if (!Array.isArray(perms)) err('permissions', 'array expected');
  else perms.forEach((p, i) => {
    if (!isStr(p) || !(PERMISSIONS.has(p) || /^network:(\*|[a-z0-9.-]+(:\d+)?)$/i.test(p))) err(`permissions[${i}]`, `unknown "${p}"`);
  });
  const has = (p: string) => Array.isArray(perms) && perms.includes(p);

  const c = m.contributes;
  if (c === undefined) return errors;
  if (!isObj(c)) { err('contributes', 'object expected'); return errors; }

  /** Validates `c[key]` as an array of objects; `check` gets each item and its path */
  const list = (key: string, check: (it: Record<string, unknown>, at: string) => void) => {
    const arr = c[key];
    if (arr === undefined) return;
    if (!Array.isArray(arr)) return err(`contributes.${key}`, 'array expected');
    const ids = new Set<string>();
    arr.forEach((it, i) => {
      const at = `contributes.${key}[${i}]`;
      if (!isObj(it)) return err(at, 'object expected');
      if ('id' in it || key !== 'menus') {
        const id = it.id ?? it.code;
        if (isStr(id)) { if (ids.has(id)) err(at, `duplicate id "${id}"`); ids.add(id); }
      }
      check(it, at);
    });
  };
  const need = (it: Record<string, unknown>, at: string, ...keys: string[]) => {
    for (const k of keys) if (!isStr(it[k])) err(`${at}.${k}`, 'required');
  };
  const path = (it: Record<string, unknown>, at: string, k: string) => {
    if (!isStr(it[k]) || !PATH.test(it[k])) err(`${at}.${k}`, 'relative path expected');
  };
  const form = (v: unknown, at: string) => { for (const e of validateForm(v)) err(at, e); };
  const needsCode = (at: string) => { if (!m.entry) err(at, 'needs "entry"'); };

  list('themes', (it, at) => {
    need(it, at, 'id', 'label');
    if (!isObj(it.vars) || !Object.values(it.vars).every(v => typeof v === 'string')) err(`${at}.vars`, 'object of strings expected');
  });
  list('commands', (it, at) => { need(it, at, 'id', 'label'); needsCode(at); });
  list('tools', (it, at) => {
    need(it, at, 'id', 'label', 'group'); path(it, at, 'icon'); needsCode(at);
    if (it.options !== undefined) form(it.options, `${at}.options`);
  });
  list('panels', (it, at) => {
    need(it, at, 'id', 'label'); path(it, at, 'page');
    if (!DOCKS.has(it.dock as string)) err(`${at}.dock`, [...DOCKS].join(' | '));
    if (it.hidden !== undefined && typeof it.hidden !== 'boolean') err(`${at}.hidden`, 'boolean expected');
    for (const k of ['width', 'height']) if (it[k] !== undefined && !(typeof it[k] === 'number' && it[k] >= 120 && it[k] <= 4000)) err(`${at}.${k}`, 'number 120..4000 expected');
    for (const k of ['minWidth', 'minHeight']) if (it[k] !== undefined && !(typeof it[k] === 'number' && it[k] >= 60 && it[k] <= 2000)) err(`${at}.${k}`, 'number 60..2000 expected');
    if (it.detachable !== undefined && typeof it.detachable !== 'boolean') err(`${at}.detachable`, 'boolean expected');
    if (!has('ui:panel')) err(at, 'needs "ui:panel" permission');
  });
  list('widgets', (it, at) => {
    need(it, at, 'id'); path(it, at, 'page');
    if (!SLOTS.has(it.slot as string)) err(`${at}.slot`, [...SLOTS].join(' | '));
    if (!has('ui:panel')) err(at, 'needs "ui:panel" permission');
  });
  list('menus', (it, at) => need(it, at, 'location', 'command'));
  list('filters', (it, at) => { need(it, at, 'id', 'label'); form(it.options ?? [], `${at}.options`); needsCode(at); });
  for (const key of ['importers', 'exporters']) list(key, (it, at) => {
    need(it, at, 'id', 'label'); needsCode(at);
    if (!Array.isArray(it.extensions) || !it.extensions.length || !it.extensions.every(isStr)) err(`${at}.extensions`, 'non-empty string array expected');
  });
  list('languages', (it, at) => {
    need(it, at, 'code', 'name'); path(it, at, 'dict');
    if (it.dir !== 'ltr' && it.dir !== 'rtl') err(`${at}.dir`, 'ltr | rtl');
    if (isStr(it.code)) try { Intl.getCanonicalLocales(it.code); } catch { err(`${at}.code`, 'invalid BCP 47 code'); }
    if (it.extensions !== undefined) {
      if (!isObj(it.extensions)) err(`${at}.extensions`, 'object expected');
      else for (const [k, v] of Object.entries(it.extensions)) if (!isStr(v) || !PATH.test(v)) err(`${at}.extensions.${k}`, 'relative path expected');
    }
  });
  if (c.locales !== undefined && !(isStr(c.locales) && PATH.test(c.locales))) err('contributes.locales', 'relative path expected');

  return errors;
}

export function validateForm(v: unknown): string[] {
  if (!Array.isArray(v)) return ['array expected'];
  const errors: string[] = [];
  const keys = new Set<string>();
  v.forEach((f, i) => {
    if (!isObj(f)) return errors.push(`[${i}]: object expected`);
    if (!isStr(f.key)) errors.push(`[${i}].key: required`);
    else if (keys.has(f.key)) errors.push(`[${i}].key: duplicate "${f.key}"`);
    else keys.add(f.key);
    if (!FIELD_TYPES.has(f.type as string)) errors.push(`[${i}].type: unknown "${f.type}"`);
    if (!isStr(f.label)) errors.push(`[${i}].label: required`);
    for (const k of ['min', 'max', 'step'] as const) if (f[k] !== undefined && typeof f[k] !== 'number') errors.push(`[${i}].${k}: number expected`);
    if (f.type === 'select' && !(Array.isArray(f.options) && f.options.every(o => isObj(o) && 'value' in o && isStr(o.label))))
      errors.push(`[${i}].options: [{ value, label }] expected`);
  });
  return errors;
}

/** Validates and narrows; throws with all problems joined */
export function parseManifest(json: unknown): Manifest {
  const errors = validateManifest(json);
  if (errors.length) throw new Error(`Invalid manifest:\n${errors.join('\n')}`);
  return json as Manifest;
}

/**
 * Resolves `%key%` against the extension's strings (keys without `ext.<id>.`).
 * A whole-string `%key%` or embedded ones (`"Blur %opts.radius%"`); unknown keys stay as the key.
 */
export function resolveString(s: string, strings: Record<string, string | undefined>): string {
  return s.replace(/%([\w.-]+)%/g, (_, key: string) => strings[key] ?? key);
}

/** Deep copy of `value` with every string passed through `resolveString` (for manifests and FormSchemas) */
export function resolveStrings<T>(value: T, strings: Record<string, string | undefined>): T {
  if (typeof value === 'string') return resolveString(value, strings) as T;
  if (Array.isArray(value)) return value.map(v => resolveStrings(v, strings)) as T;
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveStrings(v, strings)])) as T;
  return value;
}

/** Keys referenced as `%key%` anywhere in `value` (for i18n:check) */
export function referencedKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const m of value.matchAll(/%([\w.-]+)%/g)) out.add(m[1]);
  else if (Array.isArray(value)) value.forEach(v => referencedKeys(v, out));
  else if (isObj(value)) Object.values(value).forEach(v => referencedKeys(v, out));
  return out;
}

/** Validates a FormSchema typed value (runtime counterpart of the type) */
export const isFormSchema = (v: unknown): v is FormSchema => validateForm(v).length === 0;
