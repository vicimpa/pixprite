import '../src/index';
import { Sprite } from '../src/core/Sprite';
import { state } from '../src/core/State';
import { runTask } from '../src/core/BackgroundTask';
import { IncrementalDocument } from '../src/core/IncrementalDocument';
import { loadProjectData, loadSession, saveProjectData } from '../src/core/Projects';
import { retainedHistoryMemory } from '../src/core/SpriteHistory';
import type { SpriteContext } from '../src/core/SpriteContext';
import { fixture } from './fixtures';
import type { Scenario } from './scenarios';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const now = () => performance.now();
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const hash = (bytes: Uint8Array | Uint8ClampedArray) => {
  let h = 2166136261;
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
};
const hashPixels = (data: Uint32Array) => hash(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
function signature(doc: Sprite) {
  const raw = doc.captureDocument();
  const aliases = doc.layers.map(layer => layer.cels.map(cel => cel ? layer.cels.indexOf(cel) : -1));
  return JSON.stringify({ ...raw,
    images: raw.images.map(image => ({ ...image, d: hashPixels(image.d) })),
    tilesets: raw.tilesets.map(ts => ({ ...ts, d: Array.isArray(ts.d) ? ts.d.map(hashPixels) : hashPixels(ts.d) })),
    layers: raw.layers.map(layer => ({ ...layer, cels: layer.cels.map(cel => cel?.t ? { ...cel, t: hashPixels(cel.t) } : cel) })), aliases,
  });
}
function composite(doc: Sprite, at = 0) {
  return doc.render(at).getContext('2d')!.getImageData(0, 0, doc.width, doc.height).data;
}

// Installed before any benchmark tasks. Real Workers execute the unmodified production module.
type WorkerSpan = { op: string; start: number; end: number | null; outcome: string };
const workers: WorkerSpan[] = [];
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  span?: WorkerSpan;
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.addEventListener('message', e => {
      if (this.span && e.data.type !== 'progress') { this.span.end = now(); this.span.outcome = e.data.type; }
    });
  }
  override postMessage(message: any, options?: any) {
    this.span = { op: message.op, start: now(), end: null, outcome: 'running' };
    workers.push(this.span);
    super.postMessage(message, options);
  }
  override terminate() {
    if (this.span && this.span.end === null) { this.span.end = now(); this.span.outcome = 'terminated'; }
    super.terminate();
  }
};
const activePreparations = () => workers.filter(w => w.op === 'prepareDocument' && w.end === null).length;

let doc: Sprite;
let autosaveFinished: Promise<void> | undefined;
let pending: { start: number; overlap: boolean; down: boolean }[] = [];
let latency: number[] = [], overlapLatency: number[] = [], downLatency: number[] = [], overlapDownLatency: number[] = [], renderTimes: number[] = [];
let tracking = false, queued = false, eventCount = 0, downCount = 0;
let measureStart = 0;
let editorBeforeHash = '';
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
  (drawImage as any).apply(this, args);
  // The actual editor's Canvas loop composites the brush preview and sprite before this microtask.
  if (!tracking || queued || !this.canvas.closest('[data-testid="sprite-canvas"]')) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (!tracking) return;
    const end = now(); renderTimes.push(end);
    for (const event of pending) {
      const value = end - event.start;
      if (event.down) {
        downLatency.push(value);
        if (event.overlap) overlapDownLatency.push(value);
      } else {
        latency.push(value);
        if (event.overlap) overlapLatency.push(value);
      }
    }
    pending = [];
  });
};
document.addEventListener('pointermove', e => {
  if (!tracking || !e.isTrusted || !(e.buttons & 1) || !(e.target as Element)?.closest('[data-testid="sprite-canvas"]')) return;
  eventCount++;
  pending.push({ start: e.timeStamp, overlap: activePreparations() > 0, down: false });
}, true);

// Observe before React paints the first pixel and cancels its obsolete autosave Worker.
// Keep down samples separate: existing pointermove latency/FPS fields remain comparable.
document.addEventListener('pointerdown', e => {
  if (!tracking || !e.isTrusted || e.button !== 0 || !(e.target as Element)?.closest('[data-testid="sprite-canvas"]')) return;
  downCount++;
  pending.push({ start: e.timeStamp, overlap: activePreparations() > 0, down: true });
}, true);

