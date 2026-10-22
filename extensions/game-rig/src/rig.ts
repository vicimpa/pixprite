import type { SliceInfo, SpriteSnapshot, TagInfo } from "@pixprite/api";

/**
 * The game rig of a sprite. A character faces one of 1, 2, 4 or 8 directions and is in one of
 * its states (stands, walks, runs, carries…); every state × direction crossing plays a tag.
 * States also say how fast the character moves in them and how switching into them behaves.
 * Movement says how the preview drives it; the collider, shadow, background and camera say how
 * it is shown. Stored in the sprite's meta (`rig`), shared by the worker, settings and preview.
 */

export type Movement = 'topdown' | 'platformer' | 'rts';
export const MOVEMENTS: Movement[] = ['topdown', 'platformer', 'rts'];

export type DirCount = 1 | 2 | 4 | 8;
export const DIR_COUNTS: DirCount[] = [1, 2, 4, 8];

/** Compass directions, clockwise from the right; `any` is the single direction of a 1-direction rig */
export type Dir = 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'n' | 'ne' | 'any';
export type Compass = Exclude<Dir, 'any'>;
export const ALL_DIRS: Compass[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

export function dirsOf(count: DirCount): Dir[] {
  switch (count) {
    case 1: return ['any'];
    case 2: return ['e', 'w'];
    case 4: return ['e', 's', 'w', 'n'];
    case 8: return ALL_DIRS;
  }
}

/** Angle of a direction in radians (screen y down), for drawing the compass */
export const dirAngle = (d: Compass) => ALL_DIRS.indexOf(d) * Math.PI / 4;

/** The mirrored direction (left ↔ right), or null when mirroring doesn't change it */
export function mirrorOf(d: Dir): Dir | null {
  const m: Partial<Record<Dir, Dir>> = { e: 'w', w: 'e', ne: 'nw', nw: 'ne', se: 'sw', sw: 'se' };
  return m[d] ?? null;
}

/** States the preview knows how to trigger; anything else is the user's own, switched by a key */
export const BUILTIN_STATES = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'attack', 'hurt', 'death'] as const;
export type BuiltinState = typeof BUILTIN_STATES[number];
export const isBuiltin = (id: string): id is BuiltinState => (BUILTIN_STATES as readonly string[]).includes(id);

/** States each movement can use (others are hidden from the add menu) */
export function statesFor(m: Movement): BuiltinState[] {
  switch (m) {
    case 'topdown': return ['idle', 'walk', 'run', 'attack', 'hurt', 'death'];
    case 'platformer': return ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'attack', 'hurt', 'death'];
    case 'rts': return ['idle', 'walk', 'attack', 'death'];
  }
}

/** States that move the character (their `move` speed is used) */
export const MOVING = new Set(['walk', 'run']);

export type State = {
  /** A built-in state id, or the user's own id */
  id: string;
  /** Name of the user's own state (built-in ones are named by the interface) */
  name?: string;
  /** Own states: key that switches it on (`KeyC`…) and whether it holds or toggles */
  key?: string;
  mode?: 'hold' | 'toggle';
  /** Speed in this state, sprite pixels per second (walk, run and own states) */
  move?: number;
  /** Repeat, or stop on the last frame */
  loop: boolean;
  /** Playback speed, 1 = the frame durations as drawn */
  speed: number;
  /** Frame of the tag the animation starts on */
  start: number;
  /** Frame the loop comes back to: a run can open on an idle-looking frame that is played only once */
  loopFrom: number;
  /** The animation runs faster or slower with the movement speed (walk, run and own states) */
  follow: boolean;
  /** Turning or switching side keeps the frame; off starts the animation over */
  keepOnTurn: boolean;
  /**
   * This state's alternative variant (runs with a bomb, stands armed…), switched by its own key.
   * Its tags are kept in `cells` under `<state>+alt`; where it has none the usual ones play.
   */
  alt: Alt;
  /** Switching in: start over, or carry on from the frame position of the previous animation */
  enter: 'restart' | 'continue';
  /** Played to its end before anything else can take over (attacks, landing) */
  finish: boolean;
};

