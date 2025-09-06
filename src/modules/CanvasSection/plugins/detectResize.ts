import { resizeObserver } from "@vicimpa/observers";
import type { CanvasSection } from "../CanvasSection";
import { effect } from "@preact/signals-react";
import { vec2 } from "@vicimpa/glm";

export default (self: CanvasSection) => (
  effect(() => {
    return resizeObserver(self.ref.current, (e) => {
      self.size = vec2(e.contentRect.width, e.contentRect.height);
    });
  })
);