import { describe, expect, test } from 'bun:test';
import { computeBrushAngle } from './BrushDynamics';

const mouse = { active: false }, pen = { active: true };
describe('brush angle dynamics', () => {
  test('stroke follows screen movement in the brush coordinate system with an angle offset', () => {
    const from = { x: 10, y: 10 };
    expect(computeBrushAngle(mouse, 'stroke', 0, { x: 10, y: 20 }, from)).toBe(270);
    expect(computeBrushAngle(mouse, 'stroke', 45, { x: 20, y: 10 }, from)).toBe(45);
    expect(computeBrushAngle(mouse, 'stroke', 0, { x: 0, y: 10 }, from)).toBe(180);
  });
  test('stationary and first samples retain the previous orientation', () => {
    expect(computeBrushAngle(pen, 'stroke', 45)).toBe(45);
    expect(computeBrushAngle(pen, 'stroke', 45, { x: 10.1, y: 10.1 }, { x: 10, y: 10 }, 90)).toBe(90);
  });
  test('mouse, unsupported pen orientation and upright tilt preserve the fixed angle', () => {
    expect(computeBrushAngle({ active: false, tiltX: 45, tiltY: 0, twist: 90 }, 'tilt', 45)).toBe(45);
    expect(computeBrushAngle(pen, 'tilt', 45)).toBe(45);
    expect(computeBrushAngle({ ...pen, tiltX: 0, tiltY: 0 }, 'tilt', 45)).toBe(45);
    expect(computeBrushAngle(pen, 'twist', 45)).toBe(45);
    expect(computeBrushAngle({ ...pen, twist: NaN }, 'twist', 45)).toBe(45);
  });
  test('tilt uses plane angles and twist uses clockwise degrees', () => {
    expect(computeBrushAngle({ ...pen, tiltX: 0, tiltY: 45 }, 'tilt', 0)).toBe(270);
    const angle = computeBrushAngle({ ...pen, tiltX: 60, tiltY: 30 }, 'tilt', 0);
    expect(angle).toBeCloseTo(360 - Math.atan(1 / 3) * 180 / Math.PI);
    expect(computeBrushAngle({ ...pen, twist: 90 }, 'twist', 45)).toBe(315);
  });
});
