/** Pixel shape is document metadata; all editing coordinates remain logical pixel coordinates. */
export function pixelRatio(x: number, y: number): [number, number] {
  if (![x, y].every(v => Number.isInteger(v) && v >= 1 && v <= 255)) throw new Error('Pixel ratio components must be integers from 1 to 255');
  let a = x, b = y;
  while (b) [a, b] = [b, a % b];
  return [x / a, y / a];
}

/** A previous import stored the ratio in its diagnostic detail before it was editable. */
export function documentPixelRatio(doc: { pixelRatioX?: number; pixelRatioY?: number; asepriteWarnings?: { kind: string; detail?: string }[] }): [number, number] {
  if (doc.pixelRatioX !== undefined || doc.pixelRatioY !== undefined) return pixelRatio(doc.pixelRatioX!, doc.pixelRatioY!);
  const detail = doc.asepriteWarnings?.find(w => w.kind === 'pixelRatio')?.detail;
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(detail ?? '');
  if (match) { try { return pixelRatio(+match[1], +match[2]); } catch { /* keep an invalid legacy warning */ } }
  return [1, 1];
}
