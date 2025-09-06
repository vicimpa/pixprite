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
