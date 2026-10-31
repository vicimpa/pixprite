import { createProgramInfo } from 'twgl.js';

/** A context may exist even when its driver cannot allocate shader objects. */
export function shaderProgram(gl: WebGL2RenderingContext | null, vs: string, fs: string) {
  if (!gl || gl.isContextLost()) return;
  try {
    return createProgramInfo(gl, [vs, fs]);
  } catch (error) {
    console.warn('WebGL shader unavailable; using Canvas 2D', error);
  }
}
