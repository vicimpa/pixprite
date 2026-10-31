import { useEffect, useMemo } from "react";
import type { RenderGL } from "~/utils/render";
import { createProgramInfo } from "twgl.js";
import { usePool } from "~/utils/common";
import { glpool } from "./glpool";

export function useRednerGL() {
  return usePool(glpool);
}

export function useProgInfo({ gl }: RenderGL, vs: string, fs: string) {
  const info = useMemo(() => {
    return gl ? createProgramInfo(gl, [vs, fs]) : undefined;
  }, [gl, vs, fs]);

  useEffect(() => {
    return () => {
      if (info) gl?.deleteProgram(info.program);
    };
  }, [info]);

  return info;
}
