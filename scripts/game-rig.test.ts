import { expect, test } from 'bun:test';
import type { SpriteSnapshot, TagInfo } from '../packages/api/src/types';
import { animationDuration, changeMovement, defaultCollider, defaultRig, DEFAULT_PHYSICS, frameAt, newState, type Box } from '../extensions/game-rig/src/rig';
import { moveAxis, stepPlatformer, type PlatformerBody, type PlatformerInput } from '../extensions/game-rig/src/physics';

const ground: Box = { x: -10000, y: 0, w: 20000, h: 10000 };
const size = { w: 10, h: 20 };
const body = (extra: Partial<PlatformerBody> = {}): PlatformerBody => ({ x: 0, y: 0, vx: 0, vy: 0, ground: true, coyote: 0, cut: false, air: 0, ...extra });
const input = (extra: Partial<PlatformerInput> = {}): PlatformerInput => ({ axis: 0, speed: 60, jumpPressed: false, jumpHeld: false, dead: false, ...extra });
const physics = (extra: Partial<typeof DEFAULT_PHYSICS> = {}) => ({ ...DEFAULT_PHYSICS, ...extra });
const sprite: SpriteSnapshot = { id: 'rig', name: 'Rig', width: 32, height: 32, colorMode: 'rgb', palette: null, transparentIndex: 0, frames: [{ duration: 100 }, { duration: 200 }, { duration: 300 }], layers: [], tags: [], slices: [], layer: 0, frame: 0, loop: null };

test('platformer jumps from the floor with zero coyote time and cannot jump twice in the air', () => {
  const h = body(), p = physics({ coyote: 0 });
  stepPlatformer(h, size, [ground], p, input({ jumpPressed: true, jumpHeld: true }), 1 / 120);
  expect(h.ground).toBe(false); expect(h.y).toBeLessThan(0); expect(h.vy).toBeLessThan(-280);
  const first = h.vy;
  stepPlatformer(h, size, [ground], p, input({ jumpPressed: true, jumpHeld: true }), 1 / 120);
  expect(h.vy).toBeGreaterThan(first);
});

test('platformer allows one coyote jump after leaving an edge, then expires the grace period', () => {
  const ledge = { x: -30, y: -40, w: 30, h: 5 };
  const h = body({ x: 4, y: -40, vx: 110 });
  const p = physics();
  stepPlatformer(h, size, [ledge, ground], p, input({ axis: 1, speed: 110 }), .02);
  expect(h.ground).toBe(false); expect(h.coyote).toBeGreaterThan(0);
  stepPlatformer(h, size, [ledge, ground], p, input({ jumpPressed: true, jumpHeld: true }), .01);
  expect(h.vy).toBeLessThan(-280); expect(h.coyote).toBe(0);
  const expired = body({ y: -100, ground: false, coyote: .01, vy: 10 });
  stepPlatformer(expired, size, [ground], p, input({ jumpPressed: true, jumpHeld: true }), .02);
  expect(expired.vy).toBeGreaterThan(0);
});

test('early release cuts only one time, and disabling jumpCut preserves the full jump', () => {
  const jump = (cut: boolean) => {
    const h = body(), p = physics({ jumpCut: cut });
    stepPlatformer(h, size, [ground], p, input({ jumpPressed: true, jumpHeld: true }), 1 / 120);
    stepPlatformer(h, size, [ground], p, input(), 1 / 120);
    return h;
  };
  const short = jump(true), full = jump(false), before = short.vy;
  expect(short.vy).toBeGreaterThan(full.vy); expect(short.cut).toBe(true);
  stepPlatformer(short, size, [ground], physics(), input(), 1 / 120);
  expect(short.vy).toBeCloseTo(before + DEFAULT_PHYSICS.gravity / 120);
});

