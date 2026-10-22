/**
 * Host side of one running extension: its worker, the iframes of its panels / widgets,
 * RPC dispatch with permission checks, and everything to undo when it stops.
 *
 * The worker is started inside a hidden sandboxed iframe (no same-origin), so it gets an opaque origin
 * and can't reach the editor's storage; the iframe only relays messages over a MessagePort.
 */
import { signal } from "@preact/signals-react";
import { createTranslator, type Translator } from "~/core/i18n";
import type { Sprite } from "~/core/Sprite";
import { fail, HostError, isObject, type Call, type Handlers } from "./api/common";
import { eventHandlers } from "./api/events";
import { runtimeHandlers } from "./api/runtime";
import { spriteHandlers } from "./api/sprite";
import { uiHandlers } from "./api/ui";
import type { Manifest } from "./manifest";
import {
  I18N_CHANGE, INVOKE, isMethod, missingPermission, transferables,
  type CallbackKind, type ErrorInfo, type RequestMessage, type WireMessage,
} from "./protocol";
import { BOOT_END, BOOT_START, compile, LINKER, sourceOf } from "./compile";
import { report } from "./DevLink";
import { readFile, type InstalledExtension } from "./Registry";
import { API_VERSION } from "@pixprite/api";

const HANDLERS: Handlers = { ...spriteHandlers, ...uiHandlers, ...runtimeHandlers, ...eventHandlers };

/** How long `activate` may take, and a callback (tool step, filter…) may run */
const ACTIVATE_MS = 10_000;
const INVOKE_MS = 60_000;

/** A worker or an iframe of the extension; `subs` are its event subscriptions */
export type Endpoint = {
  role: 'worker' | 'panel' | 'widget';
  contribution?: string;
  post(msg: WireMessage): void;
  subs: Map<string, () => void>;
};

export type HostStatus = 'starting' | 'running' | 'failed' | 'stopped';

// The relay inside the sandboxed iframe: starts the module worker from the code it is sent
// and passes messages both ways, moving buffers instead of copying them.
const RELAY = `<!doctype html><meta charset="utf-8"><script>${LINKER}
const tr = (v, out = [], seen = new Set()) => {
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (v instanceof ArrayBuffer) out.push(v);
  else if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer && !seen.has(v.buffer)) { seen.add(v.buffer); out.push(v.buffer); } }
  else if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) out.push(v);
  else if (Array.isArray(v)) v.forEach(x => tr(x, out, seen));
  else if (Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach(x => tr(x, out, seen));
  return out;
};
let port = null;
addEventListener('message', e => {
  if (e.source !== parent || port || !e.ports[0]) return;
  port = e.ports[0];
  let w;
  // Chrome refuses module workers in an opaque-origin frame, so a classic worker imports the module
  // The extension's modules, compiled by the editor, are linked here: blob urls must be of this frame's origin
  const mod = __pxLink(e.data.modules);
  // The worker keeps messages that arrive while its modules load (see __pxQueue in compile.ts)
  const boot = ${JSON.stringify(BOOT_START)} + JSON.stringify(mod) + ${JSON.stringify(BOOT_END)};
  try {
    w = new Worker(URL.createObjectURL(new Blob([boot], { type: 'text/javascript' })), { name: e.data.name });
  } catch (err) { port.postMessage({ type: 'failed', error: String(err) }); return; }
  w.onmessage = m => port.postMessage(m.data, tr(m.data));
  w.onerror = ev => { ev.preventDefault(); port.postMessage({ type: 'failed', error: ev.message || 'Worker error' }); };
  w.onmessageerror = () => port.postMessage({ type: 'failed', error: 'Message could not be read' });
  port.onmessage = m => w.postMessage(m.data, tr(m.data));
});
</script>`;

export class ExtensionHost {
  readonly id: string;
  readonly manifest: Manifest;
  readonly permissions: readonly string[];
  readonly translator: Translator;
  readonly status = signal<HostStatus>('starting');
  readonly error = signal<string | null>(null);

  /** Methods of the worker's `activate` return value, callable by other extensions */
  exports: string[] = [];
  /** Callbacks the worker registered, as `<kind>:<id>` */
  readonly callbacks = new Set<string>();
  readonly transactions = new Map<number, { doc: Sprite; depth: number; }>();
  /** A tool stroke of this extension in progress: its writes join one undo step */
  stroke: { doc: Sprite; depth: number; label: string; started: boolean; } | null = null;

