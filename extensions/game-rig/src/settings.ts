/**
 * Settings of the game rig. The character's directions and states form a grid of crossings;
 * a state is edited on a compass: arrows around the live animation, a dot on each arrow filled
 * when that direction has a tag. The collider is a box dragged over the frame. Every change is
 * saved to the sprite (debounced); "Play" opens the preview window.
 */
import { connect, type SpriteSnapshot } from "@pixprite/api";
import {
  altRow, autofill, colliderAt, defaultCollider, dirAngle, dirsOf, DIR_COUNTS, frameAt, isBuiltin, loadRig, mirrorOf, MOVEMENTS, MOVING, newState,
  physicsOf, resolveCell, statesFor, usedTags, type Box, type Compass, type Dir, type DirCount, type Movement, type Physics, type Rig, type State,
} from "./rig";

const ctx = await connect();
const { t } = ctx.i18n;
const SPRITE = { kind: 'sprite' } as const;

let sprite: SpriteSnapshot | null = null;
let rig: Rig | null = null;
let frames: ImageBitmap[] = [];
/** What the form was built from; it is rebuilt only when this changes (typing keeps focus) */
let built = '';
let selState = 'idle';
let selDir: Dir = 's';
/** Editing the alternative variant's tags */
let selAlt = false;
/** Row of `cells` being edited */
const rowKey = (r: Rig, id: string) => selAlt && r.states.find(x => x.id === id)?.alt.on ? altRow(id) : id;

const root = document.getElementById('root')!;
const play = document.getElementById('play') as HTMLButtonElement;

type Props = Record<string, unknown> & { on?: Record<string, (e: Event) => void>; };
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string | null | false | undefined)[]) {
  const node = document.createElement(tag);
  const { on, ...rest } = props;
  Object.assign(node, rest);
  for (const [k, fn] of Object.entries(on ?? {})) node.addEventListener(k, fn);
  for (const k of kids) if (k) node.append(k);
  return node;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Edits not written yet: the document is not read back over them */
let dirty = false;
function save(rebuild = false) {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!rig) return;
    try {
      await ctx.meta.set(SPRITE, 'rig', rig);
      await applyLock();
    } catch (e) { console.error(e); }
    dirty = false;
  }, 350);
  if (rebuild) render();
}

/** The rig's tags can't be renamed or deleted while `lock` is on */
async function applyLock() {
  if (!rig) return;
  const ours = (await ctx.locks.get())?.owner === ctx.id;
  if (rig.lock && usedTags(rig).length) await ctx.locks.set({ tags: { delete: true, rename: true } });
  else if (ours) await ctx.locks.clear();
}

function num(value: number, set: (v: number) => void, opts: { min?: number; max?: number; step?: number; } = {}) {
  return el('input', {
    type: 'number', value: String(value), min: String(opts.min ?? 0), max: opts.max !== undefined ? String(opts.max) : '', step: String(opts.step ?? 1),
    on: { input: e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { set(v); save(); } } },
  });
}
const check = (value: boolean, set: (v: boolean) => void, rebuild = false) =>
  el('input', { type: 'checkbox', checked: value, on: { change: e => { set((e.target as HTMLInputElement).checked); save(rebuild); } } });
function select<T extends string>(value: T, options: { value: T; label: string; }[], set: (v: T) => void, rebuild = false) {
  return el('select', { on: { change: e => { set((e.target as HTMLSelectElement).value as T); save(rebuild); } } },
    ...options.map(o => el('option', { value: o.value, textContent: o.label, selected: o.value === value })));
}
const color = (value: string, set: (v: string) => void) => el('input', { type: 'color', value, on: { input: e => { set((e.target as HTMLInputElement).value); save(); } } });
const row = (label: string, ...kids: (Node | string | null | false)[]) => el('div', { className: 'row' }, el('span', { textContent: label }), ...kids);
const unit = (text: string) => el('span', { className: 'unit', textContent: text });
const note = (text: string) => el('div', { className: 'note', textContent: text });

