import type { AutomationRequest, DesktopBridge, DesktopFile } from '../../desktop/protocol';
import { editMethods } from '../../desktop/protocol';
import { state, flushEditorSettings } from './State';
import { samplePerformance } from './Performance';
import { Color } from './Color';
import { loadFiles, readDocument } from './Files';
import { runTask } from './BackgroundTask';
import { COMMANDS, available, commandLabel, commandSchema, runCommand } from './Commands';
import { ExtensionHost } from './extensions/Host';
import { docId, docInfo, snapshot, spriteHandlers } from './extensions/api/sprite';
import type { Call } from './extensions/api/common';
import type { Method } from './extensions/protocol';
import { hasDialogs } from '~/ui/Dialog';
import { windowSessionKey, windowRunningKey } from './WindowSession';

function bytes(data: unknown) {
  if (typeof data !== 'string' || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Expected base64 data');
  return Uint8ClampedArray.from(atob(data), char => char.charCodeAt(0));
}
function base64(data: ArrayBuffer | Uint8ClampedArray) {
  const array = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(binary);
}
const integer = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
function active() {
  if (state.home || !state.docs.includes(state.sprite)) throw new Error('No active document');
  return state.sprite;
}
async function png(frame: unknown, scale: unknown) {
  const doc = active();
  const f = integer(frame ?? doc.frame, 'frame', 0, doc.frames.length - 1);
  const s = integer(scale ?? 1, 'scale', 1, 16);
  if (Math.max(doc.width, doc.height) * s > 4096) throw new Error('Rendered image exceeds 4096 pixels per side');
  const canvas = new OffscreenCanvas(doc.width * s, doc.height * s);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(doc.render(f), 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Installed only by the native preload. The website never opens a local control port. */
export function installDesktop(ready: Promise<unknown>) {
  const bridge = window.pixpriteDesktop;
  if (!bridge) return;
  window.addEventListener('pixprite:notice', event => state.showTip(String((event as CustomEvent).detail), 5000));
  // Reuse the editor's validated document API and history/lock handling, without starting a worker.
  const host = new ExtensionHost({
    id: 'local-mcp', manifest: { id: 'local-mcp', name: 'Local MCP', version: '1.0.0', apiVersion: 1, permissions: ['sprite:read', 'sprite:write'] },
    files: {}, source: 'file', enabled: true, installedAt: 0,
  });
  const call: Call = { host, endpoint: { role: 'worker', post() {}, subs: new Map() } };
  const handler = (method: string, args: unknown[], context = call) => {
    const fn = spriteHandlers[method as Method];
    if (!fn) throw new Error(`Unknown document API method: ${method}`);
    return fn(context, ...args);
  };
  async function execute({ method, params: p = {} }: AutomationRequest): Promise<unknown> {
    if (method === 'prepare_close') {
      await state.persist();
      flushEditorSettings();
      const session = JSON.parse(localStorage.getItem(windowSessionKey()) ?? 'null');
      if (!session || state.docs.some(doc => !doc.sessionId || doc.storedVersion !== doc.version || !session.tabs?.includes(doc.sessionId))
        || session.active !== (state.home ? 'home' : state.sprite.sessionId)) throw new Error('Could not save the complete session; the editor will stay open');
      if (method === 'prepare_close') localStorage.removeItem(windowRunningKey());
      return { saved: true };
    }
    if (method === 'performance') return samplePerformance(p.durationMs === undefined ? undefined : integer(p.durationMs, 'durationMs', 100, 5000));
    if (method === 'documents') return { documents: state.docs.map(docInfo), active: state.home ? null : docId(state.sprite) };
    if (method === 'inspect') return snapshot(active());
    if (method === 'preview') return { image: base64(await (await png(p.frame, p.scale)).arrayBuffer()) };
    if (method === 'commands') {
      const filter = String(p.filter ?? '').toLowerCase();
      return COMMANDS.filter(command => available(command) && `${command.id} ${commandLabel(command)}`.toLowerCase().includes(filter))
        .map(command => ({ id: command.id, label: commandLabel(command), params: commandSchema(command) }));
    }
    if (hasDialogs()) throw new Error('Close the open dialog before editing through MCP');
    if (state.playing) throw new Error('Stop playback before editing through MCP');
    if (method === 'create') {
      handler('documents.create', [{ ...p, width: integer(p.width, 'width', 1, 4096), height: integer(p.height, 'height', 1, 4096) }]);
      state.save(); return snapshot(active());
    }
    if (method === 'select') {
      const doc = state.docs.find(doc => docId(doc) === p.id);
      if (!doc) throw new Error('Document ID is not open');
      state.switchTo(doc); return snapshot(doc);
    }
    if (method === 'open_data') {
      if (typeof p.name !== 'string') throw new Error('File name is required');
      const doc = await readDocument(new File([bytes(p.data)], p.name));
      state.openDocument(doc); state.save(); return snapshot(doc);
    }
    if (method === 'export_data') {
      const doc = active();
      const blob = p.format === 'png' ? await png(undefined, 1)
        : p.format === 'pixprite' || p.format === 'aseprite'
          ? await runTask('projectFile', { raw: doc.captureDocument(), format: p.format, palette: state.palette.slice() })
          : (() => { throw new Error('Unsupported export format'); })();
      return { data: base64(await blob.arrayBuffer()) };
    }
    if (method === 'pixels') {
      const doc = active();
      const layer = integer(p.layer ?? doc.layer, 'layer', 0, doc.layers.length - 1);
      const frame = integer(p.frame ?? doc.frame, 'frame', 0, doc.frames.length - 1);
      const r = p.rect as Record<string, unknown> | undefined;
      const rect = { x: integer(r?.x ?? 0, 'x', 0, doc.width - 1), y: integer(r?.y ?? 0, 'y', 0, doc.height - 1),
        w: integer(r?.w ?? doc.width, 'w', 1, doc.width), h: integer(r?.h ?? doc.height, 'h', 1, doc.height) };
      if (rect.x + rect.w > doc.width || rect.y + rect.h > doc.height || rect.w * rect.h > 1_048_576) throw new Error('Pixel rect must fit the canvas and contain at most 1,048,576 pixels');
      if (p.action === 'read') {
        const pixels = handler('sprite.getPixels', [layer, frame, rect, 'rgba']) as { data: Uint8ClampedArray };
        return { rect, format: 'rgba', data: base64(pixels.data) };
      }
      if (p.action !== 'write') throw new Error('Pixel action must be read or write');
      if ((p.fill === undefined) === (p.data === undefined)) throw new Error('A pixel write requires exactly one of data or fill');
      let data: Uint8ClampedArray;
      if (p.fill !== undefined) {
        if (typeof p.fill !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(p.fill)) throw new Error('fill must be #RRGGBB or #RRGGBBAA');
        const [r, g, b, alpha] = Color.fromHex(p.fill).rgba;
        const rgba = [r, g, b, Math.round(alpha * 255)];
        data = new Uint8ClampedArray(rect.w * rect.h * 4);
        for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
      } else data = bytes(p.data);
      if (data.length !== rect.w * rect.h * 4) throw new Error('RGBA byte count does not match rect');
      handler('sprite.putPixels', [layer, frame, { rect, format: 'rgba', data }]);
      return { layer, frame, rect };
    }
    if (method === 'edit') {
      const doc = active();
      if (!Array.isArray(p.operations) || p.operations.length < 1 || p.operations.length > 128) throw new Error('Expected 1..128 operations');
      const operations = p.operations as { method: string; args: unknown[] }[];
      for (const op of operations) if (!op || !(editMethods as readonly string[]).includes(op.method) || !Array.isArray(op.args)) throw new Error('Invalid batch operation');
      const tx = host.beginTransaction(doc);
      doc.checkpoint(typeof p.label === 'string' ? p.label : 'MCP edit');
      try {
        const results = [];
        for (const op of operations) results.push(await handler(op.method, op.args, { ...call, tx }));
        handler('sprite.transaction.end', [tx, true]);
        return { results, document: snapshot(doc) };
      } catch (error) { handler('sprite.transaction.end', [tx, false]); throw error; }
    }
    if (method === 'command') {
      if (typeof p.id !== 'string') throw new Error('Command ID is required');
      const command = COMMANDS.find(command => command.id === p.id);
      if (!command || !available(command)) throw new Error('Command is not available');
      if (commandSchema(command) && p.args === undefined) throw new Error('This command requires args; inspect pixprite_commands for its schema');
      await runCommand(p.id, p.args as Parameters<typeof runCommand>[1]);
      return { executed: p.id };
    }
    if (method === 'history') {
      const doc = active();
      if (p.action === 'undo') doc.undo(); else if (p.action === 'redo') doc.redo(); else throw new Error('Expected undo or redo');
      state.save(); return snapshot(doc);
    }
    throw new Error(`Unknown automation method: ${method}`);
  }
  let queue: Promise<unknown> = ready;
  const enqueue = <T>(fn: () => Promise<T>) => {
    const operation = queue.then(fn);
    queue = operation.catch(() => {});
    return operation;
  };
  bridge.onRequest(request => enqueue(() => execute(request)));
  bridge.onFiles((files: DesktopFile[]) => enqueue(async () => {
    await loadFiles(files.map(file => new File([bytes(file.data)], file.name)), undefined, 'tabs');
  }));
}
