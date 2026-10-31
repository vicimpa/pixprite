import { expect, mock, spyOn, test } from 'bun:test';
import { shaderProgram } from './program';

test('unavailable and lost WebGL contexts select the fallback', () => {
  expect(shaderProgram(null, '', '')).toBeUndefined();
  const createProgram = mock(() => { throw new Error('A lost context must not compile shaders'); });
  expect(shaderProgram({ isContextLost: () => true, createProgram } as unknown as WebGL2RenderingContext, '', '')).toBeUndefined();
  expect(createProgram).not.toHaveBeenCalled();
});

test('a driver returning a null shader cannot crash the renderer', () => {
  const shaderSource = mock(() => { throw new TypeError('shaderSource requires a WebGLShader'); });
  const gl = {
    isContextLost: () => false, createProgram: () => ({}), createShader: () => null,
    shaderSource, VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
  } as unknown as WebGL2RenderingContext;
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(shaderProgram(gl, 'void main() {}', 'void main() {}')).toBeUndefined();
    expect(shaderSource).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});
