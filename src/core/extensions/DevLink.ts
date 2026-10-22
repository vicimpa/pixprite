/**
 * The link to extension dev servers (`bun run ext:dev`, or the editor's own in development). While an extension loaded from one is
 * installed, the editor listens to the server's events: a rebuild reloads the extension (its open
 * panels come back with it), a failed build is shown. What the extension prints or throws is sent
 * back to the server, which prints it in its terminal.
 */

import { effect } from "@preact/signals-react";
import { state } from "~/core/State";
import { fetchRegistry, installed, installFromRegistry, reloadDev, type InstalledExtension } from "./Registry";

export type LogEntry = { level: 'error' | 'warn' | 'info'; message: string; stack?: string; source: string; };

/** Shows an extension's message in the console and, for a dev extension, in its server's terminal */
export function report(ext: InstalledExtension, entry: LogEntry) {
  const log = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.info;
  log(`[ext ${ext.id}] ${entry.source}:`, entry.message, entry.stack ? `\n${entry.stack}` : '');
  if (ext.source !== 'dev' || !ext.url) return;
  // text/plain needs no preflight; the server reads it as JSON
  void fetch(new URL('/__log', ext.url), { method: 'POST', body: JSON.stringify({ id: ext.id, ...entry }), headers: { 'Content-Type': 'text/plain' } })
    .catch(() => { /* the server is down: the console still has it */ });
}

const sources = new Map<string, EventSource>();

/**
 * In the editor's own dev server the built-in catalog is the `extensions/` folder: Vite says when
 * one changes, and a copy installed from there is installed again (without a version bump).
 */
function followLocalCatalog() {
  import.meta.hot?.on('pixprite:extensions', async ({ ids }: { ids: string[]; }) => {
    const local = new URL('./extensions/', document.baseURI).href;
    const mine = installed.peek().filter(e => ids.includes(e.id) && e.source === 'registry' && e.url?.startsWith(local));
    if (!mine.length) return;
    const rows = await fetchRegistry(`${local}registry.json`).catch(() => []);
    for (const ext of mine) {
      const row = rows.find(r => r.id === ext.id);
      if (!row) { console.warn(`[ext ${ext.id}] left the catalog (its checks fail?): kept as installed`); continue; }
      await installFromRegistry(row).then(
        () => console.info(`[ext ${ext.id}] reinstalled from extensions/`),
        err => report(ext, { level: 'error', message: String(err?.message ?? err), source: 'reload' }));
    }
  });
}

/** Keeps one event stream per dev server that has installed extensions */
export function installDevLink() {
  if (import.meta.env.DEV) followLocalCatalog();
  effect(() => {
    const origins = new Set(installed.value.filter(e => e.source === 'dev' && e.url).map(e => new URL(e.url!).origin));
    for (const [origin, es] of sources) if (!origins.has(origin)) { es.close(); sources.delete(origin); }
    for (const origin of origins) if (!sources.has(origin)) sources.set(origin, listen(origin));
  });
}

function listen(origin: string) {
  const es = new EventSource(`${origin}/__events`);
  const fromHere = (id: string) => installed.peek().find(e => e.id === id && e.source === 'dev' && e.url && new URL(e.url).origin === origin);
  es.addEventListener('reload', e => {
    const { ids } = JSON.parse((e as MessageEvent).data) as { ids: string[]; };
    for (const id of ids) {
      const ext = fromHere(id);
      if (ext) reloadDev(id).then(() => console.info(`[ext ${id}] reloaded`), err => report(ext, { level: 'error', message: String(err?.message ?? err), source: 'reload' }));
    }
  });
  es.addEventListener('build-error', e => {
    const { id, message } = JSON.parse((e as MessageEvent).data) as { id: string; message: string; };
    if (!fromHere(id)) return;
    console.error(`[ext ${id}] build failed\n${message}`);
    state.showTip(`${id}: build failed — ${message.split('\n')[0]}`, 6000);
  });
  return es;
}
