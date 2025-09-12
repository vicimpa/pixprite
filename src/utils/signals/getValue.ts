import { Signal, untracked } from "@preact/signals-react";

export type GV<T> = T | Signal<T> | (() => T);

export function getValue<T>(o: GV<T>, pick = false): T {
  if (pick)
    return untracked(() => getValue(o));

  if (o instanceof Function)
    return o();

  if (o instanceof Signal)
    return o.value;

  return o;
}