export type GradientCorners = Partial<Record<'a' | 'b' | 'c' | 'd', readonly number[]>>;

/** Four-corner interpolation, with the same bottom-left UV origin as the shader. */
export function gradientPixels(width: number, height: number, corners: GradientCorners, hsl = false) {
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
      const h = ((color[0] - Math.floor(color[0])) * 360) / 60, s = color[1], light = color[2];
      const chroma = hsl ? (1 - Math.abs(2 * light - 1)) * s : light * s;
      const second = chroma * (1 - Math.abs(h % 2 - 1));
      const m = hsl ? light - chroma / 2 : light - chroma;
      const rgb = h < 1 ? [chroma, second, 0] : h < 2 ? [second, chroma, 0] : h < 3 ? [0, chroma, second] : h < 4 ? [0, second, chroma] : h < 5 ? [second, 0, chroma] : [chroma, 0, second];
      const offset = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) pixels[offset + k] = Math.max(0, Math.min(255, Math.round((rgb[k] + m) * 255)));
      pixels[offset + 3] = color[3] * 255;
    }
  }
  return pixels;
}