function segmented<T extends string | number>(value: T, options: { value: T; label: string; title?: string; }[], set: (v: T) => void) {
  return el('div', { className: 'seg' }, ...options.map(o => el('button', {
    textContent: o.label, title: o.title ?? '', className: o.value === value ? 'on' : '',
    on: { click: () => { set(o.value); save(true); } },
  })));
}

const openState = new Map<string, boolean>();
function section(id: string, title: string, open: boolean, ...kids: (Node | null | false | undefined)[]) {
  const d = el('details', { open: openState.get(id) ?? open, on: { toggle: () => openState.set(id, d.open) } }, el('summary', { textContent: title }), el('div', { className: 'body' }, ...kids));
  return d;
}

const stateName = (st: State) => isBuiltin(st.id) ? t(`state.${st.id}`) : st.name || st.id;
const dirName = (d: Dir) => t(`dir.${d}`);
const keyName = (code?: string) => !code ? '—' : code.replace(/^Key/, '').replace(/^Digit/, '');

/** A field that takes the next key pressed; while focused it is lit and asks for the key */
function keyInput(get: () => string | undefined, set: (code: string) => void) {
  return el('input', {
    value: keyName(get()), readOnly: true, title: t('settings.keyHint'), className: 'key',
    on: {
      focus: e => { (e.target as HTMLInputElement).value = t('settings.pressKey'); },
      blur: e => { (e.target as HTMLInputElement).value = keyName(get()); },
      keydown: e => {
        const k = e as KeyboardEvent;
        // Tab still moves on; Escape gives up
        if (k.code === 'Tab') return;
        k.preventDefault();
        const input = k.target as HTMLInputElement;
        // Some keyboards (and synthetic events) leave `code` empty: name the key by what it types
        const code = k.code || (k.key.length === 1 ? `Key${k.key.toUpperCase()}` : k.key);
        if (code && code !== 'Escape') { set(code); save(); }
        input.blur();
      },
    },
  });
}

function characterSection(r: Rig, s: SpriteSnapshot) {
  const moves = MOVEMENTS.map(m => ({ value: m, label: t(`movement.${m}`) }));
  return section('character', t('settings.character'), true,
    row(t('settings.movement'), select(r.movement, moves, v => { r.movement = v as Movement; }, true)),
    note(t(`movementHint.${r.movement}`)),
    row(t('settings.directions'), segmented<DirCount>(r.directions, DIR_COUNTS.map(n => ({ value: n, label: String(n), title: t(`directions.${n}`) })), v => {
      r.directions = v;
      Object.assign(r, autofill(r, s.tags));
      if (!dirsOf(v).includes(selDir)) selDir = dirsOf(v)[0];
    })),
    statesBar(r, s),
  );
}

function statesBar(r: Rig, s: SpriteSnapshot) {
  const missing = statesFor(r.movement).filter(id => !r.states.some(x => x.id === id));
  const add = el('select', {
    className: 'add', title: t('settings.addState'),
    on: {
      change: async e => {
        const v = (e.target as HTMLSelectElement).value;
        (e.target as HTMLSelectElement).value = '';
        if (!v) return;
        let st: State;
        if (v === '*') {
          const name = (await ctx.ui.prompt(t('settings.ownStateName'), ''))?.trim();
          if (!name) return;
          const id = `own_${name.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '_')}`;
          if (r.states.some(x => x.id === id)) return;
          st = newState(id, { name, mode: 'toggle' });
        } else st = newState(v);
        r.states.push(st);
        selState = st.id;
        Object.assign(r, autofill(r, s.tags));
        save(true);
      },
    },
  }, el('option', { value: '', textContent: `+ ${t('settings.addState')}` }),
    ...missing.map(id => el('option', { value: id, textContent: t(`state.${id}`) })),
    el('option', { value: '*', textContent: t('settings.ownState') }));
  return el('div', { className: 'chips' },
    ...r.states.map(st => {
      const dirs = dirsOf(r.directions);
      const done = dirs.filter(d => r.cells[st.id]?.[d]?.tag).length;
      return el('span', { className: `chip${st.id === selState ? ' on' : ''}`, title: `${done} / ${dirs.length}`, on: { click: () => { selState = st.id; render(); } } },
        el('span', { textContent: stateName(st) }),
        el('span', { className: `count${done === dirs.length ? ' full' : done ? '' : ' none'}`, textContent: `${done}/${dirs.length}` }),
        st.alt.on && el('span', { className: 'alt', textContent: `+${keyName(st.alt.key)}`, title: st.alt.name }),
        st.id !== 'idle' && el('span', {
          className: 'x', textContent: '×', title: t('settings.removeState'),
          on: { click: (e: Event) => { e.stopPropagation(); r.states = r.states.filter(x => x !== st); delete r.cells[st.id]; if (selState === st.id) selState = 'idle'; save(true); } },
        }));
    }),
    add);
}

