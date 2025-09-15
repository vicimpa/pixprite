import { looper } from "$utils/common";
import { getValue, type GV } from "$utils/signals";
import { computed, effect, signal } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";
import { useMemo } from "react";

export function signalPos<T extends HTMLElement>(el: GV<T | null>) {
  var _dispose = () => { };
  const pos = signal(vec2(), {
    watched() {
      _dispose = effect(() => {
        const current = getValue(el);

        if (!current)
          return;

        return looper(() => {
          const newPos = vec2().copy(current.getBoundingClientRect());
          if (!newPos.equals(pos.value))
            pos.value = newPos;
        });
      });
    },
    unwatched() {
      _dispose();
    }
  });

  return computed(() => pos.value);
}

export function useSignalPos<T extends HTMLElement>(el: GV<T | null>) {
  return useMemo(() => signalPos(el), [el]);
}