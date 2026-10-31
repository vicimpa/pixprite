import { expect, test } from 'bun:test';
import { gradientPixels } from './pixels';

test('HSV hue interpolation includes all six color sectors', () => {
  expect([...gradientPixels(6, 1, { a: [0, 1, 1, 1], b: [1, 1, 1, 1], c: [0, 1, 1, 1], d: [1, 1, 1, 1] })]).toEqual([
    255, 128, 0, 255, 128, 255, 0, 255, 0, 255, 128, 255,
    0, 128, 255, 255, 128, 0, 255, 255, 255, 0, 128, 255,
  ]);
});

test('the top of the canvas corresponds to the upper shader corners', () => {
  expect([...gradientPixels(1, 2, { a: [0, 0, 0, 1], b: [0, 0, 0, 1], c: [0, 0, 1, 1], d: [0, 0, 1, 1] })]).toEqual([
    191, 191, 191, 255, 64, 64, 64, 255,
  ]);
});

test('HSL lightness and alpha are preserved and missing uniforms are transparent', () => {
  const green = [1 / 3, 1, .25, .5];
  expect([...gradientPixels(1, 1, { a: green, b: green, c: green, d: green }, true)]).toEqual([0, 128, 0, 128]);
  expect([...gradientPixels(1, 1, {})]).toEqual([0, 0, 0, 0]);
});
