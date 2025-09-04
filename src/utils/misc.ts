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
  return n.toString(16).padStart(2, '0');
};

export function nextTick(fn: () => any) {
  Promise.resolve().then(fn);
}

export function array<T>(size: number, func: (i: number) => T) {
  return Array.from({ length: size }, (_, i) => func(i));
}