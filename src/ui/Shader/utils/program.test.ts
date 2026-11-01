import { expect, mock, test } from 'bun:test';
import { shaderProgram } from './program';

test('unavailable and lost WebGL contexts select the fallback', () => {
  expect(shaderProgram(null, '', '')).toBeUndefined();
  const createProgram = mock(() => { throw new Error('A lost context must not compile shaders'); });
  expect(shaderProgram({ isContextLost: () => true, createProgram } as unknown as WebGL2RenderingContext, '', '')).toBeUndefined();
  expect(createProgram).not.toHaveBeenCalled();
});

test('a driver returning a null shader never receives an invalid shader object', () => {
  const shaderSource = mock(() => { throw new TypeError('shaderSource requires a WebGLShader'); });
  const gl = { isContextLost: () => false, createShader: () => null, shaderSource, VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632 } as unknown as WebGL2RenderingContext;
  expect(shaderProgram(gl, 'void main() {}', 'void main() {}')).toBeUndefined();
  expect(shaderSource).not.toHaveBeenCalled();
});

test('a rejected shader releases its allocation before selecting fallback', () => {
  const shader = {}, deleteShader = mock(() => {}), createProgram = mock(() => ({}));
  const gl = {
    isContextLost: () => false, createShader: () => shader, shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => false, getShaderInfoLog: () => 'unsupported shader', deleteShader, createProgram,
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713,
  } as unknown as WebGL2RenderingContext;
  expect(shaderProgram(gl, '', '')).toBeUndefined();
  expect(deleteShader).toHaveBeenCalledWith(shader);
  expect(createProgram).not.toHaveBeenCalled();
});