const COMPASS = 200;
let compass: HTMLCanvasElement | null = null;
let compassStart = performance.now();

/** Where a direction's dot sits on the compass, css pixels */
function dotAt(d: Dir, size: number) {
  if (d === 'any') return { x: size / 2, y: size - 14 };
  const a = dirAngle(d as Compass), r = size / 2 - 14;
  return { x: size / 2 + Math.cos(a) * r, y: size / 2 + Math.sin(a) * r };
}

function compassSection(r: Rig, s: SpriteSnapshot) {
  const st = r.states.find(x => x.id === selState) ?? r.states[0];
  if (!st) return null;
  selState = st.id;
  const dirs = dirsOf(r.directions);
  if (!dirs.includes(selDir)) selDir = dirs[0];
  if (!st.alt.on) selAlt = false;
  const key = rowKey(r, st.id);
  const cell = r.cells[key]?.[selDir] ?? { tag: null, flip: false };
  const setCell = (patch: Partial<typeof cell>) => { r.cells[key] = { ...r.cells[key], [selDir]: { ...cell, ...patch } }; };

  compass = el('canvas', { className: 'compass', width: COMPASS * devicePixelRatio, height: COMPASS * devicePixelRatio });
  compass.style.width = compass.style.height = `${COMPASS}px`;
  compass.addEventListener('click', e => {
    const b = compass!.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    let best: Dir | null = null, dist = 26;
    for (const d of dirs) { const p = dotAt(d, COMPASS); const k = Math.hypot(p.x - x, p.y - y); if (k < dist) { dist = k; best = d; } }
    if (best) { selDir = best; compassStart = performance.now(); render(); }
  });

  const tags = [{ value: '', label: t('settings.noTag') }, ...s.tags.map(x => ({ value: x.name, label: x.name }))];
  const m = mirrorOf(selDir);
  return section('state', `${t('settings.state')}: ${stateName(st)}`, true,
    st.alt.on && segmented<string>(selAlt ? 'alt' : 'usual', [{ value: 'usual', label: t('settings.usual') }, { value: 'alt', label: st.alt.name }], v => { selAlt = v === 'alt'; compassStart = performance.now(); }),
    el('div', { className: 'compassWrap' }, compass),
    row(t('settings.tagFor', { dir: dirName(selDir) }), select(cell.tag ?? '', tags, v => { setCell({ tag: v || null }); compassStart = performance.now(); }, true)),
    m && row(t('settings.flip'), check(cell.flip, v => setCell({ flip: v }), true), unit(t('settings.flipHint'))),
    note(t('settings.compassHint')),
    el('div', { className: 'sub', textContent: t('settings.alt') }),
    row(t('settings.altOn'), check(st.alt.on, v => { st.alt.on = v; if (v) Object.assign(r, autofill(r, s.tags)); else selAlt = false; }, true)),
    st.alt.on && row(t('settings.altName'), el('input', { value: st.alt.name, title: t('settings.altNameHint'), on: { change: e => { st.alt.name = (e.target as HTMLInputElement).value.trim() || st.alt.name; Object.assign(r, autofill(r, s.tags)); save(true); } } })),
    st.alt.on && row(t('settings.key'),
      keyInput(() => st.alt.key, code => { st.alt.key = code; }),
      select(st.alt.mode, [{ value: 'hold', label: t('mode.hold') }, { value: 'toggle', label: t('mode.toggle') }], v => { st.alt.mode = v; })),
    st.alt.on && note(t('settings.altHint')),
    el('div', { className: 'sub', textContent: t('settings.playback') }),
    row(t('settings.loop'), check(st.loop, v => { st.loop = v; }, true)),
    row(t('settings.speed'), num(Math.round(st.speed * 100), v => { st.speed = Math.max(0.05, v / 100); }, { min: 5, max: 400, step: 5 }), unit('%')),
    row(t('settings.start'), num(st.start, v => { st.start = Math.max(0, Math.round(v)); compassStart = performance.now(); }, { max: 999 })),
    st.loop && row(t('settings.loopFrom'), num(st.loopFrom, v => { st.loopFrom = Math.max(0, Math.round(v)); }, { max: 999 }), unit(t('settings.loopFromHint'))),
    el('div', { className: 'sub', textContent: t('settings.switching') }),
    row(t('settings.enter'), select(st.enter, [{ value: 'restart', label: t('enter.restart') }, { value: 'continue', label: t('enter.continue') }], v => { st.enter = v; })),
    row(t('settings.finish'), check(st.finish, v => { st.finish = v; })),
    row(t('settings.keepOnTurn'), check(st.keepOnTurn, v => { st.keepOnTurn = v; })),
    (MOVING.has(st.id) || !isBuiltin(st.id)) && row(t('settings.move'), num(st.move ?? 0, v => { st.move = Math.max(0, v); }, { max: 10000, step: 5 }), unit('px/s')),
    (MOVING.has(st.id) || !isBuiltin(st.id)) && row(t('settings.follow'), check(st.follow, v => { st.follow = v; })),
    !isBuiltin(st.id) && row(t('settings.ownName'), el('input', { value: st.name ?? '', on: { change: e => { st.name = (e.target as HTMLInputElement).value.trim() || st.name; save(true); } } })),
    !isBuiltin(st.id) && row(t('settings.key'),
      keyInput(() => st.key, code => { st.key = code; }),
      select(st.mode ?? 'toggle', [{ value: 'toggle', label: t('mode.toggle') }, { value: 'hold', label: t('mode.hold') }], v => { st.mode = v; })),
  );
}

