/**
 * Game preview: a small engine that plays the sprite as a character with the rig's settings.
 *   top-down    WASD / arrows, Shift runs
 *   platformer  A D / ← →, Shift runs, W / ↑ / Space jumps, J attacks, H is hurt
 *   rts         click to send the unit, J attacks, K dies (and gets up)
 * The world is an endless grid (so movement shows), with optional blocks and platforms
 * that the collider bumps into. Frames are re-rendered when the sprite changes.
 */
import { connect, type SpriteSnapshot } from "@pixprite/api";
import { ALL_DIRS, colliderAt, frameAt, loadRig, nearestDir, resolveCell, sliceKey, type Box, type Compass, type Dir, type Rig } from "./rig";

const ctx = await connect();
const { t } = ctx.i18n;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const g = canvas.getContext('2d')!;
const showCollider = $<HTMLInputElement>('collider');
const showSlices = $<HTMLInputElement>('slices');

let sprite: SpriteSnapshot | null = null;
let rig: Rig | null = null;
let images: ImageBitmap[] = [];

const keys = new Set<string>();
const pressed = new Set<string>();
const hero = {
  x: 0, y: 0, vx: 0, vy: 0, ground: true, air: 0, coyote: 0, cut: false,
  dir: 's' as Dir, face: 1, attack: 0, hurt: 0, land: 0, dead: false,
  target: null as null | { x: number; y: number; },
};
const cam = { x: 0, y: 0 };
let anim = { state: '', dir: '' as Dir | '', time: 0 };
let shown = { state: '', tag: '' };

const side = () => rig?.movement === 'platformer';

/** Blocks (and platforms) in world pixels, laid out on the background grid */
function obstacles(): Box[] {
  if (!rig?.obstacles || !sprite) return [];
  const C = Math.max(rig.background.cell, 4);
  if (side()) return [
    { x: 4 * C, y: -2 * C, w: 3 * C, h: C / 2 },
    { x: -7 * C, y: -3 * C, w: 3 * C, h: C / 2 },
    { x: 9 * C, y: -4 * C, w: 2 * C, h: C / 2 },
    { x: 13 * C, y: -2 * C, w: C, h: 2 * C },
    { x: -12 * C, y: -1 * C, w: C, h: C },
  ];
  return [
    { x: 3 * C, y: -C, w: C, h: C },
    { x: -5 * C, y: 2 * C, w: 2 * C, h: C },
    { x: 2 * C, y: 3 * C, w: C, h: 2 * C },
    { x: -3 * C, y: -4 * C, w: 3 * C, h: C },
  ];
}

/** Solids: the obstacles, and the ground (y ≥ 0) in a platformer */
function solids(): Box[] {
  const list = obstacles();
  if (side()) list.push({ x: -1e6, y: 0, w: 2e6, h: 1e6 });
  return list;
}

/** The body used for movement: the collider of the first frame, so it doesn't jitter with animation */
const body = () => rig && sprite ? colliderAt(rig, sprite, 0) : { x: 0, y: 0, w: 1, h: 1 };

const heroBox = (): Box => { const b = body(); return { x: hero.x - b.w / 2, y: hero.y - b.h, w: b.w, h: b.h }; };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Moves along one axis and stops at the first solid; returns true when something was hit */
function move(dx: number, dy: number) {
  hero.x += dx; hero.y += dy;
  let bumped = false;
  for (const s of solids()) {
    const h = heroBox();
    if (!hit(h, s)) continue;
    bumped = true;
    if (dx > 0) hero.x = s.x - h.w / 2;
    else if (dx < 0) hero.x = s.x + s.w + h.w / 2;
    else if (dy > 0) hero.y = s.y;
    else if (dy < 0) hero.y = s.y + s.h + h.h;
  }
  return bumped;
}

/** Speeds `v` toward `target` at `rate` per second */
const approach = (v: number, target: number, rate: number) => v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);

const dir8 = (dx: number, dy: number): Compass => ALL_DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];

/** Own states switched on by their keys (toggled ones stay on) */
const ownOn = new Set<string>();
/** States whose alternative variant (with a bomb…) is on */
const altOn = new Set<string>();
const altFor = (stateId: string) => altOn.has(stateId);

