import { elementEvents, windowEvents } from "@vicimpa/events";
import { dispose } from "$utils/misc";
import type { PointSlider } from "../PointSlider";
import { batch, effect } from "@preact/signals-react";
import { getMouseVec } from "$utils/mouse";

export default (self: PointSlider) => (
  effect(() => {
    const { value: ref } = self.ref;
    if (!ref) return;

    return dispose(
      elementEvents(ref, 'mousedown', (e) => {
        batch(() => {
          self.drag = e.button !== 1;
          self.alt = e.button === 2;
          self.update(getMouseVec(e, ref, true, true));
        });
      }),
      windowEvents('mousemove', (e) => {
        self.update(getMouseVec(e, ref, true, true));
      }),
      windowEvents(['mouseup', 'blur'], () => {
        batch(() => {
          self.drag = false;
          self.alt = false;
        });
      })
    );
  })
);