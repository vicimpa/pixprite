import { getValue, type GV } from "$utils/signals";
import { computed, effect, signal } from "@preact/signals-react";
import { intersectionObserver } from "@vicimpa/observers";
import { useMemo } from "react";

export function signalIntersect<T extends HTMLElement>(el: GV<T | null>) {
  var _dispose = () => { };
  const size = signal(false, {
    watched() {
      _dispose = effect(() => {
        return intersectionObserver(getValue(el), ({ isIntersecting }) => {
          size.value = isIntersecting;
        });
      });
    },
    unwatched() {
      _dispose();
    }
  });

  return computed(() => size.value);
}

export function useSignalIntersect<T extends HTMLElement>(el: GV<T | null>) {
  return useMemo(() => signalIntersect(el), [el]);
}