/** Draws the compass: the selected crossing's animation in the middle, dots for every direction */
function drawCompass(now: number) {
  const c = compass, r = rig, s = sprite;
  if (!c || !c.isConnected || !r || !s) return;
  const g = c.getContext('2d')!;
  const k = devicePixelRatio;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, COMPASS, COMPASS);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#f0b24a';
  const dim = css.getPropertyValue('--fg-dim').trim() || '#8f87a0';
  const fg = css.getPropertyValue('--fg').trim() || '#ece6f2';

  // The animation of the selected crossing (or what would stand in for it, faded)
  const res = resolveCell(r, s, selState, selDir, () => selAlt);
  const inner = COMPASS - 64;
  g.save();
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(32, 32, inner, inner);
  if (res && frames.length) {
    const { tag, flip, state, exact } = res;
    const frame = frameAt(s, tag, state, (now - compassStart) * state.speed);
    const fit = Math.min(inner / s.width, inner / s.height);
    const zoom = fit >= 1 ? Math.floor(fit) : fit;
    const w = s.width * zoom, h = s.height * zoom;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = exact ? 1 : 0.35;
    g.translate(COMPASS / 2, COMPASS / 2);
    if (flip) g.scale(-1, 1);
    if (frames[frame]) g.drawImage(frames[frame], -w / 2, -h / 2, w, h);
  } else {
    g.fillStyle = dim;
    g.font = '11px sans-serif';
    g.textAlign = 'center';
    g.fillText(t('settings.noTag'), COMPASS / 2, COMPASS / 2 + 4);
  }
  g.restore();

  // Arrows with a dot each: filled = has a tag, hollow = empty, ringed = the one being edited
  for (const d of dirsOf(r.directions)) {
    const p = dotAt(d, COMPASS);
    const cell = r.cells[rowKey(r, selState)]?.[d];
    const on = !!cell?.tag && s.tags.some(x => x.name === cell.tag);
    if (d !== 'any') {
      const a = dirAngle(d as Compass);
      g.strokeStyle = d === selDir ? accent : dim;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(COMPASS / 2 + Math.cos(a) * (inner / 2 + 2), COMPASS / 2 + Math.sin(a) * (inner / 2 + 2));
      g.lineTo(p.x - Math.cos(a) * 8, p.y - Math.sin(a) * 8);
      g.stroke();
    }
    g.beginPath();
    g.arc(p.x, p.y, 6, 0, Math.PI * 2);
    g.fillStyle = on ? accent : 'transparent';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = on ? accent : dim;
    g.stroke();
    if (cell?.flip && on) { g.fillStyle = '#000'; g.font = 'bold 8px sans-serif'; g.textAlign = 'center'; g.fillText('⇋', p.x, p.y + 3); }
    if (d === selDir) { g.beginPath(); g.arc(p.x, p.y, 9.5, 0, Math.PI * 2); g.strokeStyle = fg; g.lineWidth = 1; g.stroke(); }
  }
}

