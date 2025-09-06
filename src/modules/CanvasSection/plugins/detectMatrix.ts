import { Mat2d, vec2 } from "@vicimpa/glm";
import type { CanvasSection } from "../CanvasSection";
import { effect } from "@preact/signals-react";

export default (self: CanvasSection) => (
  effect(() => {
    const { scale, size, pos, view } = self;
    const { x: tx, y: ty } = vec2(view.width, view.height)
      .scale(-.5)
      .sub(pos)
      .scale(scale)
      .add(size.clone().div(2))
      .floor();

    self.matrix = new Mat2d()
      .translate(tx, ty)
      .scale(scale);
  })
);