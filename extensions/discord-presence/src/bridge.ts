/**
 * Client of the local bridge. `ctx.net.fetch` is the only network access an extension has,
 * and the manifest allows exactly http://127.0.0.1:52700.
 */

import type { ExtensionContext } from '@pixprite/api';
import { BRIDGE_URL } from './config';
import type { DiscordActivity } from './presence';

export type BridgeReply = {
  ok: boolean;
  /** The bridge itself could not be reached */
  offline?: boolean;
  status?: number;
  /** Bridge error family: `offline` (Discord is not running), `ipc`, `discord`, `request` */
  kind?: string;
  /** Discord error code, e.g. 4000 for an invalid application id */
  code?: number;
  message?: string;
  body?: Record<string, unknown>;
};

const TIMEOUT = 5000;

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The bridge did not answer in time.')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function call(
  ctx: ExtensionContext,
  path: string,
  init?: { method?: string; body?: string },
): Promise<BridgeReply> {
  let response;
  try {
    response = await timeout(ctx.net.fetch(`${BRIDGE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : {},
      body: init?.body,
    }), TIMEOUT);
  } catch (error) {
    return { ok: false, offline: true, message: error instanceof Error ? error.message : String(error) };
  }

  let body: Record<string, unknown> | undefined;
  try {
    const text = new TextDecoder().decode(response.body);
    body = text ? JSON.parse(text) as Record<string, unknown> : undefined;
  } catch {
    body = undefined;
  }

  const ok = response.status >= 200 && response.status < 300;
  if (ok && body?.ok === true) return { ok: true, status: response.status, body };
  const message = typeof body?.error === 'string'
    ? body.error
    : body?.message ? String(body.message) : `HTTP ${response.status}`;
  return {
    ok: false,
    status: response.status,
    kind: typeof body?.kind === 'string' ? body.kind : undefined,
    code: typeof body?.code === 'number' ? body.code : undefined,
    message,
    body,
  };
}

export const sendPresence = (ctx: ExtensionContext, appId: string, activity: DiscordActivity) =>
  call(ctx, '/presence', { method: 'POST', body: JSON.stringify({ appId, activity }) });

export const clearPresence = (ctx: ExtensionContext) =>
  call(ctx, '/clear', { method: 'POST', body: '{}' });

export const heartbeat = (ctx: ExtensionContext) =>
  call(ctx, '/heartbeat', { method: 'POST', body: '{}' });

export const bridgeStatus = (ctx: ExtensionContext) => call(ctx, '/status');

/** A friendly status for a failed bridge call */
export function failureState(reply: BridgeReply): { state: 'offline' | 'discord-closed' | 'bad-app' | 'error'; message?: string } {
  if (reply.offline) return { state: 'offline', message: reply.message };
  if (reply.code === 4000 || reply.kind === 'app') return { state: 'bad-app', message: reply.message };
  if (reply.kind === 'offline') return { state: 'discord-closed', message: reply.message };
  return { state: 'error', message: reply.message };
}