let colCanvas: HTMLCanvasElement | null = null;
let colZoom = 1;

function colliderSection(r: Rig, s: SpriteSnapshot) {
  const sources = [{ value: '', label: t('collider.manual') }, ...s.slices.map(x => ({ value: x.name, label: t('collider.slice', { name: x.name }) }))];
  colCanvas = el('canvas', { className: 'collider' });
  colZoom = Math.max(1, Math.floor(220 / Math.max(s.width, s.height)));
  const W = s.width * colZoom, H = s.height * colZoom;
  colCanvas.width = W * devicePixelRatio; colCanvas.height = H * devicePixelRatio;
  colCanvas.style.width = `${W}px`; colCanvas.style.height = `${H}px`;
  if (!r.collider.slice) attachColliderDrag(colCanvas, r, s);
  const redraw = () => drawCollider();
  queueMicrotask(redraw);
  return section('collider', t('settings.collider'), false,
    note(r.collider.slice ? t('collider.sliceNote') : t('collider.dragHint')),
    el('div', { className: 'colliderWrap' }, colCanvas),
    el('div', { className: 'buttons two' },
      el('button', { textContent: t('collider.fit'), title: t('collider.fitHint'), on: { click: () => void fitCollider() } }),
      el('button', { textContent: t('collider.reset'), on: { click: () => { Object.assign(r.collider, defaultCollider(s, r.movement), { slice: r.collider.slice }); save(true); } } })),
    row(t('collider.source'), select(r.collider.slice ?? '', sources, v => { r.collider.slice = v || null; }, true)),
    el('div', { className: 'sub', textContent: t('settings.shadow') }),
    row(t('shadow.on'), check(r.shadow.on, v => { r.shadow.on = v; redraw(); })),
    row(t('shadow.size'), num(r.shadow.w, v => { r.shadow.w = Math.max(1, v); redraw(); }, { min: 1, max: 1024 }), num(r.shadow.h, v => { r.shadow.h = Math.max(1, v); redraw(); }, { min: 1, max: 1024 })),
    row(t('shadow.dy'), num(r.shadow.dy, v => { r.shadow.dy = v; redraw(); }, { min: -1024, max: 1024 }), unit('px')),
    row(t('shadow.opacity'), num(Math.round(r.shadow.opacity * 100), v => { r.shadow.opacity = Math.max(0, Math.min(1, v / 100)); redraw(); }, { max: 100, step: 5 }), unit('%')),
  );
}

/** The frame the collider is shown over: the first frame of the standing animation */
function colliderFrame() {
  const r = rig!, s = sprite!;
  const res = resolveCell(r, s, 'idle', dirsOf(r.directions).includes('s') ? 's' : dirsOf(r.directions)[0]);
  return res?.tag.from ?? 0;
}

