import { computed, Signal, signal } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";
import { signalSize } from "./signalSize";
import { getValue, type GV } from "$utils/signals";
import { useMemo } from "react";
import { signalPos } from "./signalPos";

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

export function signalMouse<T extends HTMLElement>(
  offset?: GV<T | null>,
  clamp?: boolean,
  normalize?: boolean,
) {
  const pos = signalPos(offset ?? null);
  const size = signalSize(offset ?? null);

  return computed(() => {
    offset = getValue(offset);

    if (!offset)
      return mouse.value.clone();

    const current = mouse.value.clone()
      .sub(pos.value);

    if (clamp) {
      current.max(current, 0);
      current.min(current, size.value);
    }

    if (normalize) {
      current.div(size.value);
    }

    return current;
  });
}

export function useSignalMouse<T extends HTMLElement>(
  offset?: GV<T | null>,
  clamp?: boolean,
  normalize?: boolean,
) {
  return useMemo(() => signalMouse(offset, clamp, normalize), [offset, clamp, normalize]);
}