type Point = [number, number];

/** Carries travelled distance between pointer samples; callers paint the initial dab. */
export class BrushSpacing {
  private carry = 0;
  private painted: Point;
  constructor(private previous: Point) { this.painted = previous; }

  advance(to: Point, step: number): Point[] {
    const from = this.previous, dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    this.previous = to;
    if (!length) return [];
    step = Math.max(1, step);
    const out: Point[] = [];
    let distance = Math.max(0, step - this.carry);
    for (; distance <= length + 1e-8; distance += step) {
      const point: Point = [Math.round(from[0] + dx * distance / length), Math.round(from[1] + dy * distance / length)];
      if (point[0] !== this.painted[0] || point[1] !== this.painted[1]) { out.push(point); this.painted = point; }
    }
    this.carry = length - (distance - step);
    return out;
  }
}
