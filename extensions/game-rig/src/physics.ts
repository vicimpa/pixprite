import type { Box, Physics } from './rig';

/** World position is the centre of the collider's bottom edge. */
export type Body = { x: number; y: number; vx: number; vy: number };
export type PlatformerBody = Body & { ground: boolean; coyote: number; cut: boolean; air: number };
export type PlatformerInput = { axis: number; speed: number; jumpPressed: boolean; jumpHeld: boolean; dead: boolean };
export const approach = (v: number, target: number, delta: number) => v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);

export function bodyBox(body: Body, size: Pick<Box, 'w' | 'h'>): Box {
  return { x: body.x - size.w / 2, y: body.y - size.h, w: size.w, h: size.h };
}

/** Sweep the whole path, stopping at the nearest surface even across a thin platform. */
export function moveAxis(body: Body, size: Pick<Box, 'w' | 'h'>, solids: Box[], delta: number, axis: 'x' | 'y') {
  if (!delta) return false;
  const box = bodyBox(body, size);
  let distance = delta, bumped = false;
  for (const solid of solids) {
    const along = axis === 'x' ? box.x : box.y, length = axis === 'x' ? box.w : box.h;
    const near = axis === 'x' ? solid.x : solid.y, far = near + (axis === 'x' ? solid.w : solid.h);
    const across = axis === 'x' ? box.y : box.x, extent = axis === 'x' ? box.h : box.w;
    const crossNear = axis === 'x' ? solid.y : solid.x, crossFar = crossNear + (axis === 'x' ? solid.h : solid.w);
    if (across >= crossFar || across + extent <= crossNear) continue;
    if (delta > 0 && along + length <= near && along + length + distance >= near) { distance = near - along - length; bumped = true; }
    if (delta < 0 && along >= far && along + distance <= far) { distance = far - along; bumped = true; }
  }
  body[axis] += distance;
  return bumped;
}

function supported(body: Body, size: Pick<Box, 'w' | 'h'>, solids: Box[]) {
  const b = bodyBox(body, size);
  return solids.some(s => Math.abs(body.y - s.y) < 1e-7 && b.x < s.x + s.w && b.x + b.w > s.x);
}

/** Returns true on a landing after a visible flight, for the optional land animation. */
export function stepPlatformer(body: PlatformerBody, size: Pick<Box, 'w' | 'h'>, solids: Box[], p: Physics, input: PlatformerInput, dt: number) {
  body.ground = body.ground && supported(body, size, solids);
  const wasGround = body.ground;
  const control = body.ground ? 1 : p.airControl;
  body.vx = approach(body.vx, input.dead ? 0 : input.axis * input.speed, (input.axis && !input.dead ? p.accel : p.decel) * control * dt);
  body.coyote = body.ground ? p.coyote / 1000 : Math.max(0, body.coyote - dt);
  // The grace period extends a ground jump; a zero grace period must not disable it.
  if (!input.dead && input.jumpPressed && p.jump > 0 && (body.ground || body.coyote > 0)) {
    body.vy = -p.jump; body.ground = false; body.coyote = 0; body.cut = false;
  }
  if (p.jumpCut && !body.cut && body.vy < 0 && !input.jumpHeld) { body.vy *= 0.45; body.cut = true; }
  body.vy = Math.min(p.maxFall, body.vy + p.gravity * dt);
  if (moveAxis(body, size, solids, body.vx * dt, 'x')) body.vx = 0;
  const landed = moveAxis(body, size, solids, body.vy * dt, 'y');
  body.ground = body.vy >= 0 && supported(body, size, solids);
  if (landed) body.vy = 0;
  const playLand = !wasGround && body.ground && body.air > 0.2;
  body.air = body.ground ? 0 : body.air + dt;
  return playLand;
}
