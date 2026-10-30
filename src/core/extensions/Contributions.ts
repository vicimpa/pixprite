/**
 * What extensions add to the editor. The manifest's data-only parts (themes, languages, locales,
 * command labels / menus / hotkeys, tools, panels…) are loaded without running any code;
 * the callable parts become live once the worker registers them.
 */
import type { FormSchema, FormValues, PixelData, PointerInfo, Problem, SpriteSnapshot } from "@pixprite/api";
import { effect, signal } from "@preact/signals-react";
import { registerCommand, type Command } from "~/core/Commands";
import { download } from "~/core/Files";
import { addDictionary, languages, registerLanguage, removeDictionary, type Dict } from "~/core/i18n";
import { state, type ToolName } from "~/core/State";
import { applyTheme, registerTheme, THEMES, themesVersion } from "~/core/Themes";
import { declarePanel } from "./panels";
import { compile, LINKER, sourceOf } from "./compile";
import { pen, registerTool, type Session, type ToolGroup, type ToolPointer } from "~/core/Tools";
import { hosts } from "./api/common";
import { snapshot } from "./api/sprite";
import type { ExtensionHost } from "./Host";
import { resolveStrings } from "./manifest";
import { readFile, readJson, safePath, type InstalledExtension } from "./Registry";

/** Id of a contribution across extensions: `<extension id>:<contribution id>` */
export const keyOf = (ext: string, id: string) => `${ext}:${id}`;

const source = (ext: string) => `ext:${ext}`;

/** Removes the extension's texts and language-pack dictionaries */
export const dropTexts = (ext: string) => removeDictionary(source(ext));

type Entry = { key: string; ext: string; id: string; };

export type FilterEntry = Entry & { readonly label: string; readonly options: FormSchema; ready: boolean; };
export type IoEntry = Entry & { readonly label: string; extensions: string[]; ready: boolean; };
export type PanelEntry = Entry & {
  readonly label: string; dock: 'left' | 'right' | 'bottom' | 'float'; page: string;
  width?: number; height?: number; minWidth?: number; minHeight?: number; detachable: boolean;
};
export type WidgetEntry = Entry & { slot: 'statusbar' | 'toolbar'; page: string; };
export type MenuEntry = { ext: string; location: string; command: string; };
export type ProblemEntry = Problem & { ext: string; validator: string; };

export const filters = signal<FilterEntry[]>([]);
export const importers = signal<IoEntry[]>([]);
export const exporters = signal<IoEntry[]>([]);
export const panels = signal<PanelEntry[]>([]);
export const widgets = signal<WidgetEntry[]>([]);
/** Commands extensions put into context menus (`canvas`, `layer`…) and main menus (by menu id) */
export const menuItems = signal<MenuEntry[]>([]);
/** Problems the validators found in the active document */
export const problems = signal<ProblemEntry[]>([]);
/** Pixels an extension tool shows over the canvas during its stroke (sprite coordinates) */
export const toolOverlay = signal<{ ext: string; pixels: PixelData; } | null>(null);
/** Current option values of extension tools, by tool name; the tool options bar edits them */
export const toolOptions = signal<Record<string, FormValues>>({});
/** Option forms of extension tools, by tool name (labels resolved) */
export const toolForms = signal<Record<string, FormSchema>>({});

const add = <T extends Entry>(s: { value: T[]; peek(): T[]; }, e: T) => {
  s.value = [...s.peek().filter(x => x.key !== e.key), e];
  return () => { s.value = s.peek().filter(x => x !== e); };
};

function setReady(s: typeof filters | typeof importers | typeof exporters, key: string, ready: boolean) {
  s.value = s.peek().map(e => e.key === key ? Object.assign(Object.create(Object.getPrototypeOf(e)), e, { ready }) : e);
}

/** A list entry whose label follows the language */
function labelled<T extends object>(host: ExtensionHost, raw: string, rest: T): T & { readonly label: string; } {
  return Object.defineProperties({ ...rest }, { label: { get: () => host.label(raw), enumerable: true } }) as T & { readonly label: string; };
}

