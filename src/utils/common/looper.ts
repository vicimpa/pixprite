import type { Dispose } from "./dispose";

export function looper(fn: (delta: number, time: number) => any): Dispose {
  var time = performance.now(), raf = requestAnimationFrame(_loop);

  function _loop(now: number) {
    raf = requestAnimationFrame(_loop);
    fn(now - time, time - now);
  }

  return () => {
    cancelAnimationFrame(raf);
  };
}