import { computed, Signal, signal } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";

var ctrl = new AbortController();

const _mouse = signal(
  vec2().freeze(),
  {
    watched() {
      ctrl = new AbortController();
      addEventListener('mousemove', update, ctrl);
      addEventListener('mousedown', update, ctrl);
      addEventListener('mouseup', update, ctrl);
      addEventListener('wheel', update, ctrl);
    },
    unwatched() {
      ctrl.abort();
    }
  }
);

export const mouse = computed(() => _mouse.value);

function update(e: MouseEvent | WheelEvent) {
  if (!_mouse.value.equals(e))
    _mouse.value = vec2().copy(e).freeze();
}

export function mouseOffset(
  el: HTMLElement | null | Signal<HTMLElement | null>,
  clamp?: boolean,
  normalize?: boolean,
) {
  return computed(() => {
    if (el instanceof Signal)
      el = el.value;

    if (!el)
      return null;
    const rect = el.getBoundingClientRect();
    const size = vec2(rect.width, rect.height);
    const offseetMouse = mouse.value.clone().sub(rect);

    if (clamp) {
      offseetMouse.max(offseetMouse, 0);
      offseetMouse.min(offseetMouse, size);
    }

    if (normalize) {
      offseetMouse.div(size);
    }

    return offseetMouse;
  });
}