export type Cell = {
  tag: string | null;
  /** Show mirrored: a left-facing cell played from the right-facing tag */
  flip: boolean;
};

/** Movement shared by every state */
export type Physics = {
  /** Speeding up and slowing down, pixels per second² */
  accel: number; decel: number;
  /** Platformer */
  airControl: number; gravity: number; jump: number; maxFall: number; coyote: number; jumpCut: boolean;
  /** RTS: stops this close to the target */
  arrive: number;
};

export function physicsOf(m: Movement): (keyof Physics)[] {
  switch (m) {
    case 'topdown': return ['accel', 'decel'];
    case 'platformer': return ['accel', 'decel', 'airControl', 'gravity', 'jump', 'maxFall', 'coyote', 'jumpCut'];
    case 'rts': return ['accel', 'decel', 'arrive'];
  }
}

export type Box = { x: number; y: number; w: number; h: number; };

export type Rig = {
  version: 3;
  movement: Movement;
  directions: DirCount;
  states: State[];
  /** state id → direction → tag */
  cells: Record<string, Partial<Record<Dir, Cell>>>;
  physics: Physics;
  /** Collision box inside the frame; `slice` takes it from a slice instead (per frame keys) */
  collider: Box & { slice: string | null; };
  shadow: { on: boolean; w: number; h: number; dy: number; opacity: number; };
  background: { kind: 'checker' | 'lines' | 'plain'; cell: number; a: string; b: string; };
  camera: { mode: 'follow' | 'fixed'; zoom: number; smooth: number; deadW: number; deadH: number; };
  obstacles: boolean;
  /** Tags the rig uses can't be renamed or deleted */
  lock: boolean;
};

export type Alt = { on: boolean; name: string; key: string; mode: 'hold' | 'toggle'; };
export const newAlt = (): Alt => ({ on: false, name: 'bomb', key: 'KeyB', mode: 'hold' });

/** Where the alternative variant's crossings of a state are kept */
export const altRow = (stateId: string) => `${stateId}+alt`;

export const DEFAULT_PHYSICS: Physics = {
  accel: 600, decel: 800, airControl: 0.6, gravity: 900, jump: 300, maxFall: 420, coyote: 90, jumpCut: true, arrive: 2,
};

/** States that play once by nature, and are seen through */
const ONCE = new Set(['jump', 'land', 'attack', 'hurt', 'death']);
const FINISH = new Set(['land', 'attack', 'hurt']);
const MOVE: Record<string, number> = { walk: 60, run: 110 };

export const newState = (id: string, extra: Partial<State> = {}): State => ({
  id, loop: !ONCE.has(id), speed: 1, start: 0, loopFrom: 0, follow: MOVING.has(id) || !isBuiltin(id), keepOnTurn: true,
  // Walking into running keeps the step; everything else starts over
  enter: id === 'run' || id === 'walk' ? 'continue' : 'restart',
  alt: newAlt(),
  finish: FINISH.has(id),
  move: MOVE[id] ?? (isBuiltin(id) ? undefined : 45),
  ...extra,
});

const DIR_WORDS: Record<string, Compass> = {
  down: 's', south: 's', s: 's', front: 's', up: 'n', north: 'n', n: 'n', back: 'n',
  left: 'w', west: 'w', w: 'w', right: 'e', east: 'e', e: 'e', side: 'e',
  sw: 'sw', se: 'se', nw: 'nw', ne: 'ne', downleft: 'sw', downright: 'se', upleft: 'nw', upright: 'ne',
};
const STATE_WORDS: Record<string, string> = {
  idle: 'idle', stand: 'idle', wait: 'idle', walk: 'walk', move: 'walk', run: 'run', sprint: 'run',
  jump: 'jump', fall: 'fall', land: 'land', attack: 'attack', hit: 'attack', shoot: 'attack',
  hurt: 'hurt', damage: 'hurt', death: 'death', die: 'death', dead: 'death',
};

