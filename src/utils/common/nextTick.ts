import type { Dispose } from "./dispose";

export function nextTick(fn: () => any): Dispose {
  var actual = true;
  Promise.resolve()
    .then(() => actual && fn());

  return () => { actual = false; };
}