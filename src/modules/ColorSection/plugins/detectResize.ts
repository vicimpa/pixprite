import { resizeObserver } from "@vicimpa/observers";
import type { ColorList } from "../ColorList";
import { effect } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";

export default (self: ColorList) => (
  effect(() => {
    const { value: ref } = self.ref;
    if (!ref) return;

    return resizeObserver(ref, ({ contentRect: { width, height } }) => {
      self.viewSize = vec2(
        width,
        height,
      );
    });
  })
);