async function clearStorage() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixprite');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (db.objectStoreNames.length) await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], 'readwrite', { durability: 'strict' });
    for (const store of db.objectStoreNames) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function core(config: Scenario) {
  const built = fixture(config); doc = built.doc;
  const expected = signature(doc), originalComposite = hash(composite(doc));
  const cache = new IncrementalDocument();
  const saveStart = now();
  const capture = cache.capture(doc, true);
  const prepared = await runTask('prepareDocument', { raw: capture.raw, preview: capture.preview });
  const thumb = capture.accept(prepared.data, prepared.thumb);
  await saveProjectData({ id: 'benchmark', name: doc.name, width: doc.width, height: doc.height,
    frames: doc.frames.length, layers: doc.layers.length, colorMode: doc.colorMode,
    created: 0, updated: 0, thumb }, prepared.data);
  const saveMs = now() - saveStart;
  const openStart = now();
  const loaded = new Sprite(1, 1);
  await loaded.loadAsync(await loadProjectData('benchmark'));
  const openMs = now() - openStart;
  assert(signature(loaded) === expected, 'Saved sources, metadata, tile refs or linked aliases changed');
  const compositeHashes = [...new Set([0, Math.floor(doc.frames.length / 2), doc.frames.length - 1])].map(at => {
    const expectedHash = hash(composite(doc, at));
    assert(hash(composite(loaded, at)) === expectedHash, `Opened frame ${at} composite mismatch`);
    return { frame: at, hash: expectedHash };
  });
  const exportStart = now();
  const output = await runTask('export', { raw: doc.captureDocument(), opts: { kind: 'png', scale: 1 },
    base: doc.name, frames: [0], areas: { 0: { x: 0, y: 0, w: doc.width, h: doc.height } },
    grid: { gridX: 0, gridY: 0, gridW: 16, gridH: 16 } });
  const exportMs = now() - exportStart;
  assert(Array.isArray(output) && output.length === 1, 'PNG export missing');
  if (!Array.isArray(output)) throw new Error('Unexpected video export');
  const bitmap = await createImageBitmap(output[0].blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close();
  assert(hash(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data) === originalComposite, 'PNG pixels changed');
  // Real retained history: 16 pixel edits, then undo/redo, preserving the fixture dimensions.
  for (let i = 0; i < 16; i++) {
    doc.checkpoint(`Benchmark edit ${i}`);
    if (doc.current.tileset >= 0) { doc.setInfo({ description: `Metadata edit ${i}` }); continue; }
    const data = doc.canvasPixels(); data[i % data.length] ^= 0x00ffffff;
    doc.putCanvas(data);
  }
  doc.undo(); doc.redo();
  const history = retainedHistoryMemory.call(doc as unknown as SpriteContext);
  assert(history.undoSteps === 16 && history.redoSteps === 0, 'Undo workload did not run');
  assert(workers.length > 0 && workers.every(w => w.outcome === 'done'), 'Worker task failed or fell back');
  return { config, sourcePixels: built.sourcePixels, saveMs, openMs, exportMs, exportBytes: output[0].blob.size,
    dirtyResources: capture.dirtyResources, history, correctness: { signatureHash: hash(new TextEncoder().encode(expected)), compositeHashes, pngHash: originalComposite, sourceAndAliasRoundTrip: true },
    workerTasks: workers.slice() };
}

async function installEditor(config: Scenario) {
  doc = fixture(config).doc;
  state.prefs.autosave = false;
  state.openDocument(doc); state.tool = 'pencil'; state.fit();
  doc.layer = doc.layers.length - 1; // Draw on the visible top layer of opaque fixtures.
  await frame(); await frame();
  editorBeforeHash = hash(composite(doc));
  return { width: doc.width, height: doc.height, zoom: state.zoom, ox: state.offsetX, oy: state.offsetY };
}
function startTracking() {
  latency = []; overlapLatency = []; downLatency = []; overlapDownLatency = []; renderTimes = []; pending = []; eventCount = 0; downCount = 0;
  measureStart = now(); tracking = true;
}
async function finishTracking(requireOverlap: boolean) {
  await frame(); await frame();
  const elapsedMs = now() - measureStart;
  tracking = false;
  const afterHash = hash(composite(doc));
  assert(afterHash !== editorBeforeHash, 'Stroke did not change document pixels');
  const sample = { elapsedMs, renderedFrames: renderTimes.length, fps: renderTimes.length * 1000 / elapsedMs,
    inputLatencyMs: latency, autosaveInputLatencyMs: overlapLatency, trustedPointerMoves: eventCount,
    autosaveMoveOverlapUnavailableReason: overlapLatency.length ? null : 'No trusted pointermove overlapped preparation; pointerdown may have cancelled the Worker',
    pointerDownLatencyMs: downLatency, autosavePointerDownLatencyMs: overlapDownLatency, trustedPointerDowns: downCount,
    renderedPointerDownSamples: downLatency.length,
    renderedInputSamples: latency.length, workerSpans: workers.slice(), history: retainedHistoryMemory.call(doc as unknown as SpriteContext),
    correctness: { beforeCompositeHash: editorBeforeHash, afterCompositeHash: afterHash, pixelsChanged: true } };
  assert(eventCount > 0 && latency.length === eventCount, 'Trusted pointer input did not reach a rendered editor frame');
  assert(doc.undoDepth > 0, 'Stroke did not create undo history');
  assert(downCount > 0 && downLatency.length === downCount, 'Trusted pointerdown did not reach a rendered editor frame');
  if (requireOverlap) assert(overlapLatency.length > 0 || overlapDownLatency.length > 0, 'No drawing pointerdown or pointermove overlapped a real prepareDocument Worker');
  return sample;
}
function scheduleAutosave() {
  state.prefs.autosave = true;
  doc.touch(); state.save();
}
async function finishAutosave() {
  autosaveFinished = state.persist();
  await autosaveFinished;
  const saved = await loadSession(doc.sessionId!);
  assert(saved, 'Autosave did not commit');
  const loaded = new Sprite(1, 1); await loaded.loadAsync(saved!.data);
  assert(signature(loaded) === signature(doc), 'Autosaved stroke differs from live pixels/links');
  assert(doc.storedVersion === doc.version, 'Autosave did not finish latest version');
  return { correctness: true, workerTasks: workers.slice() };
}

Object.assign(window, { benchmark: { core, installEditor, startTracking, finishTracking, scheduleAutosave, finishAutosave, activePreparations, clearStorage } });
