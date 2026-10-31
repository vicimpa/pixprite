import { hslToRgb, hsvToRgb } from '~/utils/color';

/** Match the shader's four-corner interpolation and bottom-left UV origin. */
export function gradientPixels(width: number, height: number, corners: Partial<Record<'a' | 'b' | 'c' | 'd', readonly number[]>>, hsl = false) {
  const zero = [0, 0, 0, 0];
  const { a = zero, b = zero, c = zero, d = zero } = corners;
  const pixels = new Uint8ClampedArray(width * height * 4), color = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    const v = 1 - (y + .5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + .5) / width;
      for (let k = 0; k < 4; k++) {
        const bottom = a[k] + (b[k] - a[k]) * u;
        const top = c[k] + (d[k] - c[k]) * u;
        color[k] = bottom + (top - bottom) * v;
      }
      const hue = (color[0] - Math.floor(color[0])) * 360;
      const { r, g, b: blue } = (hsl ? hslToRgb : hsvToRgb)(hue, color[1], color[2]);
      const offset = (y * width + x) * 4;
      pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = blue; pixels[offset + 3] = color[3] * 255;
    }
  }
  return pixels;
}
