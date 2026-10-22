export type Dispose = (() => void) | void;

export function dispose(...args: Dispose[]) {
  return () => {
    args.forEach(fn => {
      try { fn?.(); }
      catch (e) { console.error(e); }
    });
  };
}