
import { dispose } from "$utils/misc";
import { elementEvents, windowEvents } from "@vicimpa/events";
import type { Flex } from "../Flex";
import { batch, effect } from "@preact/signals-react";
import { Vec2, vec2 } from "@vicimpa/glm";

export default (self: Flex) => (
  effect(() => {
    if (!self.resizable) return;
    const { value: item } = self.ref;
    if (!item) return;
    const parent = item.parentElement;
    if (!parent) return;
    const style = getComputedStyle(parent);

    batch(() => {
      self.size = parseFloat(style.gap);
      self.direction = style.flexDirection;
    });

    const { value: resizer } = self.ref;
    if (!resizer) return;

    let start: Vec2 | null = null, size = vec2();

    return dispose(
      elementEvents(resizer, 'mousedown', (e) => {
        const rect = resizer.getBoundingClientRect();
        start = vec2().copy(e);
        size.set(rect.width, rect.height);
        e.preventDefault();
      }),
      windowEvents('mousemove', (e) => {
        if (!start) return;
        e.preventDefault();
        const newSize = vec2();

        newSize.copy(start);
        newSize.sub(e);

        if (self.props.start) {
          newSize.add(size);
        } else {
          newSize.scale(-1);
          newSize.add(size);
        }

        if (self.direction === 'column') {
          item.style.flexBasis = `${newSize.y}px`;
        }

        if (self.direction === 'row') {
          item.style.flexBasis = `${newSize.x}px`;
        }
      }),
      windowEvents(['blur', 'mouseup'], () => {
        start = null;
      })
    );
  })
);