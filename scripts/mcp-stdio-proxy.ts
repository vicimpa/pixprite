/** stdio → HTTP proxy for Pixprite MCP.
 * Reads ~/.pixprite/connection.json, forwards stdin/stdout to the HTTP /mcp endpoint.
 * Allows OpenCode (and other stdio-based clients) to connect to Pixprite's HTTP MCP server.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';

interface ConnectionInfo {
  url: string;
  mcp_url?: string;
  mcpUrl?: string;
  token: string;
  pid: number;
  port: number;
  instance: string;
  version: string;
}

function getMcpUrl(conn: ConnectionInfo): string {
  return conn.mcp_url || conn.mcpUrl || `http://127.0.0.1:${conn.port}/mcp`;
}

const CONNECTION_FILE = join(homedir(), '.pixprite', 'connection.json');
const TOKEN_FILE = join(homedir(), '.pixprite', 'Tauri', 'mcp-token.json');

// Try to find pixprite.exe in known locations
const POSSIBLE_PATHS = [
  resolve(import.meta.dirname, 'pixprite.exe'), // If running from dist/desktop
  resolve(import.meta.dirname, '..', 'dist', 'desktop', 'pixprite.exe'), // If running from scripts/
  resolve(import.meta.dirname, '..', '..', 'dist', 'desktop', 'pixprite.exe'), // Nested
];

let PIXPRITE_EXE = POSSIBLE_PATHS[0];
import { existsSync } from 'node:fs';
for (const p of POSSIBLE_PATHS) {
  if (existsSync(p)) {
    PIXPRITE_EXE = p;
    break;
  }
}

async function readConnection(): Promise<ConnectionInfo | null> {
  try {
    const text = await readFile(CONNECTION_FILE, 'utf8');
    return JSON.parse(text) as ConnectionInfo;
  } catch {
    return null;
  }
}

async function ensureToken(): Promise<string> {
  try {
    const token = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (token.length === 64 && /^[0-9a-f]+$/i.test(token)) return token;
  } catch {}
  
  // If no token exists, Pixprite will create it. 
  // We'll just wait for it to appear in startPixpriteIfNeeded.
  return ""; 
}

async function startPixpriteIfNeeded(): Promise<void> {
  const conn = await readConnection();
  if (conn) {
    try {
      process.kill(conn.pid, 0);
      return; 
    } catch {}
  }

  stderr.write(`[pixprite-mcp-proxy] Starting ${PIXPRITE_EXE}...\n`);
  const child = spawn(PIXPRITE_EXE, ['--mcp', '--mcp-port', '3356'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false, // Show it for now to debug
  });
  child.unref();
  
  // Wait for connection file to appear
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const c = await readConnection();
    if (c) {
      // Check if it's the new process (optional, but good for safety)
      return;
    }
  }
  throw new Error(`Pixprite MCP failed to start at ${PIXPRITE_EXE}`);
}

async function proxyStdioToHttp(mcpUrl: string, token: string) {
  // Forward stdin → HTTP
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      stderr.write(`[proxy] Invalid JSON: ${line}\n`);
      continue;
    }

    const start = Date.now();
    try {
      // Use a longer timeout for the fetch itself if needed, 
      // but usually fetch waits indefinitely unless aborted.
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(req),
      });

      if (!res.ok) {
        const errorText = await res.text();
        stderr.write(`[proxy] HTTP Error ${res.status}: ${errorText}\n`);
        // Return a JSON-RPC error so the client knows what happened
        stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32000, message: `HTTP Error ${res.status}: ${errorText}` }
        }) + '\n');
        continue;
      }

      const data = await res.json();
      const elapsed = Date.now() - start;
      
      // Log slow requests
      if (elapsed > 1000) {
        stderr.write(`[proxy] Slow request (${req.method || 'unknown'}): ${elapsed}ms\n`);
      }

      stdout.write(JSON.stringify(data) + '\n');
    } catch (e) {
      const elapsed = Date.now() - start;
      stderr.write(`[proxy] Fetch error after ${elapsed}ms: ${e}\n`);
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: `Fetch error: ${e.message}` }
      }) + '\n');
    }
  }
}

async function main() {
  stderr.write('[pixprite-mcp-proxy] Starting...\n');
  
  await startPixpriteIfNeeded();
  
  const conn = await readConnection();
  if (!conn) throw new Error('No connection info found');
  
  const mcpUrl = getMcpUrl(conn);
  stderr.write(`[pixprite-mcp-proxy] Connected to ${mcpUrl}\n`);
  
  await proxyStdioToHttp(mcpUrl, conn.token);
}

main().catch(e => {
  stderr.write(`[pixprite-mcp-proxy] Fatal: ${e}\n`);
  process.exit(1);
});