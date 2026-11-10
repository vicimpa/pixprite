/**
 * Minimal Discord IPC client used by the local bridge.
 *
 * Discord exposes Rich Presence only over a local socket: a named pipe on Windows,
 * a unix socket on macOS/Linux. Frames are a 4-byte little-endian opcode, a 4-byte
 * little-endian payload length and UTF-8 JSON.
 */

import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { env, pid, platform } from 'node:process';

export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;

export type IpcFrame = { op: number; data: Record<string, unknown> };
export type ErrorKind = 'offline' | 'ipc' | 'discord';

export class DiscordError extends Error {
  readonly kind: ErrorKind;
  readonly code?: number;
  constructor(kind: ErrorKind, message: string, code?: number) {
    super(message);
    this.name = 'DiscordError';
    this.kind = kind;
    this.code = code;
  }
}

export function encodeFrame(op: number, data: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const frame = Buffer.allocUnsafe(8 + json.length);
  frame.writeUInt32LE(op, 0);
  frame.writeUInt32LE(json.length, 4);
  json.copy(frame, 8);
  return frame;
}

/** One complete frame from the start of `buffer`, or null when more bytes are needed */
export function decodeFrame(buffer: Buffer): { frame: IpcFrame; rest: Buffer } | null {
  if (buffer.length < 8) return null;
  const op = buffer.readUInt32LE(0);
  const length = buffer.readUInt32LE(4);
  if (length > 1_000_000) throw new Error('Discord IPC frame is larger than 1 MB');
  if (buffer.length < 8 + length) return null;
  const text = buffer.subarray(8, 8 + length).toString('utf8');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Discord IPC sent invalid JSON'); }
  if (!data || typeof data !== 'object') throw new Error('Discord IPC sent a non-object frame');
  return { frame: { op, data: data as Record<string, unknown> }, rest: buffer.subarray(8 + length) };
}

