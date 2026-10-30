/** Worker task transport, independent of UI state and translations. */
import type { OpName, Ops } from './compute';

export class Cancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'Cancelled'; }
}

export const isCancelled = (e: unknown) => e instanceof Cancelled;

export type TaskOptions = { onProgress?: (p: number) => void; signal?: AbortSignal; };

/** Workers failed to start once: everything runs on the main thread from then on */
let workersBroken = false;

export class BackgroundWorkerError extends Error {
  constructor(message: string) { super(message); this.name = 'BackgroundWorkerError'; }
}

function runInWorker<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions) {
  return new Promise<Ops[K]['result']>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      const unavailable = e instanceof DOMException && ['SecurityError', 'NotSupportedError'].includes(e.name);
      return reject(unavailable ? Object.assign(new Error('Background worker unavailable', { cause: e }), { workerFailed: true }) : e);
    }
    const finish = () => { worker.terminate(); opts.signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Cancelled()); };
    opts.signal?.addEventListener('abort', abort);
    if (opts.signal?.aborted) return abort();
    worker.onmessage = (e: MessageEvent<{ type: string; value?: number; result?: unknown; message?: string; }>) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.value ?? 0);
      else if (m.type === 'done') { finish(); resolve(m.result as Ops[K]['result']); }
      else { finish(); reject(new Error(m.message)); }
    };
    // Runtime/module failures must be visible; silently retrying here hides worker defects.
    worker.onerror = e => { e.preventDefault(); finish(); reject(new BackgroundWorkerError(e.message || 'Background worker failed')); };
    worker.onmessageerror = () => { finish(); reject(new BackgroundWorkerError('Invalid background worker response')); };
    // Inputs are copied, so the caller's buffers stay usable
    try { worker.postMessage({ op, args }); } catch (e) { finish(); reject(e); }
  });
}

/** Same work on the main thread, pausing between items so the page stays responsive and can cancel */
async function runHere<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions) {
  // Capture before the import yields: callers may keep editing their buffers meanwhile.
  const captured = structuredClone(args);
  const { compute } = await import('./compute');
  if (opts.signal?.aborted) throw new Cancelled();
  let last = performance.now();
  const result = await compute(op, captured, p => opts.onProgress?.(p), async () => {
    if (opts.signal?.aborted) throw new Cancelled();
    if (performance.now() - last > 30) {
      await new Promise(r => setTimeout(r, 0));
      last = performance.now();
      if (opts.signal?.aborted) throw new Cancelled();
    }
  });
  if (opts.signal?.aborted) throw new Cancelled();
  return result;
}

/** Runs a computation off the main thread when possible. Rejects with `Cancelled` when aborted. */
export async function runTask<K extends OpName>(op: K, args: Ops[K]['args'], opts: TaskOptions = {}): Promise<Ops[K]['result']> {
  if (opts.signal?.aborted) throw new Cancelled();
  if (!workersBroken && typeof Worker !== 'undefined') {
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