test('swept collisions stop on thin floors, ceilings and the nearest wall at high speeds', () => {
  const platform = { x: -30, y: -40, w: 60, h: 1 };
  const h = body({ y: -200, vy: 10000, ground: false, air: .3 });
  const landed = stepPlatformer(h, size, [ground, platform], physics({ maxFall: 10000 }), input(), .05);
  expect(landed).toBe(true); expect(h.y).toBe(-40); expect(h.vy).toBe(0); expect(h.ground).toBe(true);
  const ceiling = { x: -30, y: -80, w: 60, h: 1 };
  h.vy = -10000; h.ground = false;
  stepPlatformer(h, size, [ground, platform, ceiling], physics(), input({ jumpHeld: true }), .05);
  expect(h.y).toBe(-59); expect(h.vy).toBe(0); expect(h.ground).toBe(false);
  const walls = [{ x: 100, y: -100, w: 1, h: 100 }, { x: 20, y: -100, w: 1, h: 100 }];
  const right = body(); expect(moveAxis(right, size, walls, 1000, 'x')).toBe(true); expect(right.x).toBe(15);
  const left = body({ x: 150 }); expect(moveAxis(left, size, [...walls].reverse(), -1000, 'x')).toBe(true); expect(left.x).toBe(106);
});

test('ground support works at zero gravity; max fall, air control and dead movement are respected', () => {
  const still = body(); stepPlatformer(still, size, [ground], physics({ gravity: 0 }), input(), .02);
  expect(still.ground).toBe(true);
  const falling = body({ y: -1000, vy: 419, ground: false, vx: 40 });
  stepPlatformer(falling, size, [ground], physics({ airControl: 0 }), input({ axis: -1 }), .02);
  expect(falling.vy).toBe(420); expect(falling.vx).toBe(40);
  const dead = body(); stepPlatformer(dead, size, [ground], physics(), input({ dead: true, axis: 1, jumpPressed: true, jumpHeld: true }), .02);
  expect(dead.x).toBe(0); expect(dead.y).toBe(0);
});

test('jump height and landing are stable across preview refresh rates', () => {
  const jump = (fps: number) => {
    const h = body(); let min = 0, landings = 0;
    for (let frame = 0; frame < fps * 2; frame++) {
      const steps = Math.ceil(120 / fps);
      for (let i = 0; i < steps; i++) {
        if (stepPlatformer(h, size, [ground], physics(), input({ jumpPressed: frame === 0 && i === 0, jumpHeld: true }), 1 / fps / steps)) landings++;
        min = Math.min(min, h.y);
      }
    }
    expect(h.y).toBe(0); expect(h.ground).toBe(true); expect(landings).toBe(1);
    return min;
  };
  const heights = [30, 60, 144].map(jump);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
});

test('changing to platformer prepares jump/fall, side directions and collider without losing tuning', () => {
  const initial = defaultRig(sprite);
  initial.states[0].speed = 1.75; initial.physics.jump = 420;
  const rig = changeMovement(initial, sprite, 'platformer');
  expect(rig.states.map(st => st.id)).toEqual(['idle', 'walk', 'run', 'jump', 'fall']);
  expect(rig.directions).toBe(2); expect(rig.collider).toEqual(defaultCollider(sprite, 'platformer'));
  expect(rig.states[0].speed).toBe(1.75); expect(rig.physics.jump).toBe(420); expect(rig.shadow.on).toBe(false);
  rig.collider.w = 7; rig.directions = 1; rig.states.push(newState('own_crouch'));
  const next = changeMovement(rig, sprite, 'topdown');
  expect(next.collider.w).toBe(7); expect(next.directions).toBe(1); expect(next.states.some(st => st.id === 'own_crouch')).toBe(true);
});

test('finish timing uses ping-pong order, starting offset and speed just like the displayed frames', () => {
  const tag: TagInfo = { name: 'land', from: 0, to: 2, color: '#fff', direction: 'pingpong' };
  const st = newState('land', { start: 1, speed: 2 });
  expect(animationDuration(sprite, tag, st)).toBe(350);
  expect(frameAt(sprite, tag, st, 0)).toBe(1);
  expect(frameAt(sprite, tag, st, 699)).toBe(1);
  const reverse = { ...tag, direction: 'reverse' as const };
  expect(animationDuration(sprite, reverse, newState('attack'))).toBe(600);
});