/** How long a state's animation plays once through for the current direction, seconds */
function duration(stateId: string) {
  const r = rig && sprite && resolveCell(rig, sprite, stateId, hero.dir, altFor);
  if (!r || r.state.id !== stateId) return 0;
  const ms = sprite!.frames.slice(r.tag.from, r.tag.to + 1).reduce((a, f) => a + f.duration, 0);
  return ms / 1000 / r.state.speed;
}

const has = (id: string) => !!rig?.states.some(x => x.id === id);
const moveOf = (id: string, fallback: number) => rig?.states.find(x => x.id === id)?.move ?? fallback;

function step(dt: number) {
  if (!rig) return;
  const p = rig.physics;
  const k = (...codes: string[]) => codes.some(c => keys.has(c));
  const tap = (...codes: string[]) => codes.some(c => pressed.has(c));
  // Each state's variant follows its own key: held, or flipped on each press
  for (const st of rig.states) {
    if (!st.alt.on) { altOn.delete(st.id); continue; }
    const on = st.alt.mode === 'hold' ? keys.has(st.alt.key) : pressed.has(st.alt.key) ? !altOn.has(st.id) : altOn.has(st.id);
    if (on) altOn.add(st.id); else altOn.delete(st.id);
  }
  // Own states: a hold one is on while its key is down, a toggle one flips on each press
  for (const st of rig.states) if (st.key) {
    if (st.mode === 'hold') { if (keys.has(st.key)) ownOn.add(st.id); else ownOn.delete(st.id); }
    else if (pressed.has(st.key)) { if (ownOn.has(st.id)) ownOn.delete(st.id); else ownOn.add(st.id); }
  }
  const own = rig.states.find(x => ownOn.has(x.id));
  const running = k('ShiftLeft', 'ShiftRight') && has('run');
  const walkSpeed = moveOf('walk', 60), runSpeed = moveOf('run', walkSpeed * 1.8);
  const top = own ? own.move ?? walkSpeed : running ? runSpeed : walkSpeed;
  const ix = +k('KeyD', 'ArrowRight') - +k('KeyA', 'ArrowLeft');
  const iy = +k('KeyS', 'ArrowDown') - +k('KeyW', 'ArrowUp');
  hero.attack = Math.max(0, hero.attack - dt);
  hero.hurt = Math.max(0, hero.hurt - dt);
  hero.land = Math.max(0, hero.land - dt);
  if (has('attack') && tap('KeyJ', 'KeyX') && !hero.attack && !hero.dead) hero.attack = duration('attack') || 0.3;
  if (has('hurt') && tap('KeyH') && !hero.hurt && !hero.dead) hero.hurt = duration('hurt') || 0.3;
  if (has('death') && tap('KeyK')) { hero.dead = !hero.dead; hero.target = null; }
  let state = 'idle';
  let facing: Compass | null = null;

  if (rig.movement === 'platformer') {
    const control = hero.ground ? 1 : p.airControl;
    hero.vx = approach(hero.vx, hero.dead ? 0 : ix * top, (ix ? p.accel : p.decel) * control * dt);
    if (hero.ground) hero.coyote = p.coyote / 1000; else hero.coyote = Math.max(0, hero.coyote - dt);
    if (!hero.dead && tap('KeyW', 'ArrowUp', 'Space') && hero.coyote > 0) { hero.vy = -p.jump; hero.ground = false; hero.coyote = 0; hero.cut = false; }
    // Letting go early makes a lower jump
    if (p.jumpCut && !hero.cut && hero.vy < 0 && !k('KeyW', 'ArrowUp', 'Space')) { hero.vy *= 0.45; hero.cut = true; }
    hero.vy = Math.min(p.maxFall, hero.vy + p.gravity * dt);
    if (move(hero.vx * dt, 0)) hero.vx = 0;
    const wasGround = hero.ground;
    hero.ground = false;
    if (move(0, hero.vy * dt)) {
      if (hero.vy > 0) {
        hero.ground = true;
        if (!wasGround && hero.air > 0.2 && has('land')) hero.land = duration('land');
      }
      hero.vy = 0;
    }
    hero.air = hero.ground ? 0 : hero.air + dt;
    if (Math.abs(hero.vx) > 1) facing = hero.vx < 0 ? 'w' : 'e';
    const moving = Math.abs(hero.vx) > 2;
    state = !hero.ground ? (hero.vy < 0 || !has('fall') ? 'jump' : 'fall') : hero.land ? 'land' : moving ? (running ? 'run' : 'walk') : 'idle';
  } else {
    let tx = 0, ty = 0;
    if (rig.movement === 'rts') {
      const tg = hero.target;
      if (tg && !hero.dead) {
        const dx = tg.x - hero.x, dy = tg.y - hero.y, d = Math.hypot(dx, dy);
        if (d <= Math.max(0.5, p.arrive)) hero.target = null;
        else {
          // Slows down on arrival so it doesn't overshoot
          const v = Math.min(top, Math.sqrt(2 * p.decel * d));
          tx = dx / d * v; ty = dy / d * v;
        }
      }
    } else if (!hero.dead) {
      const len = Math.hypot(ix, iy) || 1;
      tx = ix / len * top; ty = iy / len * top;
    }
    const rate = (tx || ty ? p.accel : p.decel) * dt;
    hero.vx = approach(hero.vx, tx, rate); hero.vy = approach(hero.vy, ty, rate);
    if (move(hero.vx * dt, 0)) hero.vx = 0;
    if (move(0, hero.vy * dt)) hero.vy = 0;
    if (tx || ty) facing = dir8(tx, ty);
    state = Math.hypot(hero.vx, hero.vy) > 2 ? (running ? 'run' : 'walk') : 'idle';
  }
  if (facing) hero.dir = nearestDir(rig, facing);
  if (own) state = own.id;
  if (hero.hurt) state = 'hurt';
  else if (hero.attack) state = 'attack';
  if (hero.dead) state = 'death';
  pressed.clear();
  // How fast the character goes compared with the state's own speed: the animation keeps pace
  const st = rig.states.find(x => x.id === state);
  const now = rig.movement === 'platformer' ? Math.abs(hero.vx) : Math.hypot(hero.vx, hero.vy);
  const base = st?.move ?? 0;
  const pace = st?.follow && base > 0 && now > 1 ? Math.max(0.25, Math.min(3, now / base)) : 1;
  switchTo(state, dt * pace);
}

