import { resizeObserver } from "@vicimpa/observers";
import type { PointSlider } from "../PointSlider";
import { effect } from "@preact/signals-react";

export default (self: PointSlider) => (
  effect(() => (
    resizeObserver(self.ref.value, ({ contentRect: { width, height } }) => {
      self.size = self.size.set(width, height).clone();
    })
  ))
);