import { vec2 } from "@vicimpa/glm";
import type { CanvasSection } from "../CanvasSection";
import { effect } from "@preact/signals-react";
import { nextFrame } from "$utils/misc";

export default (self: CanvasSection) => (
  effect(() => {
    const { value: can } = self.can;
    const { value: ctx } = self.ctx;
    const { value: color } = self.editor.color;
    if (!can || !ctx || !color) return;

    const { size, matrix, view, mouse } = self;
    const { width, height } = self.size;

    return nextFrame(() => {
      if (!vec2(can.width, can.height).equals(size)) {
        can.width = width;
        can.height = height;
      }

      const { width: vw, height: vh } = view;
      ctx.imageSmoothingEnabled = false;
      ctx.resetTransform();
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(matrix);
      self.grid.toFill(ctx);
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, vw, vh);

      if (mouse.x < 0 || mouse.y < 0 || mouse.x >= vw || mouse.y >= vh)
        return;

      ctx.globalAlpha = color.colorA.a;
      ctx.fillStyle = color.colorA.toHex();
      ctx.fillRect(mouse.x, mouse.y, 1, 1);
    });
  })
);