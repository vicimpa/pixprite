import { useEffect, useMemo } from "react";
import type { RenderGL } from "~/utils/render";
import { shaderProgram } from "./program";
import { usePool } from "~/utils/common";
import { glpool } from "./glpool";

export function useRednerGL() {
  return usePool(glpool);
}

export function useProgInfo({ gl }: RenderGL, vs: string, fs: string) {
  const info = useMemo(() => {
    return shaderProgram(gl, vs, fs);
  }, [gl, vs, fs]);

  useEffect(() => {
    return () => {
      if (info) gl?.deleteProgram(info.program);
    };
  }, [info]);

  return info;
}
