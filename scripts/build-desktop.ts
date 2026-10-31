/** Build the system-WebView shell and the external stdio adapter. */
import { cp, mkdir, readFile, readdir, rm, writeFile, mkdtemp, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dir, '..'), output = join(root, 'dist/desktop');
const args = process.argv.slice(2);
// Resolve the native lockfile before invoking the Tauri CLI.
const metadataCheck = Bun.spawn(['cargo', 'metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1'], { cwd: root, stdout: 'ignore', stderr: 'inherit' });
if (await metadataCheck.exited) throw new Error('Could not resolve native dependencies');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const cargoVersion = /^version = "([^"]+)"/m.exec(await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8'))?.[1];
if (cargoVersion !== pkg.version) throw new Error('Cargo.toml and package.json versions must match');
await mkdir(join(root, 'dist/installers'), { recursive: true });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const [source, name, target] of [['mcp', 'mcp-builtin.mjs', 'node'], ['mcp-launcher', 'mcp.mjs', 'node'], ['tauri-bridge', 'bridge.js', 'browser']] as const) {
  const result = await Bun.build({ entrypoints: [join(root, `desktop/${source}.ts`)], outdir: output, naming: name,
    target, format: target === 'browser' ? 'iife' : 'esm', minify: true });
  if (!result.success) throw new AggregateError(result.logs, `Could not build ${source}`);
}
const metadata = { version: pkg.version };
await writeFile(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
await rm(join(output, 'web'), { recursive: true, force: true });
await cp(join(root, 'dist/web'), join(output, 'web'), { recursive: true });
const html = await readFile(join(output, 'web/index.html'), 'utf8');
let patched = false;
await writeFile(join(output, 'web/index.html'), html.replace(/<script type="module"([^>]*?)src="([^"]+)"([^>]*)><\/script>/, (_all, _before, source) => {
  patched = true;
  return `<script type="module">await window.pixpriteDesktop.startup; await import(${JSON.stringify(source)});</script>`;
}));
if (!patched) throw new Error('Could not find the production browser entry');
console.log('Prepared Tauri bridge and stdio MCP');
if (args.includes('--prepare')) process.exit(0);
const buildArgs = [...args];
const bundleIndex = buildArgs.indexOf('--bundles');
const macDmg = process.platform === 'darwin' && !buildArgs.includes('--no-bundle')
  && (bundleIndex < 0 || buildArgs[bundleIndex + 1].split(',').some(value => value === 'dmg' || value === 'all'));
const tauriArgs = [...buildArgs];
if (bundleIndex < 0 && !buildArgs.includes('--no-bundle') && process.platform !== 'darwin')
  tauriArgs.push('--bundles', process.platform === 'win32' ? 'nsis,msi' : 'deb,appimage');
// Build the app with Tauri; create the disk image without mounting it or scripting Finder.
if (macDmg) {
  if (bundleIndex < 0) tauriArgs.push('--bundles', 'app');
  else tauriArgs[bundleIndex + 1] = 'app';
}
const child = Bun.spawn(['bunx', 'tauri', 'build', ...tauriArgs], { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
const code = await child.exited;
if (code) process.exit(code);
const targetIndex = buildArgs.indexOf('--target'), target = targetIndex >= 0 ? buildArgs[targetIndex + 1] : undefined;
const mode = buildArgs.includes('--debug') ? 'debug' : 'release';
const targetRoot = join(root, 'dist/tauri', ...(target ? [target] : []), mode);
const binary = `pixprite${process.platform === 'win32' ? '.exe' : ''}`;
await cp(join(targetRoot, binary), join(output, binary));
const arch = target === 'universal-apple-darwin' ? 'universal' : target?.startsWith('aarch64') || !target && process.arch === 'arm64' ? 'arm64' : 'x64';
const platform = ({ darwin: 'mac', win32: 'win', linux: 'linux' } as Record<string, string>)[process.platform];
if (!platform) throw new Error(`Unsupported desktop platform: ${process.platform}`);
if (!buildArgs.includes('--no-bundle')) {
  for (const file of await readdir(join(targetRoot, 'bundle'), { recursive: true, withFileTypes: true })) if (file.isFile() && /\.(exe|msi|deb|AppImage)$/.test(file.name)) {
    const extension = file.name.split('.').at(-1);
    await cp(join(file.parentPath, file.name), join(root, `dist/installers/Pixprite-${pkg.version}-${platform}-${arch}${extension === 'exe' ? '-setup' : ''}.${extension}`));
  }
}
if (macDmg) {
  const stage = await mkdtemp(join(tmpdir(), 'pixprite-dmg-'));
  const destination = join(root, `dist/installers/Pixprite-${pkg.version}-mac-${arch}.dmg`);
  try {
    await cp(join(targetRoot, 'bundle/macos/Pixprite.app'), join(stage, 'Pixprite.app'), { recursive: true });
    await symlink('/Applications', join(stage, 'Applications'), 'dir');
    const image = Bun.spawn(['hdiutil', 'create', '-volname', `Pixprite ${pkg.version}`, '-srcfolder', stage, '-format', 'UDZO', '-ov', destination], { stdout: 'inherit', stderr: 'inherit' });
    if (await image.exited) throw new Error('Could not create the macOS installer');
    console.log(`Created ${destination}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
