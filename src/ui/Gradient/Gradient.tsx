import { Signal, effect } from '@preact/signals-react';
import { createElement, useEffect, useRef, type FC } from 'react';
import '@pixprite/ui/elements';
import type { PxGradient, GradientCorners } from '@pixprite/ui/elements';
import type { ShaderProps } from '~/ui/Shader';
import { deepGetValue } from '~/utils/signals';

type GradientColor = [number, number, number, number];
type GradientColorValue = GradientColor | Signal<GradientColor>;
export type GradientVariants = {} | { a: GradientColorValue; b: GradientColorValue; c: GradientColorValue; d: GradientColorValue } | { ab: GradientColorValue; cd: GradientColorValue } | { ac: GradientColorValue; bd: GradientColorValue };
export type GradientProps = { hsl?: true; gradient?: GradientVariants | Signal<GradientVariants> } & Omit<ShaderProps, 'shader' | 'uniforms'>;

export const Gradient: FC<GradientProps> = ({ hsl, gradient, inset, drawFallback: _fallback, ...props }) => {
  const host = useRef<PxGradient>(null);
  useEffect(() => effect(() => {
    const element = host.current;
    if (!element) return;
    const data = deepGetValue(gradient instanceof Signal ? gradient.value : gradient);
    let corners: GradientCorners = {};
    if (data && 'a' in data) corners = data as GradientCorners;
    else if (data && 'ab' in data) corners = { a: data.ab, b: data.ab, c: data.cd, d: data.cd } as GradientCorners;
    else if (data && 'ac' in data) corners = { a: data.ac, b: data.bd, c: data.ac, d: data.bd } as GradientCorners;
    element.hsl = !!hsl; element.gradient = corners;
  }), [hsl, gradient]);
  return createElement('px-gradient', { ...props, ref: host, inset: inset ? '' : undefined });
};
