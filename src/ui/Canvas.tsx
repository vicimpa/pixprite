import { dispose, getContext, looper } from "$utils/misc";
import { effect, useComputed } from "@preact/signals-react";
import { useSignalRef } from "@preact/signals-react/utils";
import { useEffect, useRef } from "react";


type NativeCanvasProps = React.JSX.IntrinsicElements['canvas'];

export type CanvasProps = {
  read?: boolean;
  draw?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => (() => void) | void;
  loop?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, delta: number, time: number) => void;
} & Omit<NativeCanvasProps, 'ref' | 'target'>;

export const Canvas = ({ draw, loop, read, ...props }: CanvasProps) => {
  const ref = useSignalRef<HTMLCanvasElement | null>(null);
  const ctx = useComputed(() => ref.current && getContext(ref.current, read ?? false));

  useEffect(() => (
    effect(() => {
      const { value: canvas } = ref;
      const { value: context } = ctx;

      if (!canvas || !context)
        return;

      return dispose(
        draw?.(canvas, context),
        loop ? looper(loop.bind(null, canvas, context)) : undefined
      );
    })
  ));

  return <canvas ref={ref} {...props} />;
};;;