import { dispose, looper, type Dispose } from "$utils/common";
import { useSignalRef } from "$utils/signals";
import { effect, useComputed, useSignal } from "@preact/signals-react";
import * as styled from "./styled";
import { getContext } from "$utils/drawer";
import { useEffect, type FC } from "react";
import { resizeObserver } from "@vicimpa/observers";
import { vec2, Vec2 } from "@vicimpa/glm";


export type CanvasProps = {
  inset?: true;
  draw?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Dispose;
  loop?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, delta: number, time: number) => any;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

export const Canvas: FC<CanvasProps> = ({ inset, draw, loop, ...props }) => {
  const ref = useSignalRef<HTMLDivElement>(null);
  const size = useSignal<Vec2 | null>(null);
  const canvas = useSignalRef<HTMLCanvasElement>(null);
  const context = useComputed(() => canvas.value && getContext(canvas.value));

  useEffect(() => (
    dispose(
      effect(() => (
        resizeObserver(ref.value, ({ contentRect: { width, height } }) => {
          const newSize = vec2(width, height);

          if (!size.value?.equals(newSize))
            size.value = newSize;
        })
      )),
      effect(() => {
        const { width, height } = size.value ?? vec2();
        const { value: can } = canvas;
        const { value: ctx } = context;

        if (!can || !ctx || !width || !height)
          return;

        can.width = width;
        can.height = height;

        return dispose(
          draw?.(can, ctx),
          loop ? looper(loop.bind(null, can, ctx)) : undefined
        );
      })
    )
  ));

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};