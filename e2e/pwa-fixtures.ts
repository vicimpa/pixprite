/** Two actual production snapshots; only this loopback server exposes deployment/fault controls. */
import { rmSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { writeServiceWorker } from '../scripts/vite-service-worker.js';

type State = { deploy: 'a' | 'b'; fault?: 'missing' | 'html' | 'asset' | 'manifest' };

export async function pwaFixtures(root: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'pixprite-pwa-'));
  process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
  const versions = { a: resolve(directory, 'a'), b: resolve(directory, 'b') };
  for (const version of ['a', 'b'] as const) {
    const target = versions[version];
    await cp(root, target, { recursive: true });
    await rename(resolve(target, 'assets'), resolve(target, `assets-${version}`));
    const html = await readFile(resolve(target, 'index.html'), 'utf8');
    await writeFile(resolve(target, 'index.html'), html.replaceAll('assets/', `assets-${version}/`).replace('<head>', `<head><meta name="fixture-build" content="${version}">`).replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/, (_, entry) => `<script type="module">addEventListener('load', () => import(${JSON.stringify(entry)}), { once: true });</script>`));
    // The entry bundle's generated preload map also includes paths relative to the scope.
    for (const file of await readdir(resolve(target, `assets-${version}`))) {
      if (!/\.(js|css)$/.test(file)) continue;
      const path = resolve(target, `assets-${version}`, file);
      const source = await readFile(path, 'utf8');
      await writeFile(path, source.replaceAll('assets/', `assets-${version}/`) + `\n/* fixture ${version} */\n`);
    }
    await writeServiceWorker(target);
  }
  const states = new Map<string, State>();
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const control = url.pathname.match(/^\/__e2e__\/pwa-control\/([\w-]+)$/);
    if (control && request.method === 'POST') {
      const state = await request.json() as State;
      if (!['a', 'b'].includes(state.deploy)) return new Response('Invalid deploy', { status: 400 });
      states.set(control[1], state);
      return Response.json(state);
    }
    const match = url.pathname.match(/^\/__e2e__\/pwa\/([\w-]+)\/(.*)$/);
    if (!match) return;
    const state = states.get(match[1]) ?? { deploy: 'a' };
    const file = decodeURIComponent(match[2] || 'index.html');
    const base = versions[state.deploy];
    const path = resolve(base, file);
    if (!path.startsWith(base + sep)) return new Response('Forbidden', { status: 403 });
    if (state.fault === 'missing' && file.startsWith(`assets-${state.deploy}/`) && file.endsWith('.woff2'))
      return new Response('Interrupted deploy', { status: 503 });
    if ((state.fault === 'html' && file === 'index.html') || (state.fault === 'asset' && file.startsWith(`assets-${state.deploy}/`) && file.endsWith('.js')))
      return new Response('Wrong release bytes', { headers: { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' } });
    if (state.fault === 'manifest' && file.startsWith('precache-'))
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    const asset = Bun.file(path);
    return await asset.exists() ? new Response(asset, { headers: { 'Cache-Control': 'no-store' } }) : new Response('Not found', { status: 404 });
  };
}
