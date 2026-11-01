/** A broken/lost WebGL driver selects the same Canvas fallback as an absent context. */
export function shaderProgram(gl: WebGL2RenderingContext | null, vertex: string, fragment: string) {
  if (!gl || gl.isContextLost()) return;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader allocation unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    }
    program = gl.createProgram();
    if (!program) throw new Error('Program allocation unavailable');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    return program;
  } catch {
    if (program) gl.deleteProgram(program);
    return;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}
