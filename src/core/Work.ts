import { t } from "~/core/i18n";
/**
 * Background work: heavy computations (compute.ts) run in a worker with progress and
 * cancellation, falling back to the main thread when workers can't start.
 * `withProgress` shows the progress overlay (modules/Progress) for long operations.
 */

import { compute, type OpName, type Ops } from "~/core/compute";
import { signal } from "@preact/signals-react";

export class Cancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'Cancelled'; }
}

export const isCancelled = (e: unknown) => e instanceof Cancelled;

export type TaskOptions = { onProgress?: (p: number) => void; signal?: AbortSignal; };

/** Workers failed to start once: everything runs on the main thread from then on */
let workersBroken = typeof Worker === 'undefined';

function runInWorker<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions) {
  return new Promise<Ops[K]['result']>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) { return reject(e); }
    const finish = () => { worker.terminate(); opts.signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Cancelled()); };
    opts.signal?.addEventListener('abort', abort);
    worker.onmessage = (e: MessageEvent<{ type: string; value?: number; result?: unknown; message?: string; }>) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.value ?? 0);
      else if (m.type === 'done') { finish(); resolve(m.result as Ops[K]['result']); }
      else { finish(); reject(new Error(m.message)); }
    };
    // The worker script itself failed (not the computation): the caller falls back
    worker.onerror = e => { e.preventDefault(); finish(); reject(Object.assign(new Error('Worker failed'), { workerFailed: true })); };
    // Inputs are copied, so the caller's buffers stay usable
    worker.postMessage({ op, args });
  });
}

/** Same work on the main thread, pausing between items so the page stays responsive and can cancel */
async function runHere<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions) {
  let last = performance.now();
  return compute(op, args, p => opts.onProgress?.(p), async () => {
    if (opts.signal?.aborted) throw new Cancelled();
    if (performance.now() - last > 30) {
      await new Promise(r => setTimeout(r, 0));
      last = performance.now();
      if (opts.signal?.aborted) throw new Cancelled();
    }
  });
}

/** Runs a computation off the main thread when possible. Rejects with `Cancelled` when aborted. */
export async function runTask<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions = {}): Promise<Ops[K]['result']> {
  if (opts.signal?.aborted) throw new Cancelled();
  if (!workersBroken) {
    try {
      return await runInWorker(op, args, opts);
    } catch (e) {
      if (!(e as { workerFailed?: boolean; }).workerFailed) throw e;
      workersBroken = true;
      console.warn('Background worker unavailable, running on the main thread');
    }
  }
  return runHere(op, args, opts);
}

export type Busy = { label: string; progress: number; cancel: () => void; };

/** The operation shown in the progress overlay (null when nothing long is running) */
export const busy = signal<Busy | null>(null);

/**
 * Runs `fn` with a progress overlay that appears if it takes longer than `delay` ms.
 * Cancel aborts the signal passed to `fn`; the promise then rejects with `Cancelled`.
 */
export async function withProgress<T>(label: string, fn: (onProgress: (p: number) => void, signal: AbortSignal) => Promise<T>, delay = 250): Promise<T> {
  const ctrl = new AbortController();
  let progress = -1;
  const entry = () => ({ label, progress, cancel: () => ctrl.abort() });
  const timer = setTimeout(() => { busy.value = entry(); }, delay);
  try {
    return await fn(p => {
      progress = p;
      if (busy.value?.label === label) busy.value = entry();
    }, ctrl.signal);
  } finally {
    clearTimeout(timer);
    if (busy.value?.label === label) busy.value = null;
  }
}

/** GIF encoding off the main thread, with the progress overlay */
export function encodeGifInBackground(width: number, height: number, frames: { data: Uint8ClampedArray; delay: number; }[], loop = true) {
  return withProgress(t('progress.encodingGif'), (onProgress, signal) => runTask('gif', { width, height, frames, loop }, { onProgress, signal }));
}

/** Palette extraction off the main thread, with the progress overlay */
export function paletteInBackground(buffers: Uint32Array[], count: number, includeAlpha: boolean) {
  return withProgress(t('progress.buildingPalette'), (onProgress, signal) => runTask('palette', { buffers, count, includeAlpha }, { onProgress, signal }));
}
