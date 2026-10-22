/**
 * Extension-side runtime: runs inside the extension worker or a panel iframe,
 * talks to the editor over postMessage and builds the `ctx` object.
 */
import type { ActivateFn, ExtensionContext, ExtensionHandle, Transaction } from "./context";
import type { FormValues, PixelData, PointerInfo, SpriteSnapshot, ToolHandlers, Unsubscribe } from "./types";
import {
  DOCUMENTS_CHANGE, I18N_CHANGE, INVOKE, statePrefix, transferables,
  type CallbackKind, type ErrorInfo, type I18nChange, type InitMessage, type RequestMessage, type WireMessage,
} from "./wire";

/** Rejection of a ctx call; `code` tells why */
export class ExtensionError extends Error {
  code?: ErrorInfo['code'];
  constructor(info: ErrorInfo) { super(info.message); this.code = info.code; }
}

type Port = { post(msg: WireMessage, transfer: Transferable[]): void; listen(cb: (msg: WireMessage) => void): void; };

/** Messages the page kept while this code was loading (set up by the editor before it runs the extension) */
function drainQueue(take: (e: MessageEvent) => void) {
  const q = (self as { __pxQueue?: { items: MessageEvent[]; h: (e: MessageEvent) => void; }; }).__pxQueue;
  if (!q) return;
  delete (self as { __pxQueue?: unknown; }).__pxQueue;
  self.removeEventListener('message', q.h as EventListener);
  q.items.forEach(take);
}

const workerPort = (): Port => ({
  post: (msg, transfer) => (self as unknown as Worker).postMessage(msg, transfer),
  listen: cb => {
    const take = (e: MessageEvent) => cb(e.data);
    drainQueue(take);
    self.addEventListener('message', e => take(e as MessageEvent));
  },
});

/** Iframes are sandboxed without same-origin: the parent's origin is opaque to us, so '*' it is */
const parentPort = (): Port => ({
  post: (msg, transfer) => window.parent.postMessage(msg, '*', transfer),
  listen: cb => {
    const take = (e: MessageEvent) => { if (e.source === window.parent) cb(e.data); };
    drainQueue(take);
    window.addEventListener('message', take);
  },
});

type Callback = (...args: any[]) => unknown;

class Connection {
  private seq = 0;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; }>();
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private callbacks = new Map<string, Callback>();
  exports: Record<string, Callback> = {};
  init!: InitMessage;
  ready: Promise<InitMessage>;

  constructor(private port: Port) {
    let resolveInit!: (m: InitMessage) => void;
    this.ready = new Promise(r => resolveInit = r);
    port.listen(msg => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'init': this.init = msg; resolveInit(msg); break;
        case 'response': {
          const p = this.pending.get(msg.id);
          if (!p) break;
          this.pending.delete(msg.id);
          if ('error' in msg) p.reject(new ExtensionError(msg.error));
          else p.resolve(msg.result);
          break;
        }
        case 'event': {
          // Texts can change before `init` arrives (the editor is still loading dictionaries): init carries them anyway
          if (msg.event === I18N_CHANGE) { if (!this.init) break; Object.assign(this.init, msg.data as I18nChange); }
          for (const cb of this.listeners.get(msg.event) ?? []) {
            try { cb(msg.data); } catch (e) { console.error(e); }
          }
          break;
        }
        case 'request': this.answer(msg); break;
      }
    });
  }

  post(msg: WireMessage) { this.port.post(msg, transferables(msg)); }

  call<T = unknown>(method: string, params: unknown[] = [], tx?: number): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'request', id, method, params, tx });
    });
  }

  /** Subscribes to a host event; the host is told about the first and last listener */
  on(event: string, cb: (data: any) => void): Unsubscribe {
    let set = this.listeners.get(event);
    // Text changes reach every page anyway: there is nothing to subscribe to
    const broadcast = event === I18N_CHANGE;
    if (!set) {
      this.listeners.set(event, set = new Set());
      if (!broadcast) this.call('events.subscribe', [event]).catch(console.error);
    }
    set.add(cb);
    return () => {
      if (!set.delete(cb) || set.size) return;
      this.listeners.delete(event);
      if (!broadcast) this.call('events.unsubscribe', [event]).catch(() => { });
    };
  }

  /** Registers a local callback and tells the host via `method` */
  register(kind: CallbackKind, method: string, id: string, fn: Callback): Unsubscribe {
    this.callbacks.set(`${kind}:${id}`, fn);
    this.call(method, [id]).catch(console.error);
    return () => {
      if (this.callbacks.get(`${kind}:${id}`) !== fn) return;
      this.callbacks.delete(`${kind}:${id}`);
      this.call(method.replace(/register\w*$/, 'unregister'), [id]).catch(() => { });
    };
  }

  private async answer(msg: RequestMessage) {
    try {
      if (msg.method !== INVOKE) throw new ExtensionError({ message: `Unknown method ${msg.method}`, code: 'not-found' });
      const [kind, id, ...args] = msg.params as [CallbackKind, string, ...unknown[]];
      const fn = kind === 'export' ? this.exports[id] : this.callbacks.get(`${kind}:${id}`);
      if (!fn) throw new ExtensionError({ message: `No ${kind} "${id}"`, code: 'not-found' });
      this.post({ type: 'response', id: msg.id, result: await fn(...args) });
    } catch (e) {
      const err = e instanceof ExtensionError ? e : null;
      this.post({ type: 'response', id: msg.id, error: { message: e instanceof Error ? e.message : String(e), code: err?.code ?? 'internal' } });
    }
  }
}

