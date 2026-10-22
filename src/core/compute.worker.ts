/** Worker side of Work.ts: one task per worker, progress and result sent back */

import { compute, transferables, type OpName, type Ops } from "~/core/compute";

const port = self as unknown as Worker;

port.onmessage = async (e: MessageEvent<{ op: OpName; args: Ops[OpName]['args']; }>) => {
  const { op, args } = e.data;
  let last = 0;
  try {
    const result = await compute(op, args, p => {
      // Progress at most ~20 times a second
      const now = performance.now();
      if (now - last < 50 && p < 1) return;
      last = now;
      port.postMessage({ type: 'progress', value: p });
    });
    port.postMessage({ type: 'done', result }, transferables(result));
  } catch (err) {
    port.postMessage({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
