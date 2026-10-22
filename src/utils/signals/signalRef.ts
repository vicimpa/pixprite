import { Signal, signal } from "@preact/signals-react";
import { createRef, type RefObject } from "react";

export type SignalRef<T> = Signal<T> & RefObject<T>;

function signalRef<T>(initial: T): SignalRef<T>;
function signalRef<T>(initial?: null): SignalRef<T | null>;
function signalRef(initial?: any) {
  return Object.defineProperties<SignalRef<any>>(
    Object.assign(
      signal(initial ?? null),
      createRef(),
    ),
    {
      current: {
        get(this: SignalRef<any>) {
          return this.value;
        },
        set(this: SignalRef<any>, v) {
          this.value = v;
        },
      }
    }
  );
}

export { signalRef };
