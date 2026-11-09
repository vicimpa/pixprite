import type { BrushAngleDynamics } from "~/core/State";

/** Pen fields that drive angle dynamics */
export type AnglePen = { tiltX?: number; tiltY?: number; twist?: number };

/** Previous point for stroke direction computation */
let lastStrokePoint: { x: number; y: number } | null = null;

/** Resets the stroke direction tracking (call on stroke start) */
export function resetStrokeTracking() {
  lastStrokePoint = null;
}

/** Updates the last stroke point (call on each move during a stroke) */
export function updateStrokePoint(x: number, y: number) {
  lastStrokePoint = { x, y };
}

/**
 * Computes the effective brush angle based on the current dynamics mode.
 * Returns angle in degrees (0-360).
 */
export function computeBrushAngle(
  pen: AnglePen,
  mode: BrushAngleDynamics,
  fixedAngle: number,
  currentX?: number,
  currentY?: number,
): number {
  switch (mode) {
    case 'stroke':
      return computeStrokeAngle(fixedAngle, currentX, currentY);

    case 'tilt':
      return computeTiltAngle(pen, fixedAngle);

    case 'twist':
      return computeTwistAngle(pen, fixedAngle);

    default:
      return fixedAngle;
  }
}

/**
 * Computes angle from stroke direction.
 * Uses atan2(dy, dx) between last point and current point.
 * Returns fixed angle as fallback when no previous point.
 */
function computeStrokeAngle(fixedAngle: number, currentX?: number, currentY?: number): number {
  if (lastStrokePoint === null || currentX === undefined || currentY === undefined) {
    return fixedAngle;
  }

  const dx = currentX - lastStrokePoint.x;
  const dy = currentY - lastStrokePoint.y;

  // If movement is too small, keep the fixed angle
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return fixedAngle;
  }

  // atan2 returns radians (-PI to PI), convert to degrees (0-360)
  // Note: screen Y is down, so we negate dy for standard math coordinates
  const angleRad = Math.atan2(-dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  return angleDeg;
}

/**
 * Computes angle from pen tilt.
 * Uses atan2(tiltY, tiltX) - tiltX is left/right, tiltY is forward/back.
 * Returns fixed angle as fallback when tilt not available.
 */
function computeTiltAngle(pen: AnglePen, fixedAngle: number): number {
  if (pen.tiltX === undefined || pen.tiltY === undefined) {
    return fixedAngle;
  }

  const angleRad = Math.atan2(pen.tiltY, pen.tiltX);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  return angleDeg;
}

/**
 * Computes angle from pen twist (barrel rotation).
 * Twist is already in degrees 0-359.
 * Returns fixed angle as fallback when twist not available.
 */
function computeTwistAngle(pen: AnglePen, fixedAngle: number): number {
  if (pen.twist === undefined) {
    return fixedAngle;
  }

  // Twist is 0-359 degrees
  if (!Number.isFinite(pen.twist)) return fixedAngle;
  let angle = pen.twist % 360;
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Computes the effective brush scale factor from pressure.
 * Returns 1.0 when pressure scaling is disabled or not using a pen.
 */
export function computePressureScale(
  pen: { active: boolean; pressure: number },
  sizeDynamics: boolean,
  minPercent: number,
): number {
  if (!pen.active || !sizeDynamics) return 1;
  const min = Math.max(0, Math.min(100, minPercent)) / 100;
  return min + (1 - min) * pen.pressure;
}