const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9а-яё]+/).filter(Boolean);

/** `Walk-Left`, `walk_left`, `walkLeft`, `left walk` → { state: 'walk', dir: 'w', rest: [] } */
function parseName(name: string) {
  const ws = words(name);
  let state: string | null = null, dir: Compass | null = null;
  const rest: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const two = ws[i] + (ws[i + 1] ?? '');
    if (!dir && two.length > 2 && ['sw', 'se', 'nw', 'ne'].includes(DIR_WORDS[two] ?? '')) { dir = DIR_WORDS[two]; i++; continue; }
    if (!state && STATE_WORDS[ws[i]]) state = STATE_WORDS[ws[i]];
    else if (!dir && DIR_WORDS[ws[i]]) dir = DIR_WORDS[ws[i]];
    else rest.push(ws[i]);
  }
  return { state, dir, rest };
}

/**
 * The tag that best fits a state and direction by its name. A tag must name the state and the
 * direction (or no direction at all); among those the one with the fewest other words wins,
 * then the shorter name: `walk_left` beats `walk_left_sword`.
 */
export function matchTag(state: State, dir: Dir, tags: TagInfo[], alt: { words: string[]; want: boolean; } | null = null): string | null {
  const own = isBuiltin(state.id) ? null : words(state.name ?? state.id);
  let best: { name: string; score: number; } | null = null;
  for (const t of tags) {
    const p = parseName(t.name);
    // The alternative variant's tags name it (`IdleDownBomb`); the usual ones don't
    const hasAlt = !!alt?.words.length && alt.words.every(w => p.rest.includes(w));
    if (alt && hasAlt !== alt.want) continue;
    if (hasAlt) p.rest = p.rest.filter(w => !alt!.words.includes(w));
    let extra: number;
    if (own) {
      // Own states: every word of their name must be in the tag's leftover words
      if (!own.every(w => p.rest.includes(w))) continue;
      extra = p.rest.length - own.length + (p.state ? 1 : 0);
    } else {
      if (p.state !== state.id) continue;
      extra = p.rest.length;
    }
    const want = dir === 'any' ? null : dir;
    if (p.dir !== want && p.dir !== null) continue;
    // A tag without direction fits any, but naming the direction outweighs one extra word
    const score = extra * 100 + (p.dir === want ? 0 : 150) + t.name.length;
    if (!best || score < best.score) best = { name: t.name, score };
  }
  return best?.name ?? null;
}

/** Fills crossings from tag names; a left side without its own tag gets the right side's tag mirrored */
export function autofill(rig: Rig, tags: TagInfo[], overwrite = false): Rig {
  const cells: Rig['cells'] = { ...rig.cells };
  for (const st of rig.states) {
    // With an alternative variant, its tags name it (`RunDownBomb`) and the usual ones don't
    const altWords = st.alt?.on ? words(st.alt.name) : [];
    const variants: [string, { words: string[]; want: boolean; } | null][] = altWords.length
      ? [[st.id, { words: altWords, want: false }], [altRow(st.id), { words: altWords, want: true }]]
      : [[st.id, null]];
    for (const [key, alt] of variants) {
      const row: Partial<Record<Dir, Cell>> = { ...rig.cells[key] };
      for (const d of dirsOf(rig.directions)) {
        const cur = row[d];
        if (!overwrite && cur?.tag && tags.some(t => t.name === cur.tag)) continue;
        const tag = matchTag(st, d, tags, alt);
        const named = tag && parseName(tag).dir === d;
        const m = mirrorOf(d);
        if (!named && m && (d === 'w' || d === 'nw' || d === 'sw')) {
          const other = matchTag(st, m, tags, alt);
          if (other && parseName(other).dir === m) { row[d] = { tag: other, flip: true }; continue; }
        }
        row[d] = { tag, flip: false };
      }
      cells[key] = row;
    }
  }
  return { ...rig, cells };
}

