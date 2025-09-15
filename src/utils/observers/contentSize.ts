import { getValue } from "$utils/signals";
import { computed, effect, signal, Signal } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";
import { resizeObserver } from "@vicimpa/observers";

export function contentSize(el: HTMLElement | null | Signal<HTMLElement | null>) {
  var _dispose = () => { };
  const size = signal(vec2(), {
    watched() {
      _dispose = effect(() => {
        return resizeObserver(getValue(el), ({ contentRect: { width, height } }) => {
          const newSize = vec2(width, height);
          if (size.value.equals(newSize))
            return;
          size.value = newSize;
        });
      });
    },
    unwatched() {
      _dispose();
    }
  });

  return computed(() => size.value);
}