function drawCollider() {
  const c = colCanvas, r = rig, s = sprite;
  if (!c || !r || !s) return;
  const g = c.getContext('2d')!;
  const k = devicePixelRatio * colZoom;
  g.setTransform(k, 0, 0, k, 0, 0);
  // Checkerboard so transparent parts show
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    g.fillStyle = ((x >> 2) + (y >> 2)) & 1 ? '#4a4458' : '#3a3546';
    g.fillRect(x, y, 1, 1);
  }
  const f = colliderFrame();
  // The shadow as the preview draws it, under the feet (bottom center of the collider)
  const box = colliderAt(r, s, f);
  if (r.shadow.on) {
    g.fillStyle = `rgba(0,0,0,${r.shadow.opacity})`;
    g.beginPath();
    g.ellipse(box.x + box.w / 2, box.y + box.h + r.shadow.dy, r.shadow.w / 2, r.shadow.h / 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.imageSmoothingEnabled = false;
  if (frames[f]) g.drawImage(frames[f], 0, 0);
  const lw = 1 / colZoom;
  g.fillStyle = 'rgba(255, 77, 109, .18)';
  g.fillRect(box.x, box.y, box.w, box.h);
  g.strokeStyle = '#ff4d6d';
  g.lineWidth = lw * 2;
  g.strokeRect(box.x + lw, box.y + lw, box.w - lw * 2, box.h - lw * 2);
  if (!r.collider.slice) for (const [hx, hy] of handles(box)) {
    g.fillStyle = '#fff';
    g.fillRect(hx - 2.5 * lw, hy - 2.5 * lw, 5 * lw, 5 * lw);
    g.strokeStyle = '#ff4d6d';
    g.lineWidth = lw;
    g.strokeRect(hx - 2.5 * lw, hy - 2.5 * lw, 5 * lw, 5 * lw);
  }
}

const handles = (b: Box): [number, number, string][] => [
  [b.x, b.y, 'nw'], [b.x + b.w / 2, b.y, 'n'], [b.x + b.w, b.y, 'ne'], [b.x + b.w, b.y + b.h / 2, 'e'],
  [b.x + b.w, b.y + b.h, 'se'], [b.x + b.w / 2, b.y + b.h, 's'], [b.x, b.y + b.h, 'sw'], [b.x, b.y + b.h / 2, 'w'],
];
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

/** Dragging inside the box moves it, its handles resize it, outside draws a new one; whole pixels, inside the frame */
function attachColliderDrag(c: HTMLCanvasElement, r: Rig, s: SpriteSnapshot) {
  const at = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return { x: (e.clientX - b.left) / colZoom, y: (e.clientY - b.top) / colZoom }; };
  const hitOf = (p: { x: number; y: number; }) => {
    const b = r.collider, tol = 6 / colZoom;
    const h = handles(b).find(([hx, hy]) => Math.abs(hx - p.x) <= tol && Math.abs(hy - p.y) <= tol);
    if (h) return h[2];
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h ? 'move' : null;
  };
  c.addEventListener('pointermove', e => { if (!e.buttons) c.style.cursor = CURSORS[hitOf(at(e)) ?? ''] ?? 'crosshair'; });
  c.addEventListener('pointerdown', e => {
    const p0 = at(e);
    let mode = hitOf(p0);
    const b0 = { ...r.collider };
    if (!mode) { mode = 'se'; Object.assign(b0, { x: Math.floor(p0.x), y: Math.floor(p0.y), w: 1, h: 1 }); }
    c.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = at(ev), dx = Math.round(p.x - p0.x), dy = Math.round(p.y - p0.y);
      let { x, y, w, h } = b0;
      if (mode === 'move') { x = Math.max(0, Math.min(s.width - w, x + dx)); y = Math.max(0, Math.min(s.height - h, y + dy)); }
      else {
        if (mode!.includes('w')) { const nx = Math.max(0, Math.min(x + w - 1, x + dx)); w += x - nx; x = nx; }
        if (mode!.includes('e')) w = Math.max(1, Math.min(s.width - x, w + dx));
        if (mode!.includes('n')) { const ny = Math.max(0, Math.min(y + h - 1, y + dy)); h += y - ny; y = ny; }
        if (mode!.includes('s')) h = Math.max(1, Math.min(s.height - y, h + dy));
      }
      Object.assign(r.collider, { x, y, w, h });
      drawCollider();
      save();
    };
    const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    move(e);
  });
}