/** Candidate socket paths, most likely first; Discord listens on the first free one */
export function ipcPaths(platformName = platform, environment: NodeJS.ProcessEnv = env): string[] {
  const count = 10;
  if (platformName === 'win32')
    return Array.from({ length: count }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  const bases: string[] = [];
  if (environment.XDG_RUNTIME_DIR) bases.push(environment.XDG_RUNTIME_DIR);
  if (environment.TMPDIR) bases.push(environment.TMPDIR);
  if (environment.TMP) bases.push(environment.TMP);
  bases.push('/tmp');
  const paths: string[] = [];
  for (const base of bases)
    for (let i = 0; i < count; i++) {
      const path = join(base, `discord-ipc-${i}`);
      if (!paths.includes(path)) paths.push(path);
    }
  return paths;
}

type Waiter = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Discord puts the error at the top level of CLOSE frames and under `data` in ERROR frames */
function discordError(frame: Record<string, unknown>, fallback: string) {
  const inner = frame.data && typeof frame.data === 'object' ? frame.data as Record<string, unknown> : {};
  const code = typeof frame.code === 'number' ? frame.code
    : typeof inner.code === 'number' ? inner.code : undefined;
  const message = typeof frame.message === 'string' ? frame.message
    : typeof inner.message === 'string' ? inner.message : fallback;
  return { code, message };
}

/** One connection to the Discord client; reconnects on the next request after a close */
export class DiscordIpc {
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private clientId = '';
  private ready: Waiter | null = null;
  private waiters = new Map<string, Waiter>();
  private closing = false;

  connected = false;
  lastError: string | null = null;

  constructor(
    private readonly log: (message: string) => void = () => { },
    /** Socket candidates; injectable for tests */
    private readonly paths: () => string[] = ipcPaths,
  ) { }

  /** Connects (or reuses a connection for the same application) and waits for Discord's READY */
  async connect(clientId: string): Promise<void> {
    if (!/^\d{15,21}$/.test(clientId))
      throw new DiscordError('ipc', 'The Discord application id must be 15–21 digits');
    // Reuse the live connection for the same app; a new app or a broken one gets a fresh socket
    if (this.connected && this.socket && this.clientId === clientId) return;
    await this.close();

    let socket: Socket | null = null;
    let last: Error | null = null;
    for (const path of this.paths()) {
      try {
        socket = await openSocket(path);
        this.log(`Discord IPC socket found: ${path}`);
        break;
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (!socket)
      throw new DiscordError('offline', `Discord is not running (no IPC socket): ${last?.message ?? 'unknown error'}`);

    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closing = false;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', error => {
      this.lastError = error.message;
      // A broken socket rejects pending requests; the handshake has its own timer
      for (const waiter of this.waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new DiscordError('ipc', `Discord IPC connection failed: ${error.message}`));
      }
      this.waiters.clear();
    });
    socket.on('close', () => {
      // A new connection may already have taken the place of this one: only fail
      // when it is still the current socket, otherwise drop the old handler
      if (this.socket !== socket) return;
      const wasConnected = this.connected;
      this.socket = null;
      this.connected = false;
      this.clientId = '';
      this.failAll(new DiscordError('ipc', 'Discord IPC connection closed'));
      if (wasConnected && !this.closing) this.log('Discord IPC connection closed; it reconnects on the next update');
    });

    // Discord stalls the pipe for a while after a connection closes; retry a timed-out
    // handshake once on the same socket before giving up
    let lastHandshake: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ready = new Promise<void>((resolve, reject) => {
        let reason: string | undefined;
        const timer = setTimeout(() => {
          this.ready = null;
          reject(new DiscordError('ipc',
            reason ? `Discord closed the handshake: ${reason}` : 'Discord did not answer the handshake'));
          socket!.destroy();
        }, 8000);
        this.ready = {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: error => {
            // Remember why the handshake ended so the timeout message is specific
            if (error instanceof DiscordError && error.kind === 'discord') reason = error.message;
            clearTimeout(timer);
            reject(error);
          },
          timer,
        };
      });
      socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: clientId }));
      try {
        await ready;
        lastHandshake = null;
        break;
      } catch (error) {
        lastHandshake = error instanceof Error ? error : new Error(String(error));
        const isTimeout = (lastHandshake as DiscordError).kind === 'ipc' && !(lastHandshake as DiscordError).code;
        if (!isTimeout || this.closing) break;
        if (attempt < 2) {
          this.log('The pipe is busy; retrying the handshake in 2 s');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    if (lastHandshake) throw lastHandshake;
    this.clientId = clientId;
    this.connected = true;
    this.lastError = null;
  }

  /** SET_ACTIVITY; resolves with Discord's echoed activity */
  setActivity(activity: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('SET_ACTIVITY', { pid, activity });
  }

  clearActivity(): Promise<Record<string, unknown>> {
    return this.request('SET_ACTIVITY', { pid, activity: null });
  }

  async request(cmd: string, args: Record<string, unknown>, timeout = 10_000): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || !this.connected)
      throw new DiscordError('ipc', 'Discord IPC is not connected');

    const nonce = randomUUID();
    const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(nonce);
        reject(new DiscordError('ipc', `Discord did not answer ${cmd}`));
      }, timeout);
      this.waiters.set(nonce, { resolve, reject, timer });
    });

    socket.write(encodeFrame(OP.FRAME, { cmd, args, nonce }), error => {
      if (!error) return;
      const waiter = this.waiters.get(nonce);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.waiters.delete(nonce);
      waiter.reject(new DiscordError('ipc', `Could not write to the Discord IPC socket: ${error.message}`));
    });

    return answer;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.closing = true;
    this.connected = false;
    this.clientId = '';
    this.socket = null;
    this.failAll(new DiscordError('ipc', 'Discord IPC connection closed'));
    if (!socket) return;
    // Discord requires `v` in every frame; a CLOSE without it is dropped and the
    // client stalls the pipe for the handshake timeout
    try { socket.end(encodeFrame(OP.CLOSE, { v: 1 })); } catch { /* already gone */ }
    socket.destroy();
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let parsed: ReturnType<typeof decodeFrame>;
      try {
        parsed = decodeFrame(this.buffer);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.socket?.destroy();
        return;
      }
      if (!parsed) return;
      this.buffer = Buffer.from(parsed.rest);
      this.onFrame(parsed.frame);
    }
  }

  private onFrame({ op, data }: IpcFrame) {
    if (op === OP.PING) {
      this.socket?.write(encodeFrame(OP.PONG, data));
      return;
    }
    if (op === OP.CLOSE) {
      const { code, message } = discordError(data, 'Discord closed the connection');
      this.failAll(new DiscordError('discord', message, code));
      this.socket?.destroy();
      return;
    }
    const evt = typeof data.evt === 'string' ? data.evt : '';
    // Discord acks the handshake with a READY event in a FRAME (evt=READY, cmd=DISPATCH);
    // older builds also send it as a HANDSHAKE frame — accept both
    if (evt === 'READY') {
      this.ready?.resolve(data);
      this.ready = null;
      return;
    }
    const nonce = typeof data.nonce === 'string' ? data.nonce : '';
    const waiter = nonce ? this.waiters.get(nonce) : undefined;
    if (!waiter) {
      if (evt === 'ERROR') {
        const { code, message } = discordError(data, 'Discord returned an error');
        this.failAll(new DiscordError('discord', message, code));
      }
      return;
    }
    clearTimeout(waiter.timer);
    this.waiters.delete(nonce);
    if (evt === 'ERROR') {
      const { code, message } = discordError(data, 'Discord rejected the activity');
      waiter.reject(new DiscordError('discord', message, code));
    } else {
      waiter.resolve(data);
    }
  }

  private failAll(error: Error) {
    if (this.ready) {
      this.ready.reject(error);
      this.ready = null;
    }
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}

/** Resolves with a connected socket, or rejects: missing pipes fail immediately, a hang is aborted */
export function openSocket(path: string, timeout = 500): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    let timer: ReturnType<typeof setTimeout>;
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.removeListener('connect', done);
      socket.removeListener('error', fail);
      socket.destroy();
      reject(error);
    };
    const done = () => {
      clearTimeout(timer);
      socket.removeListener('error', fail);
      resolve(socket);
    };
    timer = setTimeout(() => fail(new Error('connection timed out')), timeout);
    socket.once('connect', done);
    socket.once('error', fail);
  });
}
