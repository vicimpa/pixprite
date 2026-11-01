import { createElement, useLayoutEffect, useRef, type FC } from 'react';
import '@pixprite/ui/elements';
import type { PxCanvas } from '@pixprite/ui/elements';
import type { Dispose } from '~/utils/common';

export type CanvasProps = {
  inset?: true;
  hidpi?: true;
  draw?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Dispose;
  loop?: (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D, delta: number, time: number) => unknown;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

export const Canvas: FC<CanvasProps> = ({ inset, hidpi, draw, loop, ...props }) => {
  const host = useRef<PxCanvas>(null), callbacks = useRef({ draw, loop });
  callbacks.current = { draw, loop };
  useLayoutEffect(() => {
    const element = host.current!;
    element.draw = (can, ctx) => callbacks.current.draw?.(can, ctx);
    element.loop = loop ? (can, ctx, delta, time) => { callbacks.current.loop?.(can, ctx, delta, time); } : undefined;
    return () => { element.draw = undefined; element.loop = undefined; };
  }, [!!loop]);
  return createElement('px-canvas', { ...props, ref: host, inset: inset ? '' : undefined, hidpi: hidpi ? '' : undefined });
};
