export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function clampByte(v: number) {
  return clamp(Math.round(v), 0, 255);
}

export function clampFloat(v: number) {
  return clamp(v, 0, 1);
}

export function byteToHex(n: number) {
  return clampByte(n).toString(16).padStart(2, '0');
}

export function floatToHex(n: number) {
  return byteToHex(clampFloat(n) * 255);
}

export function toFixed(n: number, p = 0) {
  const d = 10 ** p;
  return ((n * d) | 0) / d;
}