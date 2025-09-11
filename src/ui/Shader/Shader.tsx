import { useSignalRef } from "$utils/signals";
import { effect, Signal, useComputed, useSignal, useSignalEffect } from "@preact/signals-react";
import * as styled from "./styled";
import { useEffect, type FC } from "react";
import { resizeObserver } from "@vicimpa/observers";
import { vec2, Vec2 } from "@vicimpa/glm";
import { setUniforms } from "twgl.js";
import boxVert from "./shaders/box.vert";
import boxFrag from "./shaders/box.frag";
import baseFrag from "./shaders/base.frag";
import { useProgInfo } from "./utils/useProgInfo";
import { nextFrame, nextTick, pool, usePool } from "$utils/common";
import { RenderGL } from "$utils/render";

const gl = pool(() => new RenderGL());

export type ShaderProps = {
  inset?: true;
  uniforms?: Record<string, any> | Signal<Record<string, any>>;
  shader?: string;
} & Omit<React.JSX.IntrinsicElements['div'], 'children' | 'ref'>;

const context = Symbol('context');

const getContext = (can: (HTMLCanvasElement & { [context]?: ImageBitmapRenderingContext; }) | null) => {
  if (!can) return null;
  return can[context] ?? (
    can[context] = can.getContext('bitmaprenderer')!
  );
};

export const Shader: FC<ShaderProps> = ({ inset, uniforms = {}, shader = baseFrag, ...props }) => {
  const ref = useSignalRef<HTMLDivElement>(null);
  const size = useSignal<Vec2 | null>(null);
  const canvas = useSignalRef<HTMLCanvasElement>(null);
  const render = useComputed(() => getContext(canvas.value));
  const glCtx = usePool(gl);
  const progInfo = useProgInfo(glCtx, boxVert, boxFrag + '\n' + shader);

  useSignalEffect(() => (
    resizeObserver(ref.value, ({ contentRect: { width, height } }) => {
      const newSize = vec2(width, height);
      if (!size.value?.equals(newSize)) size.value = newSize;
    })
  ));

  useEffect(() => (
    effect(() => {
      const { width, height } = size.value ?? vec2();
      const { value: can } = canvas;
      const { value: ctx } = render;
      const { gl } = glCtx;

      if (!can || !ctx || !width || !height)
        return;

      const data = Object.entries(uniforms instanceof Signal ? uniforms.value : uniforms)
        .reduce((acc, [key, value]) => {
          acc[key] = value instanceof Signal ? value.value : value;
          return acc;
        }, {} as Record<string, any>);

      can.width = width;
      can.height = height;
      glCtx.width = width;
      glCtx.height = height;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_DST_ALPHA);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progInfo.program);
      setUniforms(progInfo, data);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.transferFromImageBitmap(glCtx.transferToImageBitmap());
    })
  ));

  return (
    <styled.Container ref={ref} $inset={inset} {...props}>
      <styled.Canvas ref={canvas} />
    </styled.Container>
  );
};