export function defaultCollider(s: { width: number; height: number; }, movement: Movement): Rig['collider'] {
  const w = Math.max(1, Math.round(s.width * 0.5));
  const h = Math.max(1, Math.round(s.height * (movement === 'platformer' ? 0.75 : 0.3)));
  return { x: Math.round((s.width - w) / 2), y: s.height - h, w, h, slice: null };
}

export const DEFAULT_SETUP: Record<Movement, { directions: DirCount; states: string[]; }> = {
  topdown: { directions: 4, states: ['idle', 'walk', 'run'] },
  platformer: { directions: 2, states: ['idle', 'walk', 'run', 'jump', 'fall'] },
  rts: { directions: 4, states: ['idle', 'walk', 'attack', 'death'] },
};

export function defaultRig(s: SpriteSnapshot, movement: Movement = 'topdown'): Rig {
  const cell = Math.max(4, Math.min(64, Math.round(Math.max(s.width, s.height) / 2)));
  const setup = DEFAULT_SETUP[movement];
  return autofill({
    version: 3, movement, directions: setup.directions,
    states: setup.states.map(id => newState(id)), cells: {},
    physics: { ...DEFAULT_PHYSICS },
    collider: defaultCollider(s, movement),
    shadow: { on: movement !== 'platformer', w: Math.round(s.width * 0.5), h: Math.max(2, Math.round(s.width * 0.16)), dy: 0, opacity: 0.35 },
    background: { kind: 'checker', cell, a: '#3b3546', b: '#443d50' },
    camera: { mode: 'follow', zoom: 0, smooth: 0.85, deadW: Math.round(s.width * 1.5), deadH: Math.round(s.height) },
    obstacles: true, lock: false,
  }, s.tags);
}

/** A stored rig made whole; older versions start over with defaults for their movement */
export function loadRig(raw: unknown, s: SpriteSnapshot): Rig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Rig> & { scenario?: string; preset?: string; };
  if (r.version !== 3) {
    const old = r.scenario ?? r.preset ?? '';
    return defaultRig(s, old.startsWith('platformer') ? 'platformer' : old === 'rts' ? 'rts' : 'topdown');
  }
  const base = defaultRig(s, MOVEMENTS.includes(r.movement!) ? r.movement! : 'topdown');
  return {
    ...base, ...r,
    directions: DIR_COUNTS.includes(r.directions!) ? r.directions! : base.directions,
    // A variant once set for the whole rig becomes each state's own
    states: Array.isArray(r.states) && r.states.length
      ? r.states.map(st => ({ ...newState(st.id), ...st, alt: { ...newAlt(), ...(r as { alt?: Alt; }).alt, ...st.alt } }))
      : base.states,
    cells: r.cells ?? base.cells,
    physics: { ...base.physics, ...r.physics },
    collider: { ...base.collider, ...r.collider },
    shadow: { ...base.shadow, ...r.shadow },
    background: { ...base.background, ...r.background },
    camera: { ...base.camera, ...r.camera },
  };
}

export const sliceKey = (s: SliceInfo, frame: number) =>
  s.keys.filter(k => k.frame <= frame).sort((a, b) => b.frame - a.frame)[0] ?? null;

