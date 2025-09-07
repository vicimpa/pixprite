import { windowEvents } from "@vicimpa/events";
import type { ColorList } from "../ColorList";
import { clamp, dispose } from "$utils/misc";
import { effect } from "@preact/signals-react";

export default (self: ColorList) => (
  effect(() => {
    const { value: ref } = self.ref;
    if (!ref) return;

    return dispose(
      windowEvents('mousemove', (e) => {
        const { y } = ref.getBoundingClientRect();
        if (self.draggingScroll) {
          const { height } = self.viewSize;
          const { maxScroll } = self;
          const handleHeight = Math.max(20, height * (height / (height + maxScroll)));

          const handleY = clamp(e.y - y - self.dragOffset, 0, height - handleHeight);
          self.scroll = (handleY / (height - handleHeight)) * maxScroll;
        }
      }),
      windowEvents(['blur', 'mouseup'], () => {
        self.draggingScroll = false;
      }),
    );
  })
);