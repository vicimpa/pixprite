import { createElement, useEffect, useRef, type FC } from 'react';
import { effect } from '@preact/signals-react';
import '@pixprite/ui/elements';
import type { PxShader, Uniforms } from '@pixprite/ui/elements';
import { DEFAULT_SHADER } from '@pixprite/ui/elements';
import { deepGetValue, type DGV } from '~/utils/signals';

export type ShaderProps = {
  inset?: true;
  uniforms?: DGV<Record<string, number | Iterable<number>> | {}>;
  shader?: string;
  drawFallback?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

export const Shader: FC<ShaderProps> = ({ inset, uniforms = {}, shader, drawFallback, ...props }) => {
  const host = useRef<PxShader>(null);
  useEffect(() => effect(() => {
    const element = host.current;
    if (!element) return;
    element.drawFallback = drawFallback;
    element.shader = shader ?? DEFAULT_SHADER;
    element.uniforms = deepGetValue(uniforms) as Uniforms;
  }), [shader, uniforms, drawFallback]);
  return createElement('px-shader', { ...props, ref: host, inset: inset ? '' : undefined });
};
