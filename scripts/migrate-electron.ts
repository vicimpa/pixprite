/** One-time, explicit backup from the old installed app; Electron is never a runtime dependency. */
import { _electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, relative, sep, basename } from 'node:path';
import { exportStorage, type Migration } from '../desktop/migration';
import { callDesktop } from '../desktop/connection';

const args = process.argv.slice(2);
const flag = (key: string) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
const executable = flag('--electron');
if (!executable) throw new Error('Usage: bun run desktop:migrate --electron /path/to/old/Pixprite [--source /old/profile] [--destination /new/profile]. Close both apps first.');
const base = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/Pixprite')
  : process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'Pixprite')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Pixprite');
const source = resolve(flag('--source') || base), destination = resolve(flag('--destination') || join(base, 'Tauri'));
if (source === destination) throw new Error('Source and destination profiles must differ');
const temporary = await mkdtemp(join(tmpdir(), 'pixprite-migration-'));
const connection = join(temporary, 'connection.json');
const working = join(temporary, 'electron-profile');
// Run the legacy app against a copy, leaving the real Chromium profile untouched.
await cp(source, working, { recursive: true, filter: path => relative(source, path).split(sep)[0] !== 'Tauri'
  && !['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'Cache', 'Code Cache', 'GPUCache', 'updates'].includes(basename(path)) });
const app = await _electron.launch({ executablePath: resolve(executable), args: [], timeout: 30_000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PIXPRITE_USER_DATA: working, PIXPRITE_CONNECTION_FILE: connection, PIXPRITE_DISABLE_UPDATES: '1' } });
try {
  // The old app may briefly expose a splash window; export only from its ready editor.
  let page: Awaited<ReturnType<typeof app.firstWindow>> | undefined;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { await callDesktop({ method: 'documents' }, connection); page = app.windows().find(page => page.url().startsWith('pixprite://app/')); if (page) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('The old editor did not start. Close any running Electron copy and retry.');
  // The old app's normal shutdown path ensures all working copies exist in its database.
  await callDesktop({ method: 'prepare_update' }, connection);
  const dump = await page.evaluate<Migration>(`(${exportStorage.toString()})()`);
  const data = JSON.stringify(dump);
  if (Buffer.byteLength(data) > 256 * 1024 * 1024) throw new Error('Backup exceeds 256 MiB; export large documents as .pixprite instead');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const path = join(destination, 'electron-migration.json');
  await writeFile(path, data, { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${dump.databases.length} databases to ${path}. Start Tauri Pixprite to import. The original profile remains at ${source}.`);
} finally { await app.close(); await rm(temporary, { recursive: true, force: true }); }