/** Url of a package file the editor itself shows (icons); blob urls are freed when the extension stops */
async function fileUrl(host: ExtensionHost, path: string) {
  const ext = host.ext;
  if (!safePath(path)) return undefined;
  if (ext.source === 'dev') return new URL(path, ext.url).href;
  const blob = await readFile(ext, path);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  host.onDispose(() => URL.revokeObjectURL(url));
  return url;
}

const dataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/**
 * What to load into a panel / widget iframe (sandbox="allow-scripts", never same-origin): a
 * self-contained `srcdoc`. The page is the package's `src/<page>` (or a bare one that runs
 * `src/<page>.ts`); its module scripts are compiled from source and linked inside the frame,
 * its styles inlined and its images turned into data urls.
 */
export async function framePage(ext: InstalledExtension, page: string): Promise<{ srcdoc: string; }> {
  const read = async (p: string) => (await readFile(ext, p))?.text() ?? null;
  let path = `src/${page}`;
  let text = await read(path);
  if (text === null) { path = page; text = await read(page); }
  // No page of its own: a bare one running the script of the same name
  if (text === null) {
    path = `src/${page}`;
    text = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>`
      + `<body><div id="root"></div><script type="module" src="./${page.split('/').pop()!.replace(/\.html$/, '.js')}"></script></body></html>`;
  }
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const resolve = (p: string) => new URL(p, `https://x/${dir}`).pathname.slice(1);
  const local = (p: string) => !/^([a-z]+:|\/\/|#|data:)/i.test(p);
  const jobs: Promise<void>[] = [];
  const swaps = new Map<string, string>();
  const swap = (whole: string, make: () => Promise<string | null>) => {
    jobs.push(make().then(v => { if (v !== null) swaps.set(whole, v); }));
  };
  for (const m of text.matchAll(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi)) {
    const [whole, , src] = m;
    if (!local(src)) continue;
    swap(whole, async () => {
      const source = await sourceOf(read, resolve(src));
      if (!source) throw new Error(`${ext.id}: ${resolve(src)} has no source`);
      const { modules } = await compile(read, source);
      // Linked in the frame; a failure shows in its console (and reaches a dev server through the client once loaded)
      return `<script>${LINKER}import(__pxLink(${JSON.stringify(modules).replace(/<\/script/gi, '<\\/script')})).catch(function(e){console.error(e)});</script>`;
    });
  }
  for (const m of text.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)) {
    const href = m[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href || !local(href)) continue;
    swap(m[0], async () => { const f = await readFile(ext, resolve(href)); return f && `<style>${await f.text()}</style>`; });
  }
  for (const m of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (!local(src)) continue;
    swap(m[0], async () => { const f = await readFile(ext, resolve(src)); return f && m[0].replace(src, await dataUrl(f)); });
  }
  await Promise.all(jobs);
  for (const [from, to] of swaps) text = text.split(from).join(to);
  return { srcdoc: text };
}

/** Prefixes a dictionary of the extension's own keys with `ext.<id>.` */
const prefixed = (ext: string, dict: Dict | null) =>
  Object.fromEntries(Object.entries(dict ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [`ext.${ext}.${k}`, v]));

/** The extension's locales (`locales/<lang>.json`) layered under its own source */
export async function loadLocales(ext: InstalledExtension) {
  const dirRaw = ext.manifest.contributes?.locales;
  if (!dirRaw) return;
  const dir = dirRaw.replace(/\/?$/, '/');
  const codes = ext.source === 'dev'
    ? [...new Set(['en', ...Object.keys(languages.peek())])]
    : Object.keys(ext.files).filter(p => p.startsWith(dir) && p.endsWith('.json')).map(p => p.slice(dir.length, -5));
  await Promise.all(codes.map(async code => {
    const dict = await readJson<Dict>(ext, `${dir}${code}.json`);
    if (dict) addDictionary(code, prefixed(ext.id, dict), source(ext.id));
  }));
}

/** Language packs: new languages are registered, texts for existing ones are layered over them */
async function loadLanguages(ext: InstalledExtension) {
  for (const l of ext.manifest.contributes?.languages ?? []) {
    const load = async () => {
      const [base, ...others] = await Promise.all([
        readJson<Dict>(ext, l.dict),
        ...Object.entries(l.extensions ?? {}).map(async ([id, file]) => prefixed(id, await readJson<Dict>(ext, file))),
      ]);
      return Object.assign({}, base ?? {}, ...others) as Dict;
    };
    if (languages.peek()[l.code]) addDictionary(l.code, await load(), source(ext.id));
    else registerLanguage(l.code, l.name, l.dir, load, source(ext.id));
  }
}

/** Main-menu group a command is listed under: a core menu id, or the Extensions menu */
const groupOf = (menu?: string) => menu ? (menu.startsWith('menu.') ? menu : `menu.${menu}`) : 'menu.extensions';

/** Full id of a command named in a manifest: the extension's own, or a core / other extension command */
export function commandId(host: ExtensionHost, id: string) {
  if (id.includes(':')) return id;
  if (host.manifest.contributes?.commands?.some(c => c.id === id) || host.callbacks.has(`command:${id}`)) return keyOf(host.id, id);
  return id;
}

/** Context conditions of `when` */
const WHEN: Record<string, () => boolean> = {
  sprite: () => !state.home,
  selection: () => !state.home && !!(state.sprite.mask || state.sprite.floating),
  editable: () => !state.home && state.sprite.editable,
  indexed: () => !state.home && state.sprite.colorMode === 'indexed',
  playing: () => state.playing,
};

/** Registers an extension command; it runs the worker's callback (or tells the extension isn't ready) */
export function addCommand(host: ExtensionHost, id: string, opts: { label?: string; menu?: string; key?: string; when?: string; params?: FormSchema; } = {}) {
  const when = opts.when?.split(/\s*&&\s*/).map(w => w.startsWith('!') ? () => !WHEN[w.slice(1)]?.() : WHEN[w] ?? (() => true));
  const raw = opts.label ?? id;
  const c: Command = {
    id: keyOf(host.id, id), group: groupOf(opts.menu),
    get label() { return host.label(raw); },
    keys: opts.key ? [opts.key] : [],
    run: () => void runExtensionCommand(host.id, id),
    enabled: () => !when || when.every(f => f()),
    home: !when?.length,
    ext: host.id,
    get params() { return opts.params && resolveStrings(opts.params, host.strings()); },
  };
  return registerCommand(c);
}

export function runExtensionCommand(ext: string, id: string, args: unknown[] = []) {
  const host = hosts.get(ext);
  if (!host) return Promise.reject(new Error(`${ext} is not running`));
  return host.invoke('command', id, ...args).catch(e => {
    console.error(`[ext ${ext}] command ${id}`, e);
    state.showNotice(`${host.name}: ${e instanceof Error ? e.message : e}`, 3000);
  });
}

/**
 * Loads everything the manifest declares. Data parts are live right away;
 * commands / tools / filters / importers / exporters run once the worker registers their callbacks.
 */
export async function loadContributions(host: ExtensionHost) {
  const { ext } = host;
  const c = ext.manifest.contributes ?? {};
  const off = (fn: () => void) => host.onDispose(fn);
  // A failed start keeps the texts, so the extension list still shows its name and the error;
  // they go when the extension is stopped (dropTexts)
  off(() => { if (host.status.peek() !== 'failed') removeDictionary(source(ext.id)); });
  await Promise.all([loadLocales(ext), loadLanguages(ext)]);

  for (const th of c.themes ?? []) {
    const id = `${ext.id}.${th.id}`;
    const remove = registerTheme(id, host.label(th.label), th.vars);
    // The label follows the language; the stylesheet stays, so a chosen theme stays applied
    const relabel = host.translator.on('change', () => {
      const label = host.label(th.label);
      if (THEMES[id] !== undefined && THEMES[id] !== label) { THEMES[id] = label; themesVersion.value++; }
    });
    off(() => { relabel(); remove(); });
    if (state.prefs.theme === id) void applyTheme(id);
  }

  for (const cmd of c.commands ?? []) off(addCommand(host, cmd.id, cmd));

  for (const m of c.menus ?? []) {
    const e: MenuEntry = { ext: ext.id, location: m.location, command: commandId(host, m.command) };
    menuItems.value = [...menuItems.peek(), e];
    off(() => { menuItems.value = menuItems.peek().filter(x => x !== e); });
  }

  for (const t of c.tools ?? []) {
    const name = keyOf(ext.id, t.id) as ToolName;
    const icon = await fileUrl(host, t.icon);
    off(registerTool({
      name, group: t.group as ToolGroup, key: '', title: host.label(t.label), hint: '', icon, cursor: t.cursor, ext: ext.id,
      session: p => toolSession(host, t.id, name, t.label, p),
    }));
    if (t.options) {
      const form = resolveStrings(t.options, host.strings());
      toolForms.value = { ...toolForms.peek(), [name]: form };
      const defaults = Object.fromEntries(form.filter(f => f.default !== undefined).map(f => [f.key, f.default!]));
      toolOptions.value = { ...toolOptions.peek(), [name]: { ...defaults, ...toolOptions.peek()[name] } };
      off(() => {
        const { [name]: _, ...rest } = toolForms.peek();
        toolForms.value = rest;
      });
    }
  }

  for (const f of c.filters ?? [])
    off(add(filters, Object.defineProperty(labelled(host, f.label, { key: keyOf(ext.id, f.id), ext: ext.id, id: f.id, ready: false }),
      'options', { get: () => resolveStrings(f.options, host.strings()), enumerable: true }) as FilterEntry));
  for (const i of c.importers ?? []) off(add(importers, labelled(host, i.label, { key: keyOf(ext.id, i.id), ext: ext.id, id: i.id, extensions: i.extensions, ready: false })));
  for (const x of c.exporters ?? []) off(add(exporters, labelled(host, x.label, { key: keyOf(ext.id, x.id), ext: ext.id, id: x.id, extensions: x.extensions, ready: false })));
  for (const p of c.panels ?? []) {
    // A `hidden` panel waits until the extension or the user opens it
    declarePanel(ext.id, p.id, !!p.hidden);
    off(add(panels, labelled(host, p.label, { key: keyOf(ext.id, p.id), ext: ext.id, id: p.id, dock: p.dock, page: p.page, width: p.width, height: p.height, minWidth: p.minWidth, minHeight: p.minHeight, detachable: p.detachable === true })));
  }
  for (const w of c.widgets ?? []) off(add(widgets, { key: keyOf(ext.id, w.id), ext: ext.id, id: w.id, slot: w.slot, page: w.page }));
}

/** The worker registered (or dropped) a callback: commands outside the manifest get a plain entry, lists flip `ready` */
export function callbackChanged(host: ExtensionHost, kind: 'command' | 'filter' | 'importer' | 'exporter', id: string, ready: boolean) {
  const key = keyOf(host.id, id);
  if (kind === 'filter') setReady(filters, key, ready);
  else if (kind === 'importer') setReady(importers, key, ready);
  else if (kind === 'exporter') setReady(exporters, key, ready);
}

const hostOf = (key: string) => {
  const ext = key.slice(0, key.indexOf(':'));
  const host = hosts.get(ext);
  if (!host) throw new Error(`${ext} is not running`);
  return { host, id: key.slice(ext.length + 1) };
};

/** Runs an extension filter on pixels (the caller applies the result as one undo step) */
export function runFilter(key: string, pixels: PixelData, values: FormValues) {
  const { host, id } = hostOf(key);
  return host.invoke<PixelData>('filter', id, pixels, values);
}

export async function runImporter(key: string, file: File) {
  const { host, id } = hostOf(key);
  await host.invoke('importer', id, { name: file.name, data: await file.arrayBuffer() });
}

/** Exports the active document with an extension exporter and downloads the result */
export async function runExporter(key: string) {
  const { host, id } = hostOf(key);
  const out = await host.invoke<{ name: string; data: ArrayBuffer; }>('exporter', id, snapshot(state.sprite));
  if (!out || typeof out.name !== 'string' || !(out.data instanceof ArrayBuffer)) throw new Error(`${host.name}: exporter returned no file`);
  download(new Blob([out.data]), out.name);
}

/** Importer that handles a file extension (`ase`), if any */
export const importerFor = (fileName: string) => {
  const dot = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return importers.peek().find(i => i.ready && i.extensions.some(e => e.toLowerCase() === dot)) ?? null;
};

const validators = new Map<string, { host: ExtensionHost; id: string; }>();
let validateTimer = 0;
let validateRun = 0;

export function addValidator(host: ExtensionHost, id: string) {
  const key = keyOf(host.id, id);
  validators.set(key, { host, id });
  scheduleValidation();
  return () => {
    if (validators.get(key)?.host !== host) return;
    validators.delete(key);
    problems.value = problems.peek().filter(p => !(p.ext === host.id && p.validator === id));
  };
}

export async function validateNow() {
  const run = ++validateRun;
  if (state.home || !validators.size) { problems.value = []; return; }
  const snap: SpriteSnapshot = snapshot(state.sprite);
  const found = await Promise.all([...validators.values()].map(async ({ host, id }) => {
    try {
      const list = await host.invoke<Problem[]>('validator', id, snap);
      return (Array.isArray(list) ? list : []).filter(p => p && typeof p.message === 'string').slice(0, 500).map(p => ({
        severity: (['error', 'warning', 'info'] as const).includes(p.severity) ? p.severity : 'warning',
        message: String(p.message), at: p.at, ext: host.id, validator: id,
      } satisfies ProblemEntry));
    } catch (e) {
      console.error(`[ext ${host.id}] validator ${id}`, e);
      return [];
    }
  }));
  if (run === validateRun) problems.value = found.flat();
}

function scheduleValidation() {
  clearTimeout(validateTimer);
  validateTimer = window.setTimeout(() => void validateNow(), 400);
}

/** Validators re-run a moment after the document changes */
export function installValidation() {
  return effect(() => {
    void state.sprite.version;
    void state.home;
    if (validators.size) scheduleValidation();
  });
}

function pointerInfo(p: ToolPointer, name: string): PointerInfo {
  return {
    x: p.x, y: p.y, button: p.secondary ? 2 : 0, pressure: pen.active ? pen.pressure : 1,
    shift: p.shift, ctrl: p.ctrl, alt: p.alt,
    layer: state.sprite.layer, frame: state.sprite.frame,
    options: { ...toolOptions.peek()[name] },
  };
}

/**
 * A stroke of an extension tool: pointer steps go to the worker in order (moves coalesced),
 * its sprite writes join one undo step, Escape rolls the stroke back.
 */
function toolSession(host: ExtensionHost, id: string, name: string, rawLabel: string, p: ToolPointer): Session | null {
  if (!host.callbacks.has(`tool:${id}`) || host.stroke) return null;
  const doc = state.sprite;
  const stroke = host.stroke = { doc, guard: doc.protectHistory(), label: host.label(rawLabel), started: false };
  let chain: Promise<unknown> = Promise.resolve();
  let nextMove: PointerInfo | null = null;
  let pumping = false;
  const report = (e: unknown) => console.error(`[ext ${host.id}] tool ${id}`, e);
  const send = (phase: string, info?: PointerInfo) => chain = chain.then(() => host.invoke('tool', id, phase, info)).catch(report);
  const end = () => {
    if (host.stroke === stroke) host.stroke = null;
    if (toolOverlay.peek()?.ext === host.id) toolOverlay.value = null;
  };
  stroke.guard.onRelease = end;
  send('down', pointerInfo(p, name));
  return {
    move(q) {
      nextMove = pointerInfo(q, name);
      if (pumping) return;
      pumping = true;
      chain = chain.then(async () => {
        while (nextMove) { const m = nextMove; nextMove = null; await host.invoke('tool', id, 'move', m).catch(report); }
        pumping = false;
      });
    },
    up(q) {
      const info = pointerInfo(q, name);
      chain = chain.then(() => { nextMove = null; });
      void send('up', info).then(() => { stroke.guard.commit(); if (stroke.started) state.save(); });
      return true;
    },
    cancel() {
      nextMove = null;
      void send('cancel').then(() => stroke.guard.cancel());
    },
  };
}
