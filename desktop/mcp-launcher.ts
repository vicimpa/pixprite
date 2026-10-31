/** Stable stdio entry installed beside the native app. Run the verified tools belonging to the running application. */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import { connectionPath } from './connection';

const flag = process.argv.indexOf('--connection');
const path = flag >= 0 ? process.argv[flag + 1] : connectionPath();
if (!path) throw new Error('--connection requires a file path');
let entry = join(dirname(process.argv[1]), 'mcp-builtin.mjs');
let connection: { mcpPath?: string; mcpSha256?: string } | undefined;
try { connection = JSON.parse(await readFile(path, 'utf8')); } catch { /* built-in tools can report that the editor is closed */ }
if (connection?.mcpPath) {
  if (!isAbsolute(connection.mcpPath) || !/^[a-f0-9]{64}$/.test(connection.mcpSha256 ?? '') || (await stat(connection.mcpPath)).size > 16 * 1024 * 1024)
    throw new Error('Invalid MCP entry');
  const bytes = await readFile(connection.mcpPath);
  if (createHash('sha256').update(bytes).digest('hex') !== connection.mcpSha256) throw new Error('Active MCP entry checksum mismatch; restart Pixprite');
  entry = connection.mcpPath;
}
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