/** `{name}` placeholders, plural forms `key.one/.few/.many/.other` picked by `vars.count` */
function translate(dict: Record<string, string>, lang: string, key: string, vars?: Record<string, string | number>) {
  let out: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const form = new Intl.PluralRules(lang).select(vars.count);
    out = dict[`${key}.${form}`] ?? dict[`${key}.other`];
  }
  out ??= dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

function makeSprite(c: Connection, tx?: number): Transaction {
  const call = (m: string) => (...a: unknown[]) => c.call<any>(`sprite.${m}`, a, tx);
  return {
    get: call('get') as () => Promise<SpriteSnapshot>,
    getPixels: call('getPixels') as Transaction['getPixels'],
    putPixels: call('putPixels') as Transaction['putPixels'],
    render: call('render') as Transaction['render'],
    async transaction(label, fn) {
      if (tx !== undefined) return fn(makeSprite(c, tx)); // nested: join the outer step
      const id = await c.call<number>('sprite.transaction.begin', [label]);
      try {
        const out = await fn(makeSprite(c, id));
        await c.call('sprite.transaction.end', [id, true]);
        return out;
      } catch (e) {
        await c.call('sprite.transaction.end', [id, false]).catch(() => { });
        throw e;
      }
    },
    layers: { add: call('layers.add'), remove: call('layers.remove'), update: call('layers.update'), move: call('layers.move') },
    frames: { add: call('frames.add'), remove: call('frames.remove'), setDuration: call('frames.setDuration'), move: call('frames.move') },
    tags: { add: call('tags.add'), remove: call('tags.remove'), update: call('tags.update') },
    slices: { add: call('slices.add'), remove: call('slices.remove'), update: call('slices.update') },
    selection: { get: call('selection.get'), set: call('selection.set') },
  };
}

