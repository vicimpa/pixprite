/**
 * Registrations (commands, tools, filters, importers / exporters, validators), inter-extension calls,
 * per-extension storage and gated network access.
 */
import type { FormValues } from "@pixprite/api";
import { commands, commandLabel, commandSchema, runCommand, available, COMMANDS } from "~/core/Commands";
import { state } from "~/core/State";
import { idb, STORAGE } from "../idb";
import { addCommand, addValidator, callbackChanged, commandId, keyOf, toolOverlay } from "../Contributions";

/** What a core command asks of an extension that runs it: viewing is free, changing the document needs sprite:write */
/** `ext:command` is declared public in its extension's manifest */
function isPublic(full: string) {
  const sep = full.indexOf(':');
  const host = hosts.get(full.slice(0, sep));
  return !!host?.manifest.contributes?.commands?.some(cmd => cmd.id === full.slice(sep + 1) && cmd.public);
}

function corePermissions(id: string): string[] {
  const group = id.slice(0, id.indexOf('.'));
  if (group === 'view' || group === 'window' || group === 'help') return [];
  if (group === 'extensions') return ['never'];
  if (id === 'edit.copy') return ['sprite:read', 'clipboard'];
  if (id === 'edit.cut' || id === 'edit.paste' || id.startsWith('edit.paste')) return ['sprite:write', 'clipboard'];
  if (group === 'file') return ['sprite:read'];
  return ['sprite:write'];
}
import { fail, hosts, isObject, type Call, type Handlers } from "./common";

type Kind = 'command' | 'tool' | 'filter' | 'importer' | 'exporter' | 'validator';

const checkId = (id: unknown) => typeof id === 'string' && /^[\w.-]{1,64}$/.test(id) ? id : fail('invalid', 'id must be 1..64 of [A-Za-z0-9_.-]');

/** Disposers of what each callback registration added, by `<kind>:<id>` per extension */
const extras = new WeakMap<object, Map<string, () => void>>();

function register(c: Call, kind: Kind, rawId: unknown, extra?: (id: string) => (() => void) | void) {
  if (c.endpoint.role !== 'worker') fail('invalid', 'Callbacks can only be registered from the worker');
  const id = checkId(rawId);
  const key = `${kind}:${id}`;
  const host = c.host;
  let map = extras.get(host);
  if (!map) {
    extras.set(host, map = new Map());
    host.onDispose(() => { for (const off of map!.values()) off(); map!.clear(); });
  }
  map.get(key)?.();
  map.delete(key);
  host.callbacks.add(key);
  const off = extra?.(id);
  if (kind === 'filter' || kind === 'importer' || kind === 'exporter' || kind === 'command') callbackChanged(host, kind, id, true);
  map.set(key, () => {
    host.callbacks.delete(key);
    off?.();
    if (kind === 'filter' || kind === 'importer' || kind === 'exporter' || kind === 'command') callbackChanged(host, kind, id, false);
  });
}

function unregister(c: Call, kind: Kind, rawId: unknown) {
  const key = `${kind}:${String(rawId)}`;
  const map = extras.get(c.host);
  map?.get(key)?.();
  map?.delete(key);
}

/** Commands the manifest doesn't declare still get a palette entry (label = id) */
const declared = (c: Call, kind: 'commands' | 'tools' | 'filters' | 'importers' | 'exporters', id: string) =>
  !!c.host.manifest.contributes?.[kind]?.some(x => x.id === id);

const storageKey = (ext: string, key: unknown) => {
  if (typeof key !== 'string' || !key || key.length > 256) fail('invalid', 'key must be a non-empty string');
  return `${ext}\n${key}`;
};

const MAX_VALUE = 4 << 20;
const MAX_BODY = 32 << 20;

