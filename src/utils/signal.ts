import { signal, Signal } from "@preact/signals-react";
import { type RefObject } from "react";

export type SignalRef<T> = Signal<T | null> & RefObject<T | null>;

export function signalRef<T>() {
  return Object.defineProperties(
    signal<T | null>(null),
    {
      current: {
        get(this: Signal<T | null>) {
          return this.value;
        },
        set(this: Signal<T | null>, value: T) {
          this.value = value;
        }
      }
    }
  ) as SignalRef<T>;
}