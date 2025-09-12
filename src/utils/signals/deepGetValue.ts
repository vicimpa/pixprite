import { Signal } from "@preact/signals-react";
import { getValue, type GV } from "./getValue";

export type DGVR<T> =
  T extends Signal<infer P> ? DGVR<P>
  : T extends () => infer P ? DGVR<P>
  : T extends (infer P)[] ? DGVR<P>[]
  : T extends object ? { [K in keyof T]: DGVR<T[K]> }
  : T;

export type DGV<T> =
  T extends (infer P)[] ? GV<DGV<P>>[]
  : T extends object ? { [K in keyof T]: DGV<T[K]> }
  : GV<T>;

export function deepGetValue<T>(value: T, peek = false): DGVR<T> {
  value = getValue(value, peek);

  if (!value || typeof value !== 'object')
    return value as any;

  if (Array.isArray(value))
    return value.map(e => deepGetValue(e, peek)) as any;

  return Object.entries(value)
    .reduce((acc, [key, value]) => (
      Object.assign(acc, {
        [key]: deepGetValue(value, peek)
      })
    ), {}) as any;
}