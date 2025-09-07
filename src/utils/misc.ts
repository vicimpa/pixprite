export type Dispose = (() => void) | void;

export function dispose(...funcs: Dispose[]) {
  return () => {
    funcs.forEach(func => {
      try {
        func?.();
      } catch (e) {
        console.error(e);
      }
    });
  };
}

export const byteHex = (n: number) => {
  return (n | 0).toString(16).padStart(2, '0').toUpperCase();
};

export function nextTick(fn: () => any) {
  var actual = true;
  Promise.resolve().then(() => actual && fn());
  return () => { actual = false; };
}

export function nextFrame(fn: () => any) {
  const raf = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(raf);
}

export function array<T>(size: number, func: (i: number) => T) {
  return Array.from({ length: size }, (_, i) => func(i));
}

export function looper(fn: (delta: number, time: number) => any) {
  var raf = requestAnimationFrame(_loop), time = performance.now();

  function _loop(now: number) {
    raf = requestAnimationFrame(_loop);
    fn(now - time, time = now);
  }

  return () => {
    cancelAnimationFrame(raf);
  };
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}