  private worker: Endpoint | null = null;
  private frame: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private readonly frames = new Set<Endpoint>();
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; timer: number; }>();
  private readonly disposers: (() => void)[] = [];
  private seq = 0;
  private nextTx = 1;
  private activation: { resolve(): void; reject(e: Error): void; } | null = null;

  constructor(readonly ext: InstalledExtension) {
    this.id = ext.id;
    this.manifest = ext.manifest;
    this.permissions = ext.manifest.permissions ?? [];
    this.translator = createTranslator(ext.id);
  }

  /** The extension's name in the interface language */
  get name() { return this.label(this.manifest.name); }

  /** Manifest text with `%key%` resolved against the extension's locale */
  label(raw: string) {
    return raw.replace(/%([\w.-]+)%/g, (_, key: string) => this.translator.t(key));
  }

  /** The extension's own texts, prefix removed, fallbacks applied */
  strings() { return this.translator.snapshot().strings; }

  onDispose(fn: () => void) { this.disposers.push(fn); }

  can(permission: string) { return this.permissions.includes(permission); }

  private init(role: Endpoint['role'], contribution?: string): WireMessage {
    const snap = this.translator.snapshot();
    return { type: 'init', id: this.id, version: this.manifest.version, apiVersion: API_VERSION, role, contribution, ...snap };
  }

  /** Starts the worker (when the manifest has an `entry`) and waits for `activate` */
  async start() {
    const texts = () => this.broadcast(I18N_CHANGE, (({ lang, dir, strings, core }) => ({ lang, dir, strings, core }))(this.translator.snapshot()));
    this.disposers.push(this.translator.on('change', texts));
    // Panels may have connected while the texts were still loading
    texts();
    if (!this.manifest.entry) { this.status.value = 'running'; return; }
    try {
      const code = await this.entryCode(this.manifest.entry);
      await this.spawn(code.modules);
      this.status.value = 'running';
    } catch (e) {
      this.error.value = e instanceof Error ? e.message : String(e);
      this.status.value = 'failed';
      report(this.ext, { level: 'error', message: `failed to start: ${this.error.value}`, stack: e instanceof Error ? e.stack : undefined, source: 'worker' });
      this.dispose('failed');
    }
  }

  /** The entry compiled from the package's sources (dev extensions: as their server has them now) */
  private async entryCode(entry: string) {
    const read = async (path: string) => (await readFile(this.ext, path))?.text() ?? null;
    const source = await sourceOf(read, entry);
    if (!source) throw new Error(`Entry "${entry}" has no source in the package`);
    return compile(read, source);
  }

  private spawn(modules: string[]) {
    const frame = this.frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    frame.srcdoc = RELAY;
    const channel = new MessageChannel();
    this.port = channel.port1;
    const ep: Endpoint = {
      role: 'worker',
      post: msg => this.port?.postMessage(msg, transferables(msg)),
      subs: new Map(),
    };
    this.worker = ep;
    this.port.onmessage = e => void this.receive(ep, e.data);

    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('activate() timed out')), ACTIVATE_MS);
      this.activation = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: e => { clearTimeout(timer); reject(e); },
      };
      frame.onload = () => {
        frame.contentWindow?.postMessage({ modules, name: this.id }, '*', [channel.port2]);
        ep.post(this.init('worker'));
      };
      document.body.appendChild(frame);
    });
  }

  /**
   * Connects a panel / widget iframe the interface created (sandbox="allow-scripts").
   * Sends `init` once it has loaded; returns the function that disconnects it.
   */
  connectFrame(iframe: HTMLIFrameElement, role: 'panel' | 'widget', contribution: string) {
    const ep: Endpoint = {
      role, contribution,
      post: msg => iframe.contentWindow?.postMessage(msg, '*', transferables(msg)),
      subs: new Map(),
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source && e.source === iframe.contentWindow) void this.receive(ep, e.data);
    };
    const onLoad = () => {
      for (const off of ep.subs.values()) off();
      ep.subs.clear();
      ep.post(this.init(role, contribution));
    };
    window.addEventListener('message', onMessage);
    iframe.addEventListener('load', onLoad);
    this.frames.add(ep);
    const off = () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', onLoad);
      for (const unsub of ep.subs.values()) unsub();
      ep.subs.clear();
      this.frames.delete(ep);
    };
    this.disposers.push(off);
    return off;
  }

  /** Sends an event to every endpoint subscribed to it (`i18n:change` goes to all) */
  broadcast(event: string, data: unknown) {
    for (const ep of this.endpoints()) if (event === I18N_CHANGE || ep.subs.has(event)) ep.post({ type: 'event', event, data });
  }

  private *endpoints() {
    if (this.worker) yield this.worker;
    yield* this.frames;
  }

  /** Calls a callback the worker registered (`invoke [kind, id, ...args]`) */
  invoke<T = unknown>(kind: CallbackKind, id: string, ...args: unknown[]): Promise<T> {
    const ep = this.worker;
    if (!ep || this.status.peek() !== 'running') return Promise.reject(new HostError('not-found', `${this.id} is not running`));
    if (kind !== 'export' && !this.callbacks.has(`${kind}:${id}`)) return Promise.reject(new HostError('not-found', `${this.id} has no ${kind} "${id}"`));
    const reqId = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new HostError('internal', `${this.id}: ${kind} "${id}" timed out`));
      }, INVOKE_MS);
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
      ep.post({ type: 'request', id: reqId, method: INVOKE, params: [kind, id, ...args] });
    });
  }

  beginTransaction(doc: Sprite, depth: number) {
    const id = this.nextTx++;
    this.transactions.set(id, { doc, depth });
    return id;
  }

  private async receive(ep: Endpoint, msg: unknown) {
    if (!isObject(msg)) return;
    switch (msg.type) {
      case 'activated':
        if (ep === this.worker) {
          this.exports = Array.isArray(msg.exports) ? msg.exports.filter((x): x is string => typeof x === 'string') : [];
          this.activation?.resolve();
          this.activation = null;
        }
        break;
      case 'failed':
        if (ep === this.worker) {
          const err = new Error(String(msg.error ?? 'activate() failed'));
          if (this.activation) { this.activation.reject(err); this.activation = null; }
          else {
            this.error.value = err.message;
            this.status.value = 'failed';
            console.error(`[ext ${this.id}]`, err.message);
          }
        }
        break;
      case 'log': {
        const level = msg.level === 'warn' || msg.level === 'info' ? msg.level : 'error';
        report(this.ext, { level, message: String(msg.message ?? ''), stack: typeof msg.stack === 'string' ? msg.stack : undefined, source: ep.contribution ? `${ep.role} ${ep.contribution}` : ep.role });
        break;
      }
      case 'response': {
        if (ep !== this.worker || typeof msg.id !== 'number') break;
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (isObject(msg.error)) p.reject(new HostError((msg.error.code as ErrorInfo['code']) ?? 'internal', String(msg.error.message)));
        else p.resolve(msg.result);
        break;
      }
      case 'request':
        await this.handle(ep, msg as RequestMessage);
        break;
    }
  }

  private async handle(ep: Endpoint, msg: RequestMessage) {
    if (typeof msg.id !== 'number') return;
    try {
      if (typeof msg.method !== 'string' || !Array.isArray(msg.params)) fail('invalid', 'Malformed request');
      if (!isMethod(msg.method)) fail('not-found', `Unknown method ${msg.method}`);
      const method = msg.method as keyof Handlers & string;
      const missing = missingPermission(method, this.permissions, method === 'net.fetch' ? String(msg.params[0]) : undefined);
      if (missing) fail('permission', `Permission "${missing}" is not granted`);
      const handler = HANDLERS[method as keyof Handlers];
      if (!handler) fail('not-found', `${method} is not available`);
      const call: Call = { host: this, endpoint: ep, tx: typeof msg.tx === 'number' ? msg.tx : undefined };
      const result = await handler!(call, ...msg.params);
      ep.post({ type: 'response', id: msg.id, result });
    } catch (e) {
      const code = e instanceof HostError ? e.code : 'internal';
      if (code === 'internal') console.error(`[ext ${this.id}] ${msg.method}`, e);
      ep.post({ type: 'response', id: msg.id, error: { message: e instanceof Error ? e.message : String(e), code } });
    }
  }

  /** Stops the worker, closes open transactions and undoes every registration */
  dispose(status: HostStatus = 'stopped') {
    if (this.status.peek() === 'stopped') return;
    for (const t of this.transactions.values()) t.doc.rollback(t.depth);
    this.transactions.clear();
    this.stroke = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new HostError('cancelled', `${this.id} stopped`)); }
    this.pending.clear();
    this.activation?.reject(new Error('stopped'));
    this.activation = null;
    for (const ep of this.endpoints()) { for (const off of ep.subs.values()) off(); ep.subs.clear(); }
    for (const fn of this.disposers.splice(0).reverse()) {
      try { fn(); } catch (e) { console.error(e); }
    }
    this.callbacks.clear();
    this.port?.close();
    this.port = null;
    this.frame?.remove();
    this.frame = null;
    this.worker = null;
    this.frames.clear();
    if (status !== 'failed' || this.status.peek() !== 'failed') this.status.value = status;
  }
}