/**
 * Changes the playing state by its rules: a state that must finish is seen through, `continue`
 * keeps the frame position, and turning keeps it too unless the state says otherwise.
 */
function switchTo(state: string, dt: number) {
  const cur = rig!.states.find(x => x.id === anim.state);
  if (state !== anim.state && cur?.finish && state !== 'death') {
    const left = duration(cur.id) * 1000 - anim.time * 1000;
    if (left > 0) { anim.time += dt; return; }
  }
  const next = rig!.states.find(x => x.id === state);
  if (state !== anim.state) anim = { state, dir: hero.dir, time: next?.enter === 'continue' ? anim.time : 0 };
  else if (hero.dir !== anim.dir) anim = { state, dir: hero.dir, time: next?.keepOnTurn === false ? 0 : anim.time + dt };
  else anim.time += dt;
}

/** Frame for the current state and direction, and whether it shows mirrored */
function frameNow(): { frame: number; flip: boolean; } {
  const s = sprite!;
  const r = resolveCell(rig!, s, anim.state, hero.dir, altFor);
  // A single-direction side view turns by mirroring
  const turned = rig!.directions === 1 && rig!.movement !== 'topdown' && hero.face < 0;
  if (!r) { shown = { state: anim.state, tag: '' }; return { frame: 0, flip: turned }; }
  shown = { state: r.state.id, tag: r.tag.name };
  return { frame: frameAt(s, r.tag, r.state, anim.time * 1000 * r.state.speed), flip: r.flip !== turned };
}

function zoomNow() {
  if (!sprite || !rig) return 1;
  if (rig.camera.zoom > 0) return rig.camera.zoom * Math.max(1, Math.round(devicePixelRatio));
  return Math.max(1, Math.floor(Math.min(canvas.width / (sprite.width * 6), canvas.height / (sprite.height * 3.5))));
}

