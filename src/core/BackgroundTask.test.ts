import { afterEach, expect, test } from 'bun:test';
import { Cancelled, runTask } from './BackgroundTask';

const originalWorker = globalThis.Worker;
afterEach(() => { globalThis.Worker = originalWorker; });

test('the demand-loaded fallback captures inputs before the caller can change them', async () => {
  globalThis.Worker = undefined as unknown as typeof Worker;
  const args = { data: { bytes: [1, 2, 3] } };
  const task = runTask('stringify', args);
  args.data.bytes[0] = 99;
  expect(await task).toBe('{"bytes":[1,2,3]}');
});

test('cancelling while the fallback module loads never executes the task', async () => {
  globalThis.Worker = undefined as unknown as typeof Worker;
  const controller = new AbortController();
  let progress = 0;
  const task = runTask('gif', { width: 1, height: 1, frames: [], loop: true }, {
    signal: controller.signal, onProgress: () => { progress++; },
  });
  controller.abort();
  await expect(task).rejects.toBeInstanceOf(Cancelled);
  expect(progress).toBe(0);
});
