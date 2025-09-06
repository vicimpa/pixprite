import { Vec2Set } from "$core/Vec2Set";
import { vec2, Vec2 } from "@vicimpa/glm";

const points = new Vec2Set();
const pt = vec2();

export function line(p0: Vec2, p1: Vec2, plot: (pt: Vec2) => void): void {
  points.clear();

  let x0 = Math.round(p0[0]);
  let y0 = Math.round(p0[1]);
  let x1 = Math.round(p1[0]);
  let y1 = Math.round(p1[1]);

  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);

  if (steep) {
    [x0, y0] = [y0, x0];
    [x1, y1] = [y1, x1];
  }

  if (x0 > x1) {
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }

  const dx = x1 - x0;
  const dy = Math.abs(y1 - y0);
  let error = 0;
  const deltaErr = dy;
  let y = y0;
  const yStep = y0 < y1 ? 1 : -1;

  for (let x = x0; x <= x1; x++) {
    if (steep) {
      pt.set(y, x);
    } else {
      pt.set(x, y);
    }
    points.add(pt);

    error += deltaErr;
    if (error * 2 >= dx) {
      y += yStep;
      error -= dx;
    }
  }

  points.forEach(plot);
}

export function rect(p0: Vec2, p1: Vec2, fill: boolean, plot: (pt: Vec2) => void): void {
  points.clear();

  const x0 = Math.min(p0[0], p1[0]);
  const y0 = Math.min(p0[1], p1[1]);
  const x1 = Math.max(p0[0], p1[0]);
  const y1 = Math.max(p0[1], p1[1]);

  if (fill) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        pt.set(x, y);
        points.add(pt.clone());
      }
    }
  } else {
    for (let x = x0; x <= x1; x++) {
      pt.set(x, y0); points.add(pt.clone());
      pt.set(x, y1); points.add(pt.clone());
    }

    for (let y = y0 + 1; y < y1; y++) {
      pt.set(x0, y); points.add(pt.clone());
      pt.set(x1, y); points.add(pt.clone());
    }
  }

  points.forEach(plot);
}

export function ellipse(p0: Vec2, p1: Vec2, fill: boolean, plot: (pt: Vec2) => void) {
  points.clear();

  let x0 = Math.round(p0[0]);
  let y0 = Math.round(p0[1]);
  let x1 = Math.round(p1[0]);
  let y1 = Math.round(p1[1]);

  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];

  const a = (x1 - x0) / 2;
  const b = (y1 - y0) / 2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  if (a < 0.5 && b < 0.5) {
    points.add(pt.set(cx, cy));
  } else {
    const a2 = a * a;
    const b2 = b * b;

    for (let xi = Math.ceil(cx); xi <= x1; xi++) {
      const dx = xi - cx;
      const term = 1 - (dx * dx) / a2;
      if (term < 0) continue;
      const dy = Math.sqrt(term * b2);

      const y = Math.ceil(cy + dy);

      if (fill) {
        for (let fx = Math.ceil(cx); fx <= xi; fx++) {
          pt.set(fx, y);
          points.add(pt.clone());
        }
      } else {
        pt.set(xi, y);
        points.add(pt.clone());
      }
    }

    for (let yi = Math.ceil(cy); yi <= y1; yi++) {
      const dy = yi - cy;
      const term = 1 - (dy * dy) / b2;
      if (term < 0) continue;
      const dx = Math.sqrt(term * a2);

      const x = Math.ceil(cx + dx);

      if (fill) {
        for (let fx = Math.ceil(cx); fx <= x; fx++) {
          pt.set(fx, yi);
          points.add(pt.clone());
        }
      } else {
        pt.set(x, yi);
        points.add(pt.clone());
      }
    }

    points.forEach(({ x, y }) => {
      const xl = Math.round(2 * cx - x);
      const yu = Math.round(2 * cy - y);

      if (xl >= x0 && xl <= x1 && y >= y0 && y <= y1) points.add(pt.set(xl, y).clone());
      if (x >= x0 && x <= x1 && yu >= y0 && yu <= y1) points.add(pt.set(x, yu).clone());
    });
  }

  points.forEach(plot);
}