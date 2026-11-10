/**
 * Tests of the Discord presence extension: the activity built for every editor state,
 * the text/field limits Discord enforces, and the IPC framing and handshake of the bridge.
 */

import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DiscordError, DiscordIpc, OP, decodeFrame, encodeFrame, ipcPaths, type IpcFrame,
} from '../extensions/discord-presence/bridge/ipc';
import { DEFAULT_SETTINGS, SITE_URL, type Settings } from '../extensions/discord-presence/src/config';
import {
  MAX_TEXT, activityKey, buildActivity, clip, sanitizeActivity, tagAt,
  type DiscordActivity, type PresenceDoc, type PresenceInput,
} from '../extensions/discord-presence/src/presence';

const EN = JSON.parse(readFileSync(join(import.meta.dir, '../extensions/discord-presence/locales/en.json'), 'utf8')) as Record<string, string>;
const CORE: Record<string, string> = { 'tool.pencil': 'Pencil', 'tool.eraser': 'Eraser' };

const t = (key: string, vars?: Record<string, string | number>) => {
  let text = EN[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const core = (key: string) => CORE[key] ?? key;

const settings = (extra: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...extra });

const doc = (extra: Partial<PresenceDoc> = {}): PresenceDoc => ({
  name: 'hero.png',
  width: 32,
  height: 48,
  layers: 3,
  frames: 4,
  tags: [{ name: 'walk', from: 0, to: 2 }, { name: 'idle', from: 3, to: 3 }],
  frame: 1,
  dirty: false,
  ...extra,
});

const input = (extra: Partial<PresenceInput> = {}): PresenceInput => ({
  doc: doc(),
  tool: 'pencil',
  playing: false,
  selection: null,
  idle: false,
  idleMinutes: 5,
  timing: { startedAt: 1_000, now: 61_000 },
  ...extra,
});

const build = (overrides: Partial<PresenceInput> = {}, extra: Partial<Settings> = {}) =>
  buildActivity(input(overrides), settings(extra), t, core);

// --- activity for every state -------------------------------------------------------------

test('no document shows that nothing is open and keeps the activity type', () => {
  const activity = build({ doc: null }, { activityType: 3 });
  expect(activity).toEqual({
    type: 3,
    details: 'Not drawing yet',
    state: 'No sprite open',
    timestamps: { start: 1_000 },
    assets: { large_image: 'pixprite', large_text: 'Pixprite' },
  });
});

test('file name is hidden when the privacy toggle is off and an empty name falls back to untitled', () => {
  expect(build({}, { display: { showFile: false, showCanvas: true, showTool: true, showFrame: true, showSelection: true, showDirty: true, showTimer: true, showLink: false } })?.details).toBe('A pixel-art project');
  expect(build({ doc: doc({ name: '' }) })?.details).toBe('Untitled sprite');
});

test('editing shows the tool, tagged frame, selection, canvas size and unsaved changes', () => {
  const activity = build({ playing: false, selection: { w: 4, h: 6 }, doc: doc({ dirty: true, layers: 2 }) });
  expect(activity?.details).toBe('hero.png');
  expect(activity?.state).toBe('Pencil · walk · frame 2/4 · Selection 4×6 · 32×48 px · Unsaved changes');
  expect(activity?.timestamps).toEqual({ start: 1_000 });
});

test('every display toggle can be turned off, leaving the plain drawing state', () => {
  const activity = build({ selection: { w: 4, h: 6 }, doc: doc({ dirty: true }) }, {
    display: { showFile: false, showTool: false, showFrame: false, showSelection: false, showCanvas: false, showDirty: false, showTimer: true, showLink: false },
  });
  expect(activity?.state).toBe('Drawing');
});

test('animation playback names the playing tag, or the frame when no tag covers it', () => {
  expect(build({ playing: true })?.state).toBe('Playing walk · frame 2/4');
  expect(build({ playing: true, doc: doc({ tags: [] }) })?.state).toBe('Playing animation · frame 2/4');
});

test('idle replaces the state only when the threshold is positive and wins over playback', () => {
  expect(build({ idle: true, playing: true })?.state).toBe('Idle for 5 min');
  expect(build({ idle: true, playing: true, idleMinutes: 0 })?.state).toBe('Playing walk · frame 2/4');
});

test('the elapsed timer follows its toggle and is dropped for a start in the future', () => {
  expect(build({}, { display: { showFile: true, showCanvas: true, showTool: true, showFrame: true, showSelection: true, showDirty: true, showTimer: false, showLink: false } })?.timestamps).toBeUndefined();
  expect(build({ timing: { startedAt: 0, now: 61_000 } })?.timestamps).toBeUndefined();
  expect(build({ timing: { startedAt: 90_000, now: 60_000 } })?.timestamps).toBeUndefined();
});

test('images use the canvas summary by default and explicit texts when given', () => {
  const asset = build()?.assets;
  expect(asset).toEqual({ large_image: 'pixprite', large_text: '32×48 px · 3 layers' });
  expect(build({}, { largeText: 'Working on a hero', smallImage: 'brush', smallText: 'Pencil' })?.assets).toEqual({
    large_image: 'pixprite', large_text: 'Working on a hero', small_image: 'brush', small_text: 'Pencil',
  });
  expect(build({}, { largeImage: '', smallImage: '' })?.assets).toBeUndefined();
});

test('the link button appears only when enabled and points at the site', () => {
  expect(build()?.buttons).toBeUndefined();
  expect(build({}, { display: { showFile: true, showCanvas: true, showTool: true, showFrame: true, showSelection: true, showDirty: true, showTimer: true, showLink: true } })?.buttons).toEqual([{ label: 'Open Pixprite', url: SITE_URL }]);
});

test('texts are sanitized and clipped to the Discord limit', () => {
  expect(clip('  a\n\nb  ')).toBe('a b');
  expect(clip('\u0000\u0007x')).toBe('x');
  const long = clip('x'.repeat(500));
  expect(long).toHaveLength(MAX_TEXT);
  expect(long.endsWith('…')).toBe(true);
  const activity = build({ doc: doc({ name: 'y'.repeat(400) }) });
  expect(activity?.details).toHaveLength(MAX_TEXT);
});

test('tagAt covers both ends of a tag range', () => {
  const value = doc();
  expect(tagAt(value, 0)?.name).toBe('walk');
  expect(tagAt(value, 2)?.name).toBe('walk');
  expect(tagAt(value, 3)?.name).toBe('idle');
  expect(tagAt(value, 4)).toBeNull();
});

test('the dedupe key ignores the elapsed timer but notices text changes', () => {
  const activity1 = build({});
  const activity2 = build({ timing: { startedAt: 1_000, now: 61_000 + 60_000 } });
  expect(activityKey(activity1)).toBe(activityKey(activity2));
  
  const activity3 = build({ doc: doc({ name: 'different' }) });
  expect(activityKey(activity1)).not.toBe(activityKey(activity3));
  
  expect(activityKey(null)).toBe('');
});

// --- what the bridge forwards -------------------------------------------------------------

test('sanitizeActivity keeps known fields and drops everything else', () => {
  const clean = sanitizeActivity({
    type: 3,
    details: ' Drawing ',
    state: 'x',
    secret: 'dropped',
    timestamps: { start: 1_700_000_000.7, end: 5 },
    assets: { large_image: 'pixprite', large_text: 'Canvas', small_text: 'stray' },
  });
  expect(clean).toEqual({
    type: 3,
    details: 'Drawing',
    timestamps: { start: 1_700_000_001 },
    assets: { large_image: 'pixprite', large_text: 'Canvas' },
  });
});

test('sanitizeActivity rejects unknown activity types and empty activities', () => {
  expect(sanitizeActivity({ type: 1, details: 'Drawing' })?.type).toBe(0);
  expect(sanitizeActivity({ type: 5, details: 'Drawing' })?.type).toBe(5);
  expect(sanitizeActivity({ details: 'x' })).toBeNull();
  expect(sanitizeActivity({})).toBeNull();
  expect(sanitizeActivity(null)).toBeNull();
  expect(sanitizeActivity([1, 2])).toBeNull();
});

test('sanitizeActivity only forwards safe http buttons, at most two', () => {
  const buttons = sanitizeActivity({
    details: 'Drawing',
    buttons: [
      { label: 'Site', url: 'https://example.test/' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      { label: 'Local', url: 'http://localhost:3000/x' },
      { label: 'Extra', url: 'https://example.test/3' },
      { label: 'x'.repeat(40), url: 'https://example.test/4' },
    ],
  })?.buttons;
  expect(buttons).toHaveLength(2);
  expect(buttons?.[0]).toEqual({ label: 'Site', url: 'https://example.test/' });
  expect(buttons?.[1].url).toBe('http://localhost:3000/x');
  expect(sanitizeActivity({ details: 'Drawing', buttons: [{ label: 'Long', url: `https://a.test/${'x'.repeat(600)}` }] })?.buttons)
    .toBeUndefined();
  expect(sanitizeActivity({ details: 'Drawing', buttons: [{ label: 'Long', url: 'https://a.test/' }] })?.buttons?.[0].label)
    .toBe('Long');
});

// --- IPC framing --------------------------------------------------------------------------

test('frames encode the opcode and payload with little-endian lengths and round-trip', () => {
  const frame = { cmd: 'SET_ACTIVITY', args: { pid: 1, activity: { details: 'Пиксель' } }, nonce: 'n' };
  const encoded = encodeFrame(OP.FRAME, frame);
  expect(encoded.readUInt32LE(0)).toBe(OP.FRAME);
  expect(encoded.readUInt32LE(4)).toBe(encoded.length - 8);
  const parsed = decodeFrame(encoded)!;
  expect(parsed.frame).toEqual({ op: OP.FRAME, data: frame });
  expect(parsed.rest).toHaveLength(0);
});

test('frames split across chunks are decoded in order, and incomplete frames wait', () => {
  const one = encodeFrame(OP.PING, { a: 1 });
  const two = encodeFrame(OP.FRAME, { b: '2' });
  const both = Buffer.concat([one, two]);
  expect(decodeFrame(both.subarray(0, 4))).toBeNull();
  expect(decodeFrame(both.subarray(0, one.length - 1))).toBeNull();
  const first = decodeFrame(both)!;
  expect(first.frame).toEqual({ op: OP.PING, data: { a: 1 } });
  const second = decodeFrame(first.rest)!;
  expect(second.frame).toEqual({ op: OP.FRAME, data: { b: '2' } });
});

test('malformed frames are rejected instead of forwarded', () => {
  const huge = Buffer.alloc(8);
  huge.writeUInt32LE(OP.FRAME, 0);
  huge.writeUInt32LE(2_000_000, 4);
  expect(() => decodeFrame(huge)).toThrow('larger than 1 MB');

  const text = Buffer.from('{oops');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(OP.FRAME, 0);
  header.writeUInt32LE(text.length, 4);
  expect(() => decodeFrame(Buffer.concat([header, text]))).toThrow('invalid JSON');
  expect(() => decodeFrame(encodeFrame(OP.FRAME, 'text'))).toThrow('non-object');
  expect(() => decodeFrame(encodeFrame(OP.FRAME, 5))).toThrow('non-object');
});

test('socket candidates differ per platform and never repeat', () => {
  const win = ipcPaths('win32', {});
  expect(win[0]).toBe('\\\\.\\pipe\\discord-ipc-0');
  expect(win).toHaveLength(10);

  const unix = ipcPaths('linux', { XDG_RUNTIME_DIR: '/run/user/7', TMPDIR: '/tmp' });
  expect(unix[0]).toBe(join('/run/user/7', 'discord-ipc-0'));
  expect(unix[10]).toBe(join('/tmp', 'discord-ipc-0'));
  expect(new Set(unix).size).toBe(unix.length);
});

// --- IPC connection -----------------------------------------------------------------------

const servers: Server[] = [];
const sockets: Socket[] = [];
let pipes: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  for (const pipe of pipes.splice(0)) if (process.platform !== 'win32' && existsSync(pipe)) unlinkSync(pipe);
});

