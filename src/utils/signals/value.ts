import { Signal, untracked } from "@preact/signals-react";

export function value<T>(o: T | Signal<T> | (() => T), pick = false): T {
  if (pick)
    return untracked(() => value(o));

  if (o instanceof Function)
    return o();

  if (o instanceof Signal)
    return o.value;

  return o;
}