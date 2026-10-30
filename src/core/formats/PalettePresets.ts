const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => '#' + hex2(r) + hex2(g) + hex2(b);

/** HSL (h in degrees, s/l in 0..1) -> '#rrggbb' */
function hsl(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** `steps` colours along a hue/sat/lightness ramp; hue shifts slightly with lightness. */
function ramp(h0: number, h1: number, s0: number, s1: number, l0: number, l1: number, steps: number) {
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(hsl(h0 + (h1 - h0) * t, s0 + (s1 - s0) * t, l0 + (l1 - l0) * t));
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Built-in procedurally generated palettes. */
export const PRESET_PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Grayscale 16', colors: range(16).map(i => rgbHex(i * 17, i * 17, i * 17)) },
  { name: 'Warm 16', colors: [...ramp(340, 20, 0.55, 0.75, 0.12, 0.55, 8), ...ramp(20, 55, 0.8, 0.9, 0.5, 0.88, 8)] },
  { name: 'Cool 16', colors: [...ramp(250, 200, 0.45, 0.65, 0.1, 0.55, 8), ...ramp(190, 150, 0.6, 0.5, 0.45, 0.9, 8)] },
  {
    name: 'Earth 24', colors: [
      ...ramp(15, 35, 0.35, 0.5, 0.12, 0.7, 8),   // soils / clay
      ...ramp(80, 60, 0.3, 0.45, 0.14, 0.68, 8),  // moss / olive
      ...ramp(40, 50, 0.08, 0.2, 0.2, 0.88, 8),   // stone / sand
    ],
  },
  { name: 'Neon 16', colors: [hsl(260, 0.4, 0.06), ...range(14).map(i => hsl(i * (360 / 14) + 5, 1, i % 2 ? 0.5 : 0.62)), '#ffffff'] },
  { name: 'Pastel 16', colors: range(16).map(i => hsl(i * 22.5 + 10, i % 2 ? 0.55 : 0.7, i % 2 ? 0.82 : 0.76)) },
];