const pipePath = () => process.platform === 'win32'
  ? `\\\\.\\pipe\\pixprite-test-${process.pid}-${randomUUID()}`
  : join(tmpdir(), `pixprite-test-${randomUUID()}.sock`);

/** A fake Discord client that answers frames with `handler` */
async function fakeDiscord(handler: (socket: Socket, frame: IpcFrame) => void) {
  const path = pipePath();
  pipes.push(path);
  const server = createServer(socket => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const parsed = decodeFrame(buffer);
        if (!parsed) return;
        buffer = Buffer.from(parsed.rest);
        handler(socket, parsed.frame);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
  servers.push(server);
  return path;
}

/** The thrown DiscordError, or a failed expectation */
async function rejection(promise: Promise<unknown>): Promise<DiscordError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DiscordError) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

test('the bridge handshakes, answers PING, sets and clears the activity on one connection', async () => {
  const seen: IpcFrame[] = [];
  const path = await fakeDiscord((socket, frame) => {
    seen.push(frame);
    if (frame.op === OP.HANDSHAKE) {
      expect(frame.data).toEqual({ v: 1, client_id: '123456789012345678' });
      // Discord acks the handshake with a READY DISPATCH (current builds) or a HANDSHAKE READY (older builds)
      socket.write(encodeFrame(OP.FRAME, { cmd: 'DISPATCH', nonce: 'h', evt: 'READY', data: { v: 1, config: {} } }));
      socket.write(encodeFrame(OP.HANDSHAKE, { evt: 'READY', data: { v: 1, config: {} } }));
      socket.write(encodeFrame(OP.PING, { keep: 1 }));
      return;
    }
    if (frame.op === OP.FRAME && frame.data.cmd === 'SET_ACTIVITY') {
      socket.write(encodeFrame(OP.FRAME, { cmd: frame.data.cmd, evt: null, nonce: frame.data.nonce, data: frame.data.args }));
    }
  });

  const logs: string[] = [];
  const ipc = new DiscordIpc(message => logs.push(message), () => [path]);
  await ipc.connect('123456789012345678');
  expect(ipc.connected).toBe(true);

  const echo = await ipc.setActivity({ type: 0, details: 'Drawing' });
  expect(echo.cmd).toBe('SET_ACTIVITY');
  expect(seen.some(frame => frame.op === OP.PONG)).toBe(true);

  const activity = seen.filter(frame => frame.op === OP.FRAME);
  expect(activity[0].data).toMatchObject({ cmd: 'SET_ACTIVITY', args: { activity: { details: 'Drawing' } } });

  const handshakes = seen.filter(frame => frame.op === OP.HANDSHAKE).length;
  await ipc.clearActivity();
  expect(seen.filter(frame => frame.op === OP.HANDSHAKE)).toHaveLength(handshakes);
  expect(seen.filter(frame => frame.op === OP.FRAME)[1].data).toMatchObject({ args: { activity: null } });

  await ipc.close();
  expect(ipc.connected).toBe(false);
  expect(logs.some(line => line.includes('socket found'))).toBe(true);
});

