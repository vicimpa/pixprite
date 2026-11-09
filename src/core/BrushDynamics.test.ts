import { afterEach, describe, expect, test } from 'bun:test';
import { computeBrushAngle, computePressureScale, resetStrokeTracking, updateStrokePoint } from '~/core/BrushDynamics';

const FIXED = 45;

describe('computeBrushAngle', () => {
  afterEach(resetStrokeTracking);

  test('fixed mode returns the configured brush angle', () => {
    expect(computeBrushAngle({}, 'fixed', FIXED)).toBe(FIXED);
    expect(computeBrushAngle({ tiltX: 1, tiltY: 0, twist: 90 }, 'fixed', FIXED)).toBe(FIXED);
  });

  test('stroke mode follows the direction of the stroke', () => {
    // No previous point yet: fall back to the fixed angle
    expect(computeBrushAngle({}, 'stroke', FIXED, 10, 10)).toBe(FIXED);

    updateStrokePoint(10, 10);
    expect(computeBrushAngle({}, 'stroke', FIXED, 20, 10)).toBeCloseTo(0);
    expect(computeBrushAngle({}, 'stroke', FIXED, 10, 20)).toBeCloseTo(270);
    expect(computeBrushAngle({}, 'stroke', FIXED, 0, 0)).toBeCloseTo(135);
  });

  test('stroke mode keeps the fixed angle for tiny movements', () => {
    updateStrokePoint(10, 10);
    expect(computeBrushAngle({}, 'stroke', FIXED, 10.1, 10.1)).toBe(FIXED);
    expect(computeBrushAngle({}, 'stroke', FIXED)).toBe(FIXED);
    expect(computeBrushAngle({}, 'stroke', FIXED, 10)).toBe(FIXED);
  });

  test('tilt mode follows the pen tilt direction', () => {
    expect(computeBrushAngle({ tiltX: 1, tiltY: 0 }, 'tilt', FIXED)).toBeCloseTo(0);
    expect(computeBrushAngle({ tiltX: 0, tiltY: 1 }, 'tilt', FIXED)).toBeCloseTo(90);
    expect(computeBrushAngle({ tiltX: -1, tiltY: 0 }, 'tilt', FIXED)).toBeCloseTo(180);
    expect(computeBrushAngle({ tiltX: 0, tiltY: -1 }, 'tilt', FIXED)).toBeCloseTo(270);
  });

  test('tilt mode falls back to the fixed angle without tilt data', () => {
    expect(computeBrushAngle({}, 'tilt', FIXED)).toBe(FIXED);
    expect(computeBrushAngle({ tiltX: 1 }, 'tilt', FIXED)).toBe(FIXED);
    expect(computeBrushAngle({ tiltY: 1 }, 'tilt', FIXED)).toBe(FIXED);
  });

  test('twist mode uses the barrel rotation in degrees', () => {
    expect(computeBrushAngle({ twist: 0 }, 'twist', FIXED)).toBe(0);
    expect(computeBrushAngle({ twist: 90 }, 'twist', FIXED)).toBe(90);
    expect(computeBrushAngle({ twist: 450 }, 'twist', FIXED)).toBe(90);
    expect(computeBrushAngle({ twist: -90 }, 'twist', FIXED)).toBe(270);
  });

  test('twist mode falls back to the fixed angle without twist data', () => {
    expect(computeBrushAngle({}, 'twist', FIXED)).toBe(FIXED);
  });
});

describe('computePressureScale', () => {
  test('scales only for an active pen with size dynamics enabled', () => {
    expect(computePressureScale({ active: false, pressure: 0.5 }, true, 10)).toBe(1);
    expect(computePressureScale({ active: true, pressure: 1 }, true, 10)).toBe(1);
    expect(computePressureScale({ active: true, pressure: 0.5 }, true, 10)).toBeCloseTo(0.55);
  });

  test('never goes below the configured minimum size', () => {
    expect(computePressureScale({ active: true, pressure: 0 }, true, 100)).toBeCloseTo(1);
    expect(computePressureScale({ active: true, pressure: 0 }, true, 0)).toBe(0);
    expect(computePressureScale({ active: true, pressure: 0.5 }, true, -20)).toBeCloseTo(0.5);
    expect(computePressureScale({ active: true, pressure: 0.5 }, true, 200)).toBe(1);
  });

  test('returns 1 when size dynamics is disabled', () => {
    expect(computePressureScale({ active: true, pressure: 0.25 }, false, 10)).toBe(1);
  });
});
