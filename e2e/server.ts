/** Production assets plus deterministic deployment/extension fixtures, bound to loopback only. */
import { resolve, sep } from 'node:path';
import { pwaFixtures } from './pwa-fixtures';
import { securityFixtures } from './security-fixtures';
import { build } from 'vite';

await build({ configFile: resolve(import.meta.dir, '../benchmarks/vite.security.config.ts'), logLevel: 'warn' });
const securityRoot = resolve(import.meta.dir, '../.extension-dist');

const root = resolve(import.meta.dir, '../dist');
const pwa = await pwaFixtures(root);
const manifest = {
  id: 'e2e-permissions', name: 'E2E permissions', version: '1.0.0', apiVersion: 1,
  entry: 'main.js', permissions: [],
  contributes: { commands: [{ id: 'probe', label: 'E2E denied API' }] },
};
const source = `import { defineExtension } from '@pixprite/api';
export default defineExtension(ctx => {
  ctx.commands.register('probe', async () => {
    try {
      await ctx.sprite.get();
      await ctx.ui.notify('ERROR: unauthorized access succeeded', 'error');
    } catch (error) {
      await ctx.ui.notify('Denied API: ' + error.code + ': ' + error.message, 'success');
    }
  });
});`;
const fixtureFiles: Record<string, string> = {
  'manifest.json': JSON.stringify(manifest), 'main.js': source,
};
const hashes = Object.fromEntries(await Promise.all(Object.entries(fixtureFiles).map(async ([name, content]) => [
  name, `sha256-${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))).toString('base64')}`,
])));

Bun.serve({
  hostname: '127.0.0.1', port: 4173,
  async fetch(request) {
    const url = new URL(request.url);
    const security = securityFixtures(request);
    if (security) return security;
    if (url.pathname.startsWith('/__security__/')) {
      const path = resolve(securityRoot, '.' + url.pathname.slice('/__security__'.length));
      if (!path.startsWith(securityRoot + sep)) return new Response('Forbidden', { status: 403 });
      const file = Bun.file(path);
      return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
    }
    const fixtureResponse = await pwa(request);
    if (fixtureResponse) return fixtureResponse;
    if (url.pathname === '/__e2e__/registry.json')
      return Response.json([{ ...manifest, path: 'extension/', files: hashes }]);
    const fixture = fixtureFiles[url.pathname.replace('/__e2e__/extension/', '')];
    if (url.pathname.startsWith('/__e2e__/extension/') && fixture)
      return new Response(fixture, { headers: { 'Content-Type': url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript' } });
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
  },
});
