/** Check shipping content and the actual application executable/resources without launching it. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2] || 'dist/desktop');
const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (metadata.version !== pkg.version) throw new Error('Desktop metadata does not match this release');
for (const name of ['mcp.mjs', 'mcp-builtin.mjs', 'bridge.js', 'web/index.html']) if (!(await stat(join(directory, name))).size) throw new Error(`Empty desktop resource: ${name}`);
const html = await readFile(join(directory, 'web/index.html'), 'utf8');
if (!html.includes('await window.pixpriteDesktop.startup')) throw new Error('Desktop storage bootstrap is missing');
for (const file of await readdir(directory, { recursive: true })) if (/(^|[/\\])node_modules([/\\]|$)|\.asar$|\.node$/.test(file)) throw new Error(`Unexpected desktop dependency: ${file}`);
const binary = process.argv[3] || join(directory, `pixprite${process.platform === 'win32' ? '.exe' : ''}`);
const info = await stat(binary); if (!info.isFile() || info.size < 100_000) throw new Error('Missing native executable');
if (binary.includes('.app/Contents/MacOS/')) {
  const app = binary.slice(0, binary.indexOf('.app/') + 4);
  const resources = join(app, 'Contents/Resources');
  for (const name of ['mcp.mjs', 'mcp-builtin.mjs']) if (!(await stat(join(resources, name))).size) throw new Error(`Missing packaged MCP resource: ${name}`);
  if ((await readdir(join(app, 'Contents'))).includes('Frameworks')) throw new Error('Unexpected embedded browser frameworks');
}
console.log(`PASS Tauri package ${metadata.version}: ${(info.size / 1024 / 1024).toFixed(1)} MiB executable; matching content and MCP resources`);
