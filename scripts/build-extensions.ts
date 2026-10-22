/**
 * Extensions in `extensions/<id>/` are kept as source; the editor compiles them itself.
 *
 *   bun scripts/build-extensions.ts            check every extension (manifest, sources, locales, %key% references)
 *   bun scripts/build-extensions.ts --dev      serve the sources on :5174 for live development (see below)
 *   bun scripts/build-extensions.ts --json     print the catalog (registry.json) for tools
 *   bun scripts/build-extensions.ts --out <dir> [--base <url>]
 *                                              publish: the public extensions' sources and their registry.json
 *                                              into <dir> (package paths under <url> when given; CI pins them to a commit)
 *   … [ids…]                                   limit to these extensions
 *
 * Source layout of one extension:
 *   manifest.json        `entry: "main.js"` runs `src/main.ts`; a page `panel.html` is `src/panel.html`
 *                        (or a bare page that runs `src/panel.ts`)
 *   locales/<lang>.json  own strings, keys without the `ext.<id>.` prefix
 *   assets/              anything else the extension shows
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync, watch, writeFileSync } from "fs";
import { dirname, join } from "path";
import { buildIndex, extensionIds, listFiles, SRC } from "./extensions";

const DEV_PORT = 5174;
const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = option('--out');
const BASE = option('--base');
const only = args.filter((a, i) => !a.startsWith('--') && !['--out', '--base'].includes(args[i - 1]));

/** Checks the extensions and prints the result; the number that failed */
function report(ids: string[] = only) {
  const { registry, problems } = buildIndex(SRC, ids);
  for (const e of registry.extensions) console.log(`✓ ${e.id} ${e.version}${e.completeness ? ' ' + JSON.stringify(e.completeness) : ''}`);
  for (const p of problems) {
    console.log(`✗ ${p.id}`);
    for (const line of p.problems) console.log(`    ${line}`);
  }
  return { registry, problems };
}

// For tools (the Vite plugin): the catalog as JSON on stdout, problems on stderr
if (args.includes('--json')) {
  const { registry, problems } = buildIndex(SRC, only);
  for (const p of problems) console.error(`✗ ${p.id}: ${p.problems.join('; ')}`);
  console.log(JSON.stringify(registry));
  process.exit(0);
}

// Publish: public extensions only; a failing one stops it (a half-published catalog is worse than none)
if (OUT) {
  const { problems } = report();
  if (problems.length) process.exit(1);
  const { registry } = buildIndex(SRC, only, { publicOnly: true, base: BASE });
  for (const e of registry.extensions) {
    const to = join(OUT, e.id);
    rmSync(to, { recursive: true, force: true });
    for (const path of Object.keys(e.files)) {
      mkdirSync(dirname(join(to, path)), { recursive: true });
      cpSync(join(SRC, e.id, path), join(to, path));
    }
  }
  writeFileSync(join(OUT, 'registry.json'), JSON.stringify(registry, null, 2) + '\n');
  console.log(`Published ${registry.extensions.length} extension(s) to ${OUT}${BASE ? ` (paths under ${BASE})` : ''}`);
  process.exit(0);
}

const { problems } = report();
if (!DEV) process.exit(problems.length ? 1 : 0);

// Serves the sources and the catalog with CORS. When an extension's files change it is checked
// again and connected editors are told over server-sent events (`reload` with the ids, or
// `build-error` with the problems); prints what the editor sends to /__log (errors and warnings
// of extension workers and panels).

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
function send(event: string, data: unknown) {
  const chunk = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const c of clients) { try { c.enqueue(chunk); } catch { clients.delete(c); } }
}
// Proxies and browsers drop silent streams
setInterval(() => { const ping = enc.encode(': ping\n\n'); for (const c of clients) { try { c.enqueue(ping); } catch { clients.delete(c); } } }, 15000);

/** Sizes and change times of an extension's files: the watcher also fires on reads, this tells real edits */
const stamp = (id: string) => listFiles(join(SRC, id)).map(f => { const st = statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; }).join('|');
const stamps = new Map<string, string>(extensionIds().map(id => [id, stamp(id)]));

function changed(ids: string[]) {
  if (!ids.length) return;
  const { registry, problems } = report(ids);
  if (registry.extensions.length) send('reload', { ids: registry.extensions.map(e => e.id) });
  for (const p of problems) send('build-error', { id: p.id, message: p.problems.join('\n') });
}

/** Changed extensions are collected for a moment, then checked and reloaded together */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
watch(SRC, { recursive: true }, (_e, file) => {
  const id = String(file ?? '').split(/[\\/]/)[0];
  if (!id || (only.length && !only.includes(id))) return;
  pending.add(id);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const ids = [...pending].filter(id => { const now = existsSync(join(SRC, id)) ? stamp(id) : ''; const same = stamps.get(id) === now; stamps.set(id, now); return !same; });
    pending.clear();
    changed(ids);
  }, 150);
});

// The API is compiled into every extension by the editor: a change there reloads them all
watch(join(SRC, '../packages/api/src'), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => changed(extensionIds().filter(id => !only.length || only.includes(id))), 150);
});

const tint = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' } as const;

Bun.serve({
  port: DEV_PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/__events') {
      let self: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { self = c; clients.add(c); c.enqueue(enc.encode(': connected\n\n')); },
        cancel() { clients.delete(self); },
      });
      return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' } });
    }
    if (url.pathname === '/__log' && req.method === 'POST') {
      try {
        const e = JSON.parse(await req.text()) as { id?: string; level?: keyof typeof tint; message?: string; stack?: string; source?: string; };
        const level = e.level && e.level in tint ? e.level : 'error';
        console.log(`${tint[level]}${new Date().toLocaleTimeString()} [${e.id}] ${e.source ?? ''} ${level}:\x1b[0m ${e.message ?? ''}`);
        if (e.stack) console.log(`\x1b[2m${e.stack.split('\n').map(l => `    ${l}`).join('\n')}\x1b[0m`);
      } catch { /* not ours */ }
      return new Response(null, { status: 204, headers: CORS });
    }
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'registry.json';
    if (path === 'registry.json') return Response.json(buildIndex(SRC, only).registry, { headers: CORS });
    const file = Bun.file(join(SRC, path));
    if (path.includes('..') || !(await file.exists())) return new Response('Not found', { status: 404, headers: CORS });
    return new Response(file, { headers: CORS });
  },
});
console.log(`Extensions dev server at http://localhost:${DEV_PORT}/ — connect it in Extensions → Developer`);
