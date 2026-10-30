import { t } from "~/core/i18n";
/**
 * Background work: heavy computations (compute.ts) run in a worker with progress and
 * cancellation, falling back to the main thread when workers can't start.
 * `withProgress` shows the progress overlay (modules/Progress) for long operations.
 */

import { signal } from "@preact/signals-react";

export { runTask, Cancelled, isCancelled, type TaskOptions } from './BackgroundTask';
import { runTask } from './BackgroundTask';

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
