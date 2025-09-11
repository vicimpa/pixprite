import { Shader, type ShaderProps } from "$ui/Shader";
import { Signal, useComputed } from "@preact/signals-react";
import type { FC } from "react";
import hslFrag from "./shader/hsl.frag";
import hsvFrag from "./shader/hsv.frag";

type GradientColor = [number, number, number, number];
type GradientColorValue = GradientColor | Signal<GradientColor>;
export type GradientVariants =
  | {}
  | { a: GradientColorValue, b: GradientColorValue, c: GradientColorValue, d: GradientColorValue; }
  | { ab: GradientColorValue, cd: GradientColorValue; }
  | { ac: GradientColorValue, bd: GradientColorValue; };

export type GradientProps = {
  hsl?: true;
  gradient?: GradientVariants | Signal<GradientVariants>;
} & Omit<ShaderProps, 'shader' | 'uniforms'>;

export const Gradient: FC<GradientProps> = ({ hsl, gradient, ...props }) => {
  const shader = hsl ? hslFrag : hsvFrag;

  const uniforms = useComputed(() => {
    var output = gradient;

    if (output instanceof Signal)
      output = output.value;

    if (!output)
      return {};

    if ('a' in output) {
      return output;
    }

    if ('ab' in output) {
      return {
        a: output.ab,
        b: output.ab,
        c: output.cd,
        d: output.cd,
      };
    }

    if ('ac' in output) {
      return {
        a: output.ac,
        b: output.bd,
        c: output.ac,
        d: output.bd,
      };
    }

    return {};
  });

  return (
    <Shader shader={shader} uniforms={uniforms} {...props} />
  );
};