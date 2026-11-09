/** Settings that travel with a bitmap brush, independently of document pixels. */
export const BRUSH_KEYS = ['brushSize', 'brushShape', 'brushAngle', 'brushAngleDynamics', 'brushScale', 'brushFlipX', 'brushFlipY',
  'brushMode', 'brushSpacing', 'ink', 'opacity', 'pixelPerfect', 'stabilizer', 'pressure', 'sprayWidth', 'spraySpeed'] as const;
export type BrushParameters = Record<string, unknown>;

export function readBrushParameters(value: unknown): BrushParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid brush settings');
  const numbers: Record<string, [number, number]> = { brushSize: [1, 64], brushAngle: [-360, 360], brushScale: [1, 400],
    brushSpacing: [0, 1000], opacity: [0, 255], stabilizer: [0, 64], sprayWidth: [2, 64], spraySpeed: [10, 200] };
  const choices: Record<string, string[]> = { brushShape: ['square', 'circle', 'line'], brushAngleDynamics: ['fixed', 'stroke', 'tilt', 'twist'],
    brushMode: ['continuous', 'stamp'], ink: ['simple', 'alpha', 'copy', 'lockAlpha', 'shade'] };
  const out: BrushParameters = {};
  for (const [key, v] of Object.entries(value)) {
    if (Object.hasOwn(numbers, key)) {
      const [min, max] = numbers[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('Invalid brush setting: ' + key);
    } else if (Object.hasOwn(choices, key)) {
      if (typeof v !== 'string' || !choices[key].includes(v)) throw new Error('Invalid brush setting: ' + key);
    } else if (['brushFlipX', 'brushFlipY', 'pixelPerfect'].includes(key)) {
      if (typeof v !== 'boolean') throw new Error('Invalid brush setting: ' + key);
    } else if (key === 'pressure') {
      const p = v as Record<string, unknown> | null;
      if (!p || typeof p !== 'object' || ['size', 'opacity', 'density'].some(k => typeof p[k] !== 'boolean') ||
        typeof p.min !== 'number' || !Number.isFinite(p.min) || p.min < 0 || p.min > 100) throw new Error('Invalid pressure settings');
      out.pressure = { size: p.size, opacity: p.opacity, density: p.density, min: p.min };
      continue;
    } else throw new Error('Unknown brush setting: ' + key);
    out[key] = v;
  }
  return out;
}
