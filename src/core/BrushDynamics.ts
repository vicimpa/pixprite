/** Brush angles use the same counter-clockwise degrees as brushOffsets. */
export type BrushAngleDynamics = 'fixed' | 'stroke' | 'tilt' | 'twist';
export type AnglePen = { active: boolean; tiltX?: number; tiltY?: number; twist?: number };
export type StrokePoint = { x: number; y: number };
const normalize = (angle: number) => (angle % 360 + 360) % 360;

/** Stroke tracking belongs to the tool session; tiny moves keep its last angle. */
export function computeBrushAngle(
  pen: AnglePen, mode: BrushAngleDynamics, fixedAngle: number,
  current?: StrokePoint, previous?: StrokePoint, lastAngle = fixedAngle,
): number {
  if (mode === 'stroke') {
    if (!current || !previous) return lastAngle;
    const dx = current.x - previous.x, dy = current.y - previous.y;
    return Math.hypot(dx, dy) < 0.5 ? lastAngle : normalize(fixedAngle + Math.atan2(-dy, dx) * 180 / Math.PI);
  }
  if (!pen.active) return fixedAngle;
  if (mode === 'twist') return Number.isFinite(pen.twist) ? normalize(fixedAngle - pen.twist!) : fixedAngle;
  if (mode === 'tilt' && Number.isFinite(pen.tiltX) && Number.isFinite(pen.tiltY)) {
    // Pointer Events reports plane angles in degrees, with zero for unsupported tilt.
    // https://www.w3.org/TR/pointerevents3/#pointerevent-interface
    const rad = Math.PI / 180;
    const x = Math.tan(Math.max(-89.9, Math.min(89.9, pen.tiltX!)) * rad);
    const y = Math.tan(Math.max(-89.9, Math.min(89.9, pen.tiltY!)) * rad);
    if (Math.hypot(x, y) > 1e-6) return normalize(fixedAngle + Math.atan2(-y, x) / rad);
  }
  return fixedAngle;
}
