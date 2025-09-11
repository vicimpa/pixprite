import { resizeObserver } from "@vicimpa/observers";
import type { Slider } from "../Slider";
import { effect } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";

export default (self: Slider) => (
  effect(() => {
    const { value: ref } = self.ref;
    if (!ref) return;

    return resizeObserver(ref, ({ contentRect: { width, height } }) => {
      self.size = vec2(width, height);
    });
  })
);