/** The collider for a frame, in frame pixels */
export function colliderAt(rig: Rig, s: SpriteSnapshot, frame: number): Box {
  const c = rig.collider;
  if (c.slice) {
    const sl = s.slices.find(x => x.name === c.slice);
    const k = sl && sliceKey(sl, frame);
    if (k) return { x: k.x, y: k.y, w: k.w, h: k.h };
  }
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

/** The rig's own direction nearest to a compass direction */
export function nearestDir(rig: Rig, d: Compass): Dir {
  const dirs = dirsOf(rig.directions);
  if (dirs[0] === 'any') return 'any';
  const i = ALL_DIRS.indexOf(d);
  let best: Dir = dirs[0], bestDist = 9;
  for (const x of dirs) {
    const j = ALL_DIRS.indexOf(x as Compass);
    // Ties go to the horizontal side, which reads better for side-facing sprites
    const dist = Math.min(Math.abs(i - j), 8 - Math.abs(i - j)) + (x === 'e' || x === 'w' ? -0.1 : 0);
    if (dist < bestDist) { bestDist = dist; best = x; }
  }
  return best;
}

/** States to try when one has no tag, most specific first */
function stateFallbacks(id: string): string[] {
  const chain: Record<string, string[]> = { run: ['walk'], fall: ['jump'], land: ['idle'] };
  return [id, ...(chain[id] ?? []), 'idle'];
}

/**
 * What plays for a state facing `dir`: the tag, whether mirrored, and the state whose settings apply.
 * `alt(state)` says whose alternative variant is on: it is tried first, the usual one stands in where it has no tag.
 */
export function resolveCell(rig: Rig, s: SpriteSnapshot, stateId: string, dir: Dir, alt: (stateId: string) => boolean = () => false) {
  const altOn = (sid: string) => !!rig.states.find(x => x.id === sid)?.alt.on && alt(sid);
  const rows = (sid: string) => altOn(sid) ? [altRow(sid), sid] : [sid];
  for (const sid of stateFallbacks(stateId)) for (const key of rows(sid)) {
    const st = rig.states.find(x => x.id === sid);
    if (!st) continue;
    const row = rig.cells[key] ?? {};
    const tries: [Dir, boolean][] = [[dir, false]];
    // An empty side is played from the other side mirrored
    const m = mirrorOf(dir);
    if (m) tries.push([m, true]);
    for (const d of dirsOf(rig.directions)) tries.push([d, false]);
    for (const [d, mirrored] of tries) {
      const cell = row[d];
      const tag = cell?.tag ? s.tags.find(t => t.name === cell.tag) : undefined;
      if (cell && tag) return { state: st, tag, flip: cell.flip !== mirrored, exact: d === dir && sid === stateId && (key === sid) !== altOn(sid) };
    }
  }
  return null;
}

/** Frames of a tag in playing order (its direction applied) */
export function tagFrames(tag: TagInfo) {
  const seq: number[] = [];
  for (let f = tag.from; f <= tag.to; f++) seq.push(f);
  if (tag.direction === 'reverse' || tag.direction === 'pingpong-reverse') seq.reverse();
  if (tag.direction.startsWith('pingpong') && seq.length > 2) seq.push(...seq.slice(1, -1).reverse());
  return seq;
}

/**
 * The frame shown `ms` into a state's animation: it plays once from `start` to the end, then
 * (when looping) repeats from `loopFrom`; without a loop it stays on the last frame.
 */
export function frameAt(s: SpriteSnapshot, tag: TagInfo, st: State, ms: number) {
  const seq = tagFrames(tag);
  const dur = (f: number) => s.frames[f]?.duration ?? 100;
  const intro = seq.slice(Math.min(st.start, seq.length - 1));
  const loop = seq.slice(Math.min(st.loopFrom, seq.length - 1));
  const pick = (list: number[], t: number) => { for (const f of list) { t -= dur(f); if (t < 0) return f; } return list[list.length - 1]; };
  const introTotal = intro.reduce((a, f) => a + dur(f), 0);
  if (ms < introTotal) return pick(intro, ms);
  if (!st.loop) return intro[intro.length - 1];
  const loopTotal = loop.reduce((a, f) => a + dur(f), 0) || 1;
  return pick(loop, (ms - introTotal) % loopTotal);
}

/** Tag names the rig points at */
export const usedTags = (rig: Rig) => {
  const dirs = dirsOf(rig.directions);
  const rows = rig.states.flatMap(st => st.alt.on ? [st.id, altRow(st.id)] : [st.id]);
  return [...new Set(rows.flatMap(row => dirs.map(d => rig.cells[row]?.[d]?.tag).filter((t): t is string => !!t)))];
};
