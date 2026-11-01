/** Deterministic catalog history for UI install/downgrade/rollback tests. */
export async function versionedFixtures() {
  const prefix = '/__e2e__/versioned/', files = new Map<string, string>();
  const entries = [];
  for (const version of ['3.0.0', '2.0.0', '1.0.0']) {
    const manifest = { id: 'versioned-tool', name: 'Versioned tool', version, apiVersion: 1, minEditorVersion: version === '3.0.0' ? '99.0.0' : '0.0.4',
      category: 'tools', tags: ['drawing', 'history'], entry: 'main.js', permissions: [], contributes: { commands: [{ id: 'probe', label: `Tool ${version}` }] } };
    const contents = { 'manifest.json': JSON.stringify(manifest), 'main.js': `import {defineExtension} from '@pixprite/api';export default defineExtension(ctx=>{ctx.commands.register('probe',()=>ctx.ui.notify('Tool ${version}'));});` };
    const hashes: Record<string, string> = {};
    const path = `${prefix}versioned-tool/${version}/`;
    for (const [name, text] of Object.entries(contents)) {
      files.set(path + name, text);
      hashes[name] = 'sha256-' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64');
    }
    entries.push({ ...manifest, path, files: hashes });
  }
  const registry = { version: 3, extensions: [{ ...entries[0], versions: entries }, { id: 'data-theme', name: 'Data theme', version: '1.0.0', category: 'themes', tags: ['dark'], path: 'unused/', permissions: [] }] };
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === prefix + 'registry.json') return Response.json(registry);
    const text = files.get(path);
    return text === undefined ? null : new Response(text, { headers: { 'Content-Type': path.endsWith('.json') ? 'application/json' : 'text/javascript' } });
  };
}