export const runtimeHandlers: Handlers = {
  'commands.register': (c, id) => register(c, 'command', id, id => declared(c, 'commands', id) ? undefined : addCommand(c.host, id)),
  'commands.unregister': (c, id) => unregister(c, 'command', id),
  'commands.run': async (c, id, ...args) => {
    if (typeof id !== 'string') fail('invalid', 'id must be a string');
    const full = commandId(c.host, id);
    const sep = full.indexOf(':');
    if (sep > 0 && !commands.has(full) && !hosts.get(full.slice(0, sep))?.callbacks.has(`command:${full.slice(sep + 1)}`)) fail('not-found', `Unknown command ${id}`);
    if (sep > 0) {
      const ext = full.slice(0, sep);
      const target = hosts.get(ext);
      if (!target) fail('not-found', `${ext} is not running`);
      // Another extension's command is its api only when it says so
      if (ext !== c.host.id && !isPublic(full)) fail('permission', `${id} is not a public command of ${ext}`);
      return target!.invoke('command', full.slice(sep + 1), ...args);
    }
    const cmd = commands.get(full) ?? fail('not-found', `Unknown command ${id}`);
    for (const need of corePermissions(full)) if (!c.host.can(need)) fail('permission', `${id} needs the "${need}" permission`);
    if (!available(cmd)) fail('invalid', `${id} is not available now`);
    if (args[0] !== undefined && !isObject(args[0])) fail('invalid', 'Arguments of a built-in command are an object');
    let out: unknown;
    try { out = await runCommand(full, args[0] as FormValues | undefined); } catch (e) { fail('invalid', e instanceof Error ? e.message : String(e)); }
    // Built-ins return nothing an extension could use beyond plain values
    return ['string', 'number', 'boolean'].includes(typeof out) ? out : null;
  },
  'commands.list': c => COMMANDS
    .filter(cmd => available(cmd) && (!cmd.ext || cmd.ext === c.host.id || isPublic(cmd.id)))
    .map(cmd => {
      const params = commandSchema(cmd);
      return { id: cmd.id, label: commandLabel(cmd), ...cmd.ext ? { ext: cmd.ext } : {}, ...params ? { params } : {} };
    }),

  'tools.register': (c, id) => {
    if (!declared(c, 'tools', checkId(id))) fail('not-found', `Tool "${id}" must be declared in contributes.tools`);
    register(c, 'tool', id);
  },
  'tools.unregister': (c, id) => {
    unregister(c, 'tool', id);
    if (state.tool === keyOf(c.host.id, String(id))) state.tool = 'pencil';
  },
  'tools.overlay': (c, pixels) => {
    if (pixels === null || pixels === undefined) {
      if (toolOverlay.peek()?.ext === c.host.id) toolOverlay.value = null;
      return;
    }
    if (!c.host.stroke) fail('invalid', 'The overlay can only be drawn during a stroke of the extension tool');
    if (!isObject(pixels) || !isObject(pixels.rect) || !(pixels.data instanceof Uint8ClampedArray) || pixels.format !== 'rgba') fail('invalid', 'overlay must be rgba PixelData');
    toolOverlay.value = { ext: c.host.id, pixels: pixels as never };
  },

  'filters.register': (c, id) => {
    if (!declared(c, 'filters', checkId(id))) fail('not-found', `Filter "${id}" must be declared in contributes.filters`);
    register(c, 'filter', id);
  },
  'filters.unregister': (c, id) => unregister(c, 'filter', id),

  'io.registerImporter': (c, id) => {
    if (!declared(c, 'importers', checkId(id))) fail('not-found', `Importer "${id}" must be declared in contributes.importers`);
    register(c, 'importer', id);
  },
  'io.registerExporter': (c, id) => {
    if (!declared(c, 'exporters', checkId(id))) fail('not-found', `Exporter "${id}" must be declared in contributes.exporters`);
    register(c, 'exporter', id);
  },
  // One unregister for both: the id is looked up as either
  'io.unregister': (c, id) => { unregister(c, 'importer', id); unregister(c, 'exporter', id); },

  'validators.register': (c, id) => register(c, 'validator', id, id => addValidator(c.host, id)),
  'validators.unregister': (c, id) => unregister(c, 'validator', id),

  'extensions.get': (_c, id) => {
    const h = typeof id === 'string' ? hosts.get(id) : undefined;
    return h && h.status.peek() === 'running' ? { id: h.id, version: h.manifest.version, exports: h.exports.slice() } : null;
  },
  'extensions.call': (c, id, method, args) => {
    const h = typeof id === 'string' ? hosts.get(id) : undefined;
    if (!h || h.status.peek() !== 'running') fail('not-found', `${id} is not running`);
    if (h === c.host) fail('invalid', 'Call your own functions directly');
    if (typeof method !== 'string' || !h!.exports.includes(method)) fail('not-found', `${id} exports no "${method}"`);
    return h!.invoke('export', method, ...(Array.isArray(args) ? args : []));
  },

  'storage.get': (c, key) => idb(STORAGE, 'readonly', s => s.get(storageKey(c.host.id, key))),
  'storage.set': async (c, key, value) => {
    const k = storageKey(c.host.id, key);
    // A rough size limit: the structured clone of a value is about its JSON size
    try { if (JSON.stringify(value)?.length > MAX_VALUE) fail('invalid', 'Value is too large'); } catch (e) { if (!(e instanceof TypeError)) throw e; }
    await idb(STORAGE, 'readwrite', s => s.put(value, k));
  },
  'storage.delete': (c, key) => idb(STORAGE, 'readwrite', s => s.delete(storageKey(c.host.id, key))).then(() => undefined),
  'storage.keys': async c => {
    const prefix = `${c.host.id}\n`;
    const keys = await idb(STORAGE, 'readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    return keys.map(k => String(k).slice(prefix.length));
  },

  'net.fetch': async (_c, url, init) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) fail('permission', 'Only https urls can be fetched');
    const o = isObject(init) ? init : {};
    const headers = isObject(o.headers) ? Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [k, String(v)])) : undefined;
    const body = typeof o.body === 'string' || o.body instanceof ArrayBuffer ? o.body : undefined;
    // No cookies or other credentials of the editor go along
    const r = await fetch(u, { method: typeof o.method === 'string' ? o.method : 'GET', headers, body, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    const data = await r.arrayBuffer();
    if (data.byteLength > MAX_BODY) fail('invalid', 'Response is too large');
    return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: data };
  },
};
