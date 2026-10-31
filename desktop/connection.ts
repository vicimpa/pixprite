import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AutomationRequest } from './protocol';

export const connectionPath = () => process.env.PIXPRITE_CONNECTION_FILE || join(homedir(), '.pixprite', 'connection.json');
export type Connection = { url: string; token: string; pid: number; mcpPath?: string; mcpSha256?: string; version?: string };

/** The discovery file is local and private. Never send its token to a remote URL. */
export async function callDesktop(request: AutomationRequest, path = connectionPath()) {
  let connection: Connection;
  try { connection = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('Start Pixprite desktop first. Its local MCP connection is not available.'); }
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/rpc'
    || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(connection.token))
    throw new Error('Invalid Pixprite desktop connection file');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const reply = await response.json() as { result?: unknown; error?: string };
  if (!response.ok || reply.error) throw new Error(reply.error || `Desktop returned HTTP ${response.status}`);
  return reply.result;
}