function updateCamera(dt: number) {
  if (!rig) return;
  const b = body();
  const fx = hero.x, fy = hero.y - b.h / 2;
  let tx = cam.x, ty = cam.y;
  if (rig.camera.mode === 'fixed') { tx = 0; ty = side() ? -canvas.height / zoomNow() / 4 : 0; }
  else {
    // Inside the dead zone the camera stays put
    const hw = rig.camera.deadW / 2, hh = rig.camera.deadH / 2;
    if (fx < cam.x - hw) tx = fx + hw; else if (fx > cam.x + hw) tx = fx - hw;
    if (fy < cam.y - hh) ty = fy + hh; else if (fy > cam.y + hh) ty = fy - hh;
  }
  const k = 1 - Math.pow(rig.camera.smooth, dt * 60);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

function drawBackground(zoom: number) {
  const bg = rig!.background;
  const w = canvas.width / zoom, h = canvas.height / zoom;
  const x0 = cam.x - w / 2, y0 = cam.y - h / 2;
  g.fillStyle = bg.a;
  g.fillRect(x0, y0, w, h);
  const c = bg.cell;
  const i0 = Math.floor(x0 / c), i1 = Math.ceil((x0 + w) / c), j0 = Math.floor(y0 / c), j1 = Math.ceil((y0 + h) / c);
  if (bg.kind === 'checker') {
    g.fillStyle = bg.b;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if ((i + j) & 1) g.fillRect(i * c, j * c, c, c);
  } else if (bg.kind === 'lines') {
    g.fillStyle = bg.b;
    const lw = 1 / zoom;
    for (let i = i0; i <= i1; i++) g.fillRect(i * c, y0, lw, h);
    for (let j = j0; j <= j1; j++) g.fillRect(x0, j * c, w, lw);
  }
}

function drawSolids(zoom: number) {
  const lw = 1 / zoom;
  for (const s of solids()) {
    g.fillStyle = 'rgba(0, 0, 0, .35)';
    g.fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle = 'rgba(255, 255, 255, .3)';
    g.fillRect(s.x, s.y, s.w, lw);
  }
}

/** Top of the surface right under the hero (platformer), for the shadow */
function floorUnder() {
  const b = heroBox();
  let best = Infinity;
  for (const s of solids()) if (s.y >= hero.y - 0.01 && s.x < b.x + b.w && s.x + s.w > b.x) best = Math.min(best, s.y);
  return best === Infinity ? hero.y : best;
}

function drawShadow() {
  const sh = rig!.shadow;
  if (!sh.on) return;
  const floor = side() ? floorUnder() : hero.y;
  // Smaller and fainter the higher the character is above the floor
  const k = side() ? Math.max(0.35, 1 - (floor - hero.y) / (sprite!.height * 3)) : 1;
  g.fillStyle = `rgba(0, 0, 0, ${sh.opacity * k})`;
  g.beginPath();
  g.ellipse(hero.x, floor + sh.dy, sh.w / 2 * k, sh.h / 2 * k, 0, 0, Math.PI * 2);
  g.fill();
}

function drawHero(zoom: number) {
  const s = sprite!;
  const { frame, flip } = frameNow();
  const col = colliderAt(rig!, s, frame);
  const cx = col.x + col.w / 2, by = col.y + col.h;
  g.save();
  g.translate(Math.round(hero.x * zoom) / zoom, Math.round(hero.y * zoom) / zoom);
  if (flip) g.scale(-1, 1);
  if (images[frame]) g.drawImage(images[frame], -cx, -by);
  const lw = 1 / zoom;
  if (showSlices.checked) for (const sl of s.slices) {
    const key = sliceKey(sl, frame);
    if (!key) continue;
    g.strokeStyle = sl.color;
    g.lineWidth = lw;
    g.strokeRect(key.x - cx + lw / 2, key.y - by + lw / 2, key.w - lw, key.h - lw);
  }
  if (showCollider.checked) {
    g.strokeStyle = '#ff4d6d';
    g.lineWidth = lw;
    g.strokeRect(col.x - cx + lw / 2, col.y - by + lw / 2, col.w - lw, col.h - lw);
  }
  g.restore();
}

function draw() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!sprite || !rig || !images.length) return;
  const zoom = zoomNow();
  g.imageSmoothingEnabled = false;
  g.setTransform(zoom, 0, 0, zoom, Math.round(canvas.width / 2 - cam.x * zoom), Math.round(canvas.height / 2 - cam.y * zoom));
  drawBackground(zoom);
  drawSolids(zoom);
  if (hero.target) {
    g.strokeStyle = 'rgba(120, 255, 140, .9)';
    g.lineWidth = 1 / zoom;
    g.beginPath(); g.arc(hero.target.x, hero.target.y, 3, 0, Math.PI * 2); g.stroke();
  }
  drawShadow();
  drawHero(zoom);
  const sp = Math.round(Math.hypot(hero.vx, hero.vy));
  $('info').textContent = `${shown.state}/${hero.dir}${shown.tag ? ` → ${shown.tag}` : ` (${t('preview.noTag')})`} · ${sp} px/s`;
}

