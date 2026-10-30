const manifest = JSON.stringify({ id: 'integrity-probe', name: 'Integrity', version: '1.0.0', apiVersion: 1, entry: 'main.js' });
const main = `postMessage({type:'activated',exports:[]});`;
const hash = async (text: string) => 'sha256-' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64');
const files = { 'manifest.json': await hash(manifest), 'main.js': await hash(main) };
const network: string[] = [];

export function securityFixtures(request: Request): Response | undefined {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/__security__/network-log') {
    if (url.searchParams.has('reset')) network.length = 0;
    return Response.json(network);
  }
  if (path === '/__security__/allowed') return new Response('allowed');
  if (path === '/__security__/redirect') return Response.redirect(url.origin + '/__security__/forbidden');
  if (path === '/__security__/forbidden') { network.push(request.url); return new Response('should never be requested'); }
  const match = path.match(/^\/__security__\/package\/([^/]+)\/(.*)$/);
  if (!match) return;
  const [, mode, file] = match;
  if (file === 'manifest.json') return new Response(mode === 'malformed' ? '{' : manifest);
  if (file === 'main.js') return new Response(main);
  if (file === 'files.json') {
    if (mode === 'server-error') return new Response('Unavailable', { status: 503 });
    if (mode === 'valid') return Response.json(files);
    if (mode === 'bad-hash') return Response.json({ ...files, 'main.js': '0'.repeat(64) });
    if (mode === 'bad-manifest-hash') return Response.json({ ...files, 'manifest.json': '0'.repeat(64) });
    if (mode === 'missing-manifest-hash') return Response.json({ 'main.js': files['main.js'] });
    if (mode === 'malformed-list') return new Response('{');
    if (mode === 'array-list') return Response.json([]);
    if (mode === 'null-list') return Response.json(null);
    if (mode === 'bad-path') return Response.json({ ...files, '../escape.js': files['main.js'] });
    if (mode === 'encoded-path') return Response.json({ ...files, '%2e%2e/escape.js': files['main.js'] });
    if (mode === 'backslash-path') return Response.json({ ...files, '..\\escape.js': files['main.js'] });
  }
  return new Response('Not found', { status: 404 });
}