function makeContext(c: Connection): ExtensionContext {
  const init = c.init;
  const fns = <T extends Record<string, unknown>>(ns: string, names: (keyof T & string)[]) =>
    Object.fromEntries(names.map(n => [n, (...a: unknown[]) => c.call(`${ns}.${n}`, a)])) as any;

  return {
    id: init.id,
    apiVersion: init.apiVersion,
    sprite: makeSprite(c),
    documents: {
      ...fns('documents', ['list', 'active', 'open', 'create']),
      on: (_e: 'change', cb) => c.on(DOCUMENTS_CHANGE, cb),
    },
    events: { on: (event, cb) => c.on(event, cb) },
    commands: {
      register: (id, run) => c.register('command', 'commands.register', id, run),
      run: (id, ...args) => c.call('commands.run', [id, ...args]),
      list: () => c.call('commands.list'),
    },
    tools: {
      register(id, h: ToolHandlers) {
        return c.register('tool', 'tools.register', id, (phase: string, e?: PointerInfo) => {
          if (phase === 'down') return h.onDown?.(e!);
          if (phase === 'move') return h.onMove?.(e!);
          if (phase === 'up') return h.onUp?.(e!);
          return h.onCancel?.();
        });
      },
      overlay: pixels => c.call('tools.overlay', [pixels]),
    },
    filters: {
      register: (id, apply: (p: PixelData, o: FormValues) => unknown) => c.register('filter', 'filters.register', id, apply),
    },
    io: {
      registerImporter: (id, read) => c.register('importer', 'io.registerImporter', id, read),
      registerExporter: (id, write) => c.register('exporter', 'io.registerExporter', id, write),
    },
    ui: {
      ...fns('ui', ['notify', 'confirm', 'prompt', 'pickColor', 'pickFile', 'showForm']),
      panels: {
        show: id => c.call('ui.panels.show', [id]),
        hide: id => c.call('ui.panels.hide', [id]),
      },
      async progress(label) {
        const id = await c.call<number>('ui.progress', [label]);
        return {
          update: (v: number) => c.call<void>('ui.progress.update', [id, v]),
          done: () => c.call<void>('ui.progress.done', [id]),
        };
      },
    },
    view: fns('view', ['zoom', 'setZoom', 'pan', 'setPan', 'toScreen', 'toSprite']),
    state: {
      get: key => c.call('state.get', [key]),
      set: (key, value) => c.call('state.set', [key, value]),
      on: (key, cb) => c.on(statePrefix + key, cb),
    },
    playback: fns('playback', ['play', 'stop', 'seek']),
    meta: fns('meta', ['get', 'set', 'delete']),
    storage: fns('storage', ['get', 'set', 'delete', 'keys']),
    locks: fns('locks', ['get', 'set', 'clear']),
    validators: {
      register: (id, fn) => c.register('validator', 'validators.register', id, fn),
    },
    i18n: {
      t: (key, vars) => translate(init.strings, init.lang, key, vars),
      core: (key, vars) => translate(init.core, init.lang, key, vars),
      get lang() { return init.lang; },
      get dir() { return init.dir; },
      on: (_e: 'change', cb) => c.on(I18N_CHANGE, (d: I18nChange) => cb(d.lang)),
      number: (n, o) => new Intl.NumberFormat(init.lang, o).format(n),
      date: (d, o) => new Intl.DateTimeFormat(init.lang, o).format(d),
      list: (items, o) => new Intl.ListFormat(init.lang, o).format(items),
    },
    extensions: {
      async get<T>(id: string) {
        const info = await c.call<{ id: string; version: string; exports: string[]; } | null>('extensions.get', [id]);
        if (!info) return null;
        const api = Object.fromEntries(info.exports.map(m => [m, (...a: unknown[]) => c.call('extensions.call', [id, m, a])]));
        return { id: info.id, version: info.version, api } as ExtensionHandle<T>;
      },
    },
    net: { fetch: (url, init) => c.call('net.fetch', [url, init]) },
  };
}

let current: Connection | null = null;
const connection = (port: () => Port) => current ??= reportErrors(new Connection(port()));

/** Uncaught errors, rejected promises and console errors / warnings go to the editor as `log` messages */
function reportErrors(c: Connection) {
  const text = (v: unknown) => v instanceof Error ? v.message : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  const send = (level: 'error' | 'warn', args: unknown[]) => {
    const err = args.find((a): a is Error => a instanceof Error);
    try { c.post({ type: 'log', level, message: args.map(text).join(' '), stack: err?.stack }); } catch { /* the editor is gone */ }
  };
  addEventListener('error', e => send('error', [(e as ErrorEvent).error ?? (e as ErrorEvent).message]));
  addEventListener('unhandledrejection', e => send('error', [(e as PromiseRejectionEvent).reason]));
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => { orig(...args); send(level, args); };
  }
  return c;
}

/**
 * Entry point of an extension worker:
 * ```ts
 * export default defineExtension(ctx => { ctx.commands.register('hello', () => ctx.ui.notify('Hi')); });
 * ```
 * Starts as soon as the module loads; the return value of `activate` becomes the api for other extensions.
 */
export function defineExtension(activate: ActivateFn): ActivateFn {
  const c = connection(workerPort);
  c.ready.then(async () => {
    try {
      const out = await activate(makeContext(c));
      c.exports = out ?? {};
      c.post({ type: 'activated', exports: Object.keys(c.exports) });
    } catch (e) {
      c.post({ type: 'failed', error: e instanceof Error ? e.stack ?? e.message : String(e) });
    }
  });
  return activate;
}

/** Panel / widget iframe: resolves with the same `ctx` once the editor has sent `init` */
export async function connect(): Promise<ExtensionContext & { role: InitMessage['role']; contribution?: string; }> {
  const c = connection(parentPort);
  const init = await c.ready;
  c.post({ type: 'activated', exports: [] });
  return Object.assign(makeContext(c), { role: init.role, contribution: init.contribution });
}