function reset() {
  Object.assign(hero, { x: 0, y: 0, vx: 0, vy: 0, ground: true, air: 0, coyote: 0, cut: false, dir: rig ? nearestDir(rig, 's') : 's', face: 1, attack: 0, hurt: 0, land: 0, dead: false, target: null });
  ownOn.clear();
  altOn.clear();
  const b = body();
  Object.assign(cam, { x: 0, y: -b.h / 2 });
  anim = { state: '', dir: '', time: 0 };
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const r = canvas.getBoundingClientRect();
  // The backing store is in device pixels, so the picture stays sharp at any page zoom
  const w = Math.max(1, Math.round(r.width * devicePixelRatio)), h = Math.max(1, Math.round(r.height * devicePixelRatio));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (sprite && rig) { step(dt); updateCamera(dt); }
  draw();
  requestAnimationFrame(tick);
}

function labels() {
  $('colliderLabel').textContent = t('preview.collider');
  $('slicesLabel').textContent = t('preview.slices');
  $('reset').textContent = t('preview.reset');
  const own = rig?.states.filter(x => x.key).map(x => `${x.key!.replace(/^Key|^Digit/, '')} — ${x.name ?? x.id}`) ?? [];
  for (const st of rig?.states ?? []) if (st.alt.on) own.push(`${st.alt.key.replace(/^Key|^Digit/, '')} — ${st.alt.name} (${st.id})`);
  $('hint').textContent = !sprite || !rig ? t('noSprite') : [t(`hint.${rig.movement}`), ...own].join(' · ');
}

let setup = '';
async function reload() {
  const s = await ctx.sprite.get().catch(() => null);
  const next: ImageBitmap[] = [];
  if (s) for (let f = 0; f < s.frames.length; f++) next.push(await ctx.sprite.render(f));
  images.forEach(i => i.close());
  images = next;
  const docChanged = s?.id !== sprite?.id;
  sprite = s;
  rig = s ? loadRig(await ctx.meta.get<Rig>({ kind: 'sprite' }, 'rig').catch(() => undefined), s) : null;
  const nextSetup = rig ? `${rig.movement}/${rig.directions}` : '';
  if (docChanged || nextSetup !== setup) { setup = nextSetup; reset(); }
  labels();
}

canvas.addEventListener('keydown', e => {
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
canvas.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', e => {
  canvas.focus();
  if (rig?.movement !== 'rts' || hero.dead) return;
  const r = canvas.getBoundingClientRect(), zoom = zoomNow();
  const px = (e.clientX - r.left) * canvas.width / r.width, py = (e.clientY - r.top) * canvas.height / r.height;
  hero.target = { x: cam.x + (px - canvas.width / 2) / zoom, y: cam.y + (py - canvas.height / 2) / zoom };
});
$('reset').addEventListener('click', () => { reset(); canvas.focus(); });

let timer: ReturnType<typeof setTimeout> | undefined;
const later = () => { clearTimeout(timer); timer = setTimeout(() => reload().catch(console.error), 200); };
ctx.events.on('sprite:change', later);
ctx.documents.on('change', later);
ctx.i18n.on('change', labels);

labels();
await reload();
canvas.focus();
requestAnimationFrame(tick);