test('a rejected client id surfaces the Discord close code and message', async () => {
  const path = await fakeDiscord((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.CLOSE, { code: 4000, message: 'Invalid Client ID' }));
  });
  const error = await rejection(new DiscordIpc(() => { }, () => [path]).connect('123456789012345678'));
  expect(error.kind).toBe('discord');
  expect(error.code).toBe(4000);
  expect(error.message).toBe('Invalid Client ID');
});

test('an ERROR frame for one activity rejects that request with Discord\'s reason', async () => {
  const path = await fakeDiscord((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) {
      socket.write(encodeFrame(OP.HANDSHAKE, { evt: 'READY', data: {} }));
    } else if (frame.op === OP.FRAME) {
      socket.write(encodeFrame(OP.FRAME, {
        cmd: frame.data.cmd, evt: 'ERROR', nonce: frame.data.nonce,
        data: { code: 4003, message: 'Activity rejected' },
      }));
    }
  });
  const ipc = new DiscordIpc(() => { }, () => [path]);
  await ipc.connect('123456789012345678');
  const error = await rejection(ipc.setActivity({ details: 'Drawing' }));
  expect(error.kind).toBe('discord');
  expect(error.code).toBe(4003);
  expect(error.message).toBe('Activity rejected');
  expect(ipc.connected).toBe(true);
  await ipc.close();
});

test('a missing socket and a malformed id fail with clear, different reasons', async () => {
  const offline = await rejection(new DiscordIpc(() => { }, () => [pipePath()]).connect('123456789012345678'));
  expect(offline.kind).toBe('offline');
  expect(offline.message).toContain('Discord is not running');

  const invalid = await rejection(new DiscordIpc(() => { }, () => [pipePath()]).connect('nope'));
  expect(invalid.kind).toBe('ipc');
  expect(invalid.message).toContain('15–21 digits');
});

test('requests without a connection fail instead of hanging', async () => {
  const ipc = new DiscordIpc(() => { }, () => [pipePath()]);
  const error = await rejection(ipc.setActivity({ details: 'Drawing' }));
  expect(error.kind).toBe('ipc');
});

test('the activity type survives the panel, the sanitizer and the wire', async () => {
  const activity = build({}, { activityType: 2 }) as DiscordActivity;
  const clean = sanitizeActivity(JSON.parse(JSON.stringify(activity)))!;
  expect(clean.type).toBe(2);
  expect(clean.details).toBe(activity.details);
  expect(clean.state).toBe(activity.state);
});
