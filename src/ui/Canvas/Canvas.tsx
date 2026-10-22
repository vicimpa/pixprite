import { dispose, looper, type Dispose } from "~/utils/common";
import { useSignalRef } from "~/utils/signals";
import { effect, untracked, useComputed } from "@preact/signals-react";
import * as styled from "./styled";
import { useEffect, useRef, type FC } from "react";
import { useSignalSize } from "~/utils/observers";

export type CanvasProps = {
  inset?: true;
  draw?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Dispose;
  loop?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, delta: number, time: number) => any;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

const $ctx = Symbol('context');

function getContext(
  can: HTMLCanvasElement & { [$ctx]?: CanvasRenderingContext2D; },
  options?: CanvasRenderingContext2DSettings
) {
  return can[$ctx] ?? (
    can[$ctx] = can.getContext('2d', options)!
  );
}

export const Canvas: FC<CanvasProps> = ({ inset, draw, loop, ...props }) => {
  const ref = useSignalRef<HTMLDivElement>(null);
  const size = useSignalSize(ref);
  const canvas = useSignalRef<HTMLCanvasElement>(null);
  const context = useComputed(() => canvas.value && getContext(canvas.value));

  // Latest callbacks, so the effects below don't restart on every render
  const callbacks = useRef({ draw, loop });
  callbacks.current = { draw, loop };

  useEffect(() => (
    effect(() => {
      const { x, y } = size.value;
      const { value: can } = canvas;
      const { value: ctx } = context;
      const width = Math.round(x), height = Math.round(y);

      if (!can || !ctx || !width || !height)
        return;

      // Resizing clears the canvas: redraw synchronously so no blank frame is shown
      if (can.width !== width || can.height !== height) {
        can.width = width;
        can.height = height;
        // 1 canvas pixel = 1 CSS pixel, never stretched to a fractional container size
        can.style.width = `${width}px`;
        can.style.height = `${height}px`;
      }

      // Only the size drives this effect: whatever the drawing reads must not subscribe it
      const { draw, loop } = callbacks.current;
      return untracked(() => {
        loop?.(can, ctx, 0, performance.now());
        return draw?.(can, ctx);
      });
    })
  ), []);

  useEffect(() => (
    effect(() => {
      const { value: can } = canvas;
      const { value: ctx } = context;
      if (!can || !ctx || !callbacks.current.loop) return;
      return dispose(looper((delta, time) => {
        if (can.width && can.height) callbacks.current.loop?.(can, ctx, delta, time);
      }));
    })
  ), []);

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};
