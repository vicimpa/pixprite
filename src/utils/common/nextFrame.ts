import type { Dispose } from "./dispose";

export function nextFrame(fn: () => any): Dispose {
  const raf = requestAnimationFrame(fn);
  return () => { cancelAnimationFrame(raf); };
}