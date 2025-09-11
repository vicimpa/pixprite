import { useEffect, useMemo } from "react";
import type { RenderGL } from "$utils/render";
import { createProgramInfo } from "twgl.js";

export function useProgInfo({ gl }: RenderGL, vs: string, fs: string) {
  const info = useMemo(() => {
    return createProgramInfo(gl, [vs, fs]);
  }, [gl, vs, fs]);

  useEffect(() => {
    return () => {
      gl.deleteProgram(info.program);
    };
  }, [info]);

  return info;
}