/** Collider around the opaque pixels of all frames (feet only for top-down: the lower third) */
async function fitCollider() {
  if (!sprite || !rig) return;
  const s = sprite;
  let x0 = s.width, y0 = s.height, x1 = -1, y1 = -1;
  const c = new OffscreenCanvas(s.width, s.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  for (const img of frames) {
    g.clearRect(0, 0, s.width, s.height);
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, s.width, s.height).data;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (d[(y * s.width + x) * 4 + 3] > 16) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return ctx.ui.notify(t('collider.empty'), 'warning');
  let box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (rig.movement !== 'platformer') { const h = Math.max(1, Math.round(box.h / 3)); box = { ...box, y: box.y + box.h - h, h }; }
  Object.assign(rig.collider, box);
  save(true);
}

function physicsSection(r: Rig) {
  const units: Partial<Record<keyof Physics, string>> = { accel: 'px/s²', decel: 'px/s²', gravity: 'px/s²', jump: 'px/s', maxFall: 'px/s', coyote: 'ms', arrive: 'px', airControl: '%' };
  return section('physics', t('settings.physics'), false,
    note(t('settings.physicsHint')),
    ...physicsOf(r.movement).map(k => {
      const label = t(`physics.${k}`);
      if (k === 'jumpCut') return row(label, check(r.physics.jumpCut, v => { r.physics.jumpCut = v; }));
      if (k === 'airControl') return row(label, num(Math.round(r.physics.airControl * 100), v => { r.physics.airControl = Math.max(0, Math.min(1, v / 100)); }, { max: 100, step: 5 }), unit('%'));
      return row(label, num(r.physics[k] as number, v => { (r.physics[k] as number) = Math.max(0, v); }, { max: 100000, step: k === 'arrive' ? 1 : 10 }), unit(units[k] ?? ''));
    }));
}

function viewSection(r: Rig) {
  return section('view', t('settings.view'), false,
    row(t('background.kind'), select(r.background.kind, (['checker', 'lines', 'plain'] as const).map(v => ({ value: v, label: t(`background.${v}`) })), v => { r.background.kind = v; })),
    row(t('background.cell'), num(r.background.cell, v => { r.background.cell = Math.max(2, Math.round(v)); }, { min: 2, max: 512 }), unit('px')),
    row(t('background.colors'), color(r.background.a, v => { r.background.a = v; }), color(r.background.b, v => { r.background.b = v; })),
    row(t('settings.obstacles'), check(r.obstacles, v => { r.obstacles = v; })),
    el('div', { className: 'sub', textContent: t('settings.camera') }),
    row(t('camera.mode'), segmented(r.camera.mode, (['follow', 'fixed'] as const).map(v => ({ value: v, label: t(`camera.${v}`) })), v => { r.camera.mode = v; })),
    row(t('camera.zoom'), num(r.camera.zoom, v => { r.camera.zoom = Math.max(0, Math.round(v)); }, { max: 32 }), unit(t('camera.zoomAuto'))),
    row(t('camera.smooth'), num(Math.round(r.camera.smooth * 100), v => { r.camera.smooth = Math.max(0, Math.min(0.98, v / 100)); }, { max: 98, step: 5 }), unit('%')),
    row(t('camera.dead'), num(r.camera.deadW, v => { r.camera.deadW = Math.max(0, v); }, { max: 4096 }), num(r.camera.deadH, v => { r.camera.deadH = Math.max(0, v); }, { max: 4096 })),
  );
}

function tagsSection(r: Rig, s: SpriteSnapshot) {
  return section('tags', t('settings.tags'), false,
    el('div', { className: 'buttons' },
      el('button', { textContent: t('settings.autofill'), title: t('settings.autofillHint'), on: { click: () => { Object.assign(r, autofill(r, s.tags, true)); save(true); } } }),
      el('button', { textContent: t('settings.createTags'), title: t('settings.createTagsHint'), on: { click: () => void createTags() } })),
    row(t('settings.lock'), check(r.lock, v => { r.lock = v; })),
  );
}

/** Adds a tag of new frames for every empty crossing, and maps it */
async function createTags() {
  if (!sprite || !rig) return;
  const s = sprite, r = rig;
  const want: { st: State; d: Dir; name: string; row: string; }[] = [];
  for (const st of r.states) for (const alt of st.alt.on ? [false, true] : [false]) for (const d of dirsOf(r.directions)) {
    const row = alt ? altRow(st.id) : st.id;
    if (r.cells[row]?.[d]?.tag) continue;
    const base = isBuiltin(st.id) ? st.id : (st.name ?? st.id).toLowerCase().replace(/\s+/g, '_');
    const name = [base, d === 'any' ? '' : d, alt ? st.alt.name.toLowerCase().replace(/\s+/g, '_') : ''].filter(Boolean).join('_');
    if (!s.tags.some(x => x.name === name)) want.push({ st, d, name, row });
  }
  if (!want.length) return ctx.ui.notify(t('settings.nothingToCreate'), 'info');
  if (!await ctx.ui.confirm(t('settings.createConfirm', { count: want.length, list: want.map(w => w.name).join(', ') }))) return;
  const COLORS = ['#3fa7d6', '#59cd90', '#fac05e', '#f79d84', '#9f84bd', '#ee6352', '#5c9ead', '#c9b7ad'];
  if ((await ctx.locks.get())?.owner === ctx.id) await ctx.locks.clear();
  await ctx.sprite.transaction(t('history.createTags'), async tx => {
    let at = s.frames.length;
    for (const w of want) {
      const n = w.st.loop && w.st.id !== 'idle' ? 4 : 1;
      for (let k = 0; k < n; k++) await tx.frames.add(at + k, { duration: s.frames[0]?.duration ?? 100 });
      await tx.tags.add({ name: w.name, from: at, to: at + n - 1, color: COLORS[r.states.indexOf(w.st) % COLORS.length], direction: 'forward' });
      r.cells[w.row] = { ...r.cells[w.row], [w.d]: { tag: w.name, flip: false } };
      at += n;
    }
  });
  save();
}

function render() {
  const r = rig, s = sprite;
  root.replaceChildren();
  play.textContent = t('settings.play');
  compass = colCanvas = null;
  if (!r || !s) { root.append(note(t('noSprite'))); play.disabled = true; return; }
  play.disabled = false;
  root.append(
    characterSection(r, s),
    compassSection(r, s) ?? '',
    physicsSection(r),
    colliderSection(r, s),
    viewSection(r),
    tagsSection(r, s),
  );
}

const shape = (s: SpriteSnapshot | null) => s ? JSON.stringify([s.id, s.width, s.height, s.tags.map(x => [x.name, x.from, x.to]), s.slices.map(x => x.name), ctx.i18n.lang]) : '';

async function reload() {
  const s = await ctx.sprite.get().catch(() => null);
  const docChanged = s?.id !== sprite?.id;
  // Frames for the compass and the collider editor
  const next: ImageBitmap[] = [];
  if (s) for (let f = 0; f < s.frames.length; f++) next.push(await ctx.sprite.render(f));
  frames.forEach(i => i.close());
  frames = next;
  sprite = s;
  if (!s) { rig = null; built = ''; render(); return; }
  let replaced = false;
  if (docChanged || !rig || !dirty) {
    const stored = loadRig(await ctx.meta.get<Rig>(SPRITE, 'rig'), s);
    // The inputs edit the rig object they were built with: a new object needs a new form
    if (!rig || JSON.stringify(stored) !== JSON.stringify(rig)) { rig = stored; replaced = true; }
  }
  const nextShape = shape(s) + rig!.collider.slice;
  if (nextShape !== built || replaced) { built = nextShape; render(); }
  else drawCollider();
}

function loop(now: number) {
  drawCompass(now);
  requestAnimationFrame(loop);
}

let later: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(later); later = setTimeout(() => void reload().catch(console.error), 150); };
ctx.events.on('sprite:change', schedule);
ctx.documents.on('change', () => { rig = null; schedule(); });
ctx.i18n.on('change', () => { built = ''; schedule(); });
play.addEventListener('click', async () => { clearTimeout(timer); if (rig) await ctx.meta.set(SPRITE, 'rig', rig); await ctx.ui.panels.show('preview'); });

await reload();
requestAnimationFrame(loop);
