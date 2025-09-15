import { dispose, looper, type Dispose } from "$utils/common";
import { useSignalRef } from "$utils/signals";
import { effect, useComputed } from "@preact/signals-react";
import * as styled from "./styled";
import { useEffect, type FC } from "react";;
import { vec2 } from "@vicimpa/glm";
import { useSignalSize } from "$utils/observers";


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

  useEffect(() => (
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
  ));

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};