import { dispose, looper } from "$utils/common";
import { useSignalRef } from "$utils/signals";
import { effect, useComputed, useSignal, useSignalEffect } from "@preact/signals-react";
import * as styled from "./styled";
import { useEffect, useMemo, type FC } from "react";
import { resizeObserver } from "@vicimpa/observers";
import { vec2, Vec2 } from "@vicimpa/glm";
import { createProgramInfo, setUniforms } from "twgl.js";
import boxVert from "./shaders/box.vert";
import boxFrag from "./shaders/box.frag";

export type ShaderProps = {
  inset?: true;
  uniforms?: Record<string, any>;
  shader?: string;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

export const Shader: FC<ShaderProps> = ({ inset, uniforms = {}, shader, ...props }) => {
  const ref = useSignalRef<HTMLDivElement>(null);
  const size = useSignal<Vec2 | null>(null);
  const canvas = useSignalRef<HTMLCanvasElement>(null);
  const gl = useComputed(() => canvas.value && canvas.value.getContext('webgl2')!);

  const programInfo = useComputed(() => {
    if (!gl.value) return null;
    return createProgramInfo(gl.value, [boxVert, boxFrag]);
  });

  useSignalEffect(() => {
    const { value: glVal } = gl;
    const { value: info } = programInfo;

    if (!glVal || !info) return;

    return () => {

    };
  });

  useEffect(() => (
    dispose(
      effect(() => (
        resizeObserver(ref.value, ({ contentRect: { width, height } }) => {
          const newSize = vec2(width, height);
          if (!size.value?.equals(newSize)) size.value = newSize;
        })
      )),
      effect(() => {
        const { width, height } = size.value ?? vec2();
        const { value: can } = canvas;
        const { value: glCtx } = gl;
        const progInfo = programInfo.value;

        if (!can || !glCtx || !width || !height || !progInfo)
          return;

        can.width = width;
        can.height = height;
        glCtx.viewport(0, 0, width, height);

        glCtx.clearColor(0, 0, 0, 1);
        glCtx.clear(glCtx.COLOR_BUFFER_BIT);

        glCtx.useProgram(progInfo.program);
        setUniforms(progInfo, uniforms);
        glCtx.drawArrays(glCtx.TRIANGLE_STRIP, 0, 4);
      })
    )
  ));

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};
