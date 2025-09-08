import { clamp, dispose } from "$utils/misc";
import { elementEvents, windowEvents } from "@vicimpa/events";
import type { CanvasSection } from "../CanvasSection";
import { batch, effect } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";
import { MouseButton } from "$utils/mouse";


export default (self: CanvasSection) => (
  effect(() => {
    const { value: ref } = self.ref;

    if (!ref) return;

    return (
      dispose(
        elementEvents(ref, 'mousedown', (e) => {
          if (self.down)
            return;

          batch(() => {
            self.drag = e.button === MouseButton.MIDDLE;
            self.down = e.button !== MouseButton.MIDDLE;
            self.alt = e.button === MouseButton.RIGHT;
          });
        }),
        elementEvents(ref, 'wheel', (e) => {
          const zoomIntensity = 0.1;
          const direction = e.deltaY > 0 ? -1 : 1;
          const pos = self.pos.clone();
          self.real = vec2().set(e.offsetX, e.offsetY);
          const current = self.umouse.clone();
          self.scale = clamp(self.scale * Math.exp(direction * zoomIntensity), .02, 120);
          self.pos = pos.add(current.sub(self.umouse));
        }),
        windowEvents('mousemove', (e) => {
          const rect = ref.getBoundingClientRect();
          if (self.drag) {
            const move = vec2(e.movementX, e.movementY).div(self.scale);
            self.pos = self.pos.clone().sub(move);
          }

          self.real = vec2().copy(e).sub(rect);
        }),
        effect(() => {
          batch(() => {
            self.umouse = self.real.clone().applyMat2d(self.invMatrix);
            self.mouse = self.umouse.clone().floor();
          });
        }),
        windowEvents(['mouseup', 'blur'], (e) => {
          batch(() => {
            self.alt = false;
            self.down = false;
            self.drag = false;
          });
        }),
      )
    );
  })
);