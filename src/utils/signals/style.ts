import { computed, signal } from "@preact/signals-react";

export function style<K extends keyof CSSStyleDeclaration>(
  el: HTMLElement, key: K
) {
  const version = signal(0);
  const observer = new MutationObserver(() => {
    version.value++;
    console.log('Hi');
  });

  return computed(() => (version.value, getComputedStyle(el)[key]), {
    watched() {
      observer.observe(el, { attributes: true });
    },
    unwatched() {
      observer.disconnect();
    }
  });
}