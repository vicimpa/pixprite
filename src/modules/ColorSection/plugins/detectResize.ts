import { resizeObserver } from "@vicimpa/observers";
import type { ColorList } from "../ColorList";
import { effect } from "@preact/signals-react";

export default (self: ColorList) => (
  effect(() => {
    const { value: ref } = self.ref;
    if (!ref) return;

    return resizeObserver(ref, ({ contentRect: { width } }) => {
      self.width = width;
    });
  })
);