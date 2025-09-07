import { dispose, looper } from "$utils/misc";
import { useComputed, useSignalEffect } from "@preact/signals-react";
import { useSignalRef } from "@preact/signals-react/utils";
import { useRef } from "react";


type NativeCanvasProps = React.JSX.IntrinsicElements['canvas'];

export type CanvasProps = {
  draw?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => (() => void) | void;
  loop?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, delta: number, time: number) => void;
} & Omit<NativeCanvasProps, 'ref' | 'target'>;

export const Canvas = ({ draw, loop, ...props }: CanvasProps) => {
  const _ctx = useRef<CanvasRenderingContext2D | null>(null);
  const ref = useSignalRef<HTMLCanvasElement | null>(null);
  const ctx = useComputed(() => _ctx.current ?? (
    _ctx.current = ref.current?.getContext('2d') ?? null
  ));

  useSignalEffect(() => {
    const { value: canvas } = ref;
    const { value: context } = ctx;

    if (!canvas || !context)
      return;

    return dispose(
      draw?.(canvas, context),
      loop ? looper(loop.bind(null, canvas, context)) : undefined
    );
  });

  return <canvas ref={ref} {...props} />;
};;;