import { dispose, looper, type Dispose } from "~/utils/common";
import { useSignalRef } from "~/utils/signals";
import { effect, untracked, useComputed } from "@preact/signals-react";
import * as styled from "./styled";
import { useEffect, useRef, type FC } from "react";
import { useSignalSize } from "~/utils/observers";

export type CanvasProps = {
  inset?: true;
  /** The backing store follows the device pixel ratio (page zoom, HiDPI screens); the loop draws in CSS pixels after scaling by it */
  hidpi?: true;
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

export const Canvas: FC<CanvasProps> = ({ inset, hidpi, draw, loop, ...props }) => {
  const ref = useSignalRef<HTMLDivElement>(null);
  const size = useSignalSize(ref);
  const canvas = useSignalRef<HTMLCanvasElement>(null);
  const context = useComputed(() => canvas.value && getContext(canvas.value));

  // Latest callbacks, so the effects below don't restart on every render
  const callbacks = useRef({ draw, loop });
  callbacks.current = { draw, loop };

  // Sizes the backing store for the CSS size; true when it changed (which clears the canvas)
  const fit = (can: HTMLCanvasElement, width: number, height: number) => {
    const k = hidpi ? devicePixelRatio : 1;
    const w = Math.round(width * k), h = Math.round(height * k);
    if (can.width === w && can.height === h) return false;
    can.width = w;
    can.height = h;
    // 1 canvas pixel = 1 CSS pixel (or 1 device pixel with hidpi), never stretched to a fractional container size
    can.style.width = `${width}px`;
    can.style.height = `${height}px`;
    return true;
  };

  useEffect(() => (
    effect(() => {
      const { x, y } = size.value;
      const { value: can } = canvas;
      const { value: ctx } = context;
      const width = Math.round(x), height = Math.round(y);

      if (!can || !ctx || !width || !height)
        return;

      // Resizing clears the canvas: redraw synchronously so no blank frame is shown
      fit(can, width, height);

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
        if (!can.width || !can.height) return;
        // Page zoom can change the pixel ratio without changing the CSS size
        if (hidpi) fit(can, Math.round(size.peek().x), Math.round(size.peek().y));
        callbacks.current.loop?.(can, ctx, delta, time);
      }));
    })
  ), []);

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};
