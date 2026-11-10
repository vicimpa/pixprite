/**
 * Pixprite Discord presence bridge.
 *
 *   bun extensions/discord-presence/bridge/bridge.ts
 *
 * The editor runs in a sandbox and cannot open Discord's IPC socket, so this small
 * loopback process does it: it accepts the activity the extension sends over HTTP and
 * forwards it to the Discord desktop client.
 *
 * Only 127.0.0.1 is bound. Set PIXPRITE_DISCORD_TOKEN to also require the
 * `X-Pixprite-Token` header (the extension does not send one; use it for other callers).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DiscordError, DiscordIpc } from './ipc';
import { sanitizeActivity } from '../src/presence';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PIXPRITE_DISCORD_PORT ?? 52700);
const TOKEN = process.env.PIXPRITE_DISCORD_TOKEN ?? '';
/** The extension refreshes the presence at least every 30 s; without it Discord data goes away */
const STALE_AFTER = 90_000;

const time = () => new Date().toISOString().slice(11, 19);
const log = (message: string) => console.log(`[${time()}] ${message}`);

let currentAppId = '';
let lastActivity: Record<string, unknown> | null = null;
let lastSeen = 0;
let lastError: string | null = null;
let lastLogged = '';

const ipc = new DiscordIpc(log);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pixprite-Token',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '600',
};

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function text(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    ...CORS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request: IncomingMessage, limit = 16 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(request);
  if (!raw.trim()) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A JSON object is expected');
  return value as Record<string, unknown>;
}

type Failure = { ok: false; status: number; kind: string; code?: number; error: string };
type Success = { ok: true };
type Applied = Success | Failure;

async function send(appId: string, activity: Record<string, unknown>): Promise<Applied> {
  try {
    await ipc.connect(appId);
    await ipc.setActivity(activity);
    currentAppId = appId;
    lastActivity = activity;
    lastSeen = Date.now();
    lastError = null;
    const key = JSON.stringify(activity);
    if (key !== lastLogged) {
      lastLogged = key;
      const details = typeof activity.details === 'string' ? activity.details : '';
      const state = typeof activity.state === 'string' ? activity.state : '';
      const buttons = Array.isArray(activity.buttons) ? ` [${activity.buttons.map(b => (b as any).label).join(', ')}]` : '';
      log(`presence: ${[details, state].filter(Boolean).join(' · ') || 'activity without text'}${buttons}`);
    }
    return { ok: true };
  } catch (error) {
    const failure = error instanceof DiscordError
      ? error
      : new DiscordError('ipc', error instanceof Error ? error.message : String(error));
    lastError = failure.message;
    // Discord is not running: a distinct family the extension explains in the panel
    const kind = failure.kind === 'offline' ? 'offline' : failure.kind === 'discord' ? 'discord' : 'ipc';
    if (kind === 'offline') log(`Discord is not reachable: ${failure.message}`);
    else log(`Discord error${failure.code ? ` ${failure.code}` : ''}: ${failure.message}`);
    return {
      ok: false,
      status: kind === 'offline' ? 503 : 502,
      kind,
      code: failure.code,
      error: failure.message,
    };
  }
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS);
    response.end();
    return;
  }

  if (TOKEN && request.headers['x-pixprite-token'] !== TOKEN) {
    json(response, 401, { ok: false, kind: 'request', error: 'Invalid bridge token' });
    return;
  }

  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);

  try {
    if (url.pathname === '/presence') {
      if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'Use POST' });
      const payload = await body(request);
      const appId = typeof payload.appId === 'string' ? payload.appId.trim() : '';
      if (!/^\d{15,21}$/.test(appId))
        return json(response, 400, { ok: false, kind: 'request', error: 'appId must be a Discord application id (15–21 digits)' });
      const activity = sanitizeActivity(payload.activity);
      if (!activity)
        return json(response, 400, { ok: false, kind: 'request', error: 'activity needs a details or state text' });
      const result = await send(appId, activity as unknown as Record<string, unknown>);
      return result.ok
        ? json(response, 200, { ok: true })
        : json(response, result.status, { ok: false, kind: result.kind, code: result.code, error: result.error });
    }

    if (url.pathname === '/heartbeat') {
      if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'Use POST' });
      if (lastActivity) lastSeen = Date.now();
      return json(response, 200, {
        ok: true,
        active: !!lastActivity && ipc.connected,
        appId: currentAppId,
        lastSeen,
      });
    }

    if (url.pathname === '/clear') {
      if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'Use POST' });
      const had = !!lastActivity;
      lastActivity = null;
      lastSeen = 0;
      lastLogged = '';
      if (had && ipc.connected) {
        try { await ipc.clearActivity(); log('presence cleared'); }
        catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      }
      return json(response, 200, { ok: true, cleared: had });
    }

    if (url.pathname === '/status') {
      return json(response, 200, {
        ok: true,
        bridge: true,
        discord: ipc.connected,
        appId: currentAppId,
        active: !!lastActivity,
        lastSeen,
        error: lastError,
      });
    }

    if (url.pathname === '/') {
      return text(response, 200, [
        'Pixprite Discord presence bridge',
        `Listening on http://${HOST}:${PORT}`,
        '',
        'The Pixprite extension sends POST /presence, POST /heartbeat and POST /clear here.',
        'GET /status reports the Discord IPC connection.',
        'Discord must be the desktop application and running.',
        '',
      ].join('\n'));
    }

    json(response, 404, { ok: false, error: 'Unknown endpoint' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(response, 400, { ok: false, kind: 'request', error: message });
  }
}

const server = createServer((request, response) => {
  void handle(request, response).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) json(response, 500, { ok: false, error: message });
    else response.end();
  });
});

server.on('error', error => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the program that uses it or set PIXPRITE_DISCORD_PORT (the extension only allows 52700).`);
  } else {
    console.error(`Bridge failed to start: ${error.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log([
    '',
    '  Pixprite Discord presence bridge',
    `  http://${HOST}:${PORT}`,
    '',
    '  Keep this window open while you draw. Discord must be running.',
    '  If Discord is not open yet, the next editor update reconnects automatically.',
    '',
  ].join('\n'));
});

// A closed tab, a reloaded extension or a stopped worker must not leave a stale game card
const watchdog = setInterval(() => {
  if (!lastActivity || Date.now() - lastSeen <= STALE_AFTER) return;
  lastActivity = null;
  lastSeen = 0;
  lastLogged = '';
  log('presence cleared: the editor stopped refreshing it');
  void ipc.clearActivity().catch(() => { });
}, 10_000);
watchdog.unref?.();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  try { if (lastActivity) await ipc.clearActivity(); } catch { /* Discord may be gone */ }
  await ipc.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref?.();
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
