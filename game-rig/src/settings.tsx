/**
 * Settings of the game rig. The character's directions and states form a grid of crossings;
 * a state is edited on a compass: arrows around the live animation, a dot on each arrow filled
 * when that direction has a tag. The collider is a box dragged over the frame. Every change is
 * saved to the sprite (debounced); "Play" opens the preview window.
 */
import type { SpriteSnapshot } from '@pixprite/api';
import { Button, Check, Input, Select, type ExtensionPageProps } from '@pixprite/ui-react';
import { Children, createElement, useEffect, useMemo, useReducer, type ReactNode, type ReactElement } from 'react';
import { settingsCss } from './styles';
import {
  altRow, autofill, changeMovement, colliderAt, defaultCollider, dirAngle, dirsOf, DIR_COUNTS, frameAt, isBuiltin, loadRig, mirrorOf, MOVEMENTS, MOVING, newState,
  physicsOf, resolveCell, statesFor, usedTags, type Box, type Compass, type Dir, type DirCount, type Movement, type Physics, type Rig, type State,
} from "./rig";

export default function Settings({ ctx }: ExtensionPageProps) {
  const [, refresh] = useReducer(n => n + 1, 0);
  const controller = useMemo(() => settings(ctx, refresh), [ctx]);
  useEffect(() => controller.start(), [controller]);
  return <><style>{settingsCss}</style>{controller.view()}</>;
}

function settings(ctx: ExtensionPageProps['ctx'], render: () => void) {
  let active = false;
  let revision = 0, request = 0;
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Edits not written yet: the document is not read back over them */
  let dirty = false, savingRevision = -1;
  async function flush() {
    clearTimeout(timer);
    if (!rig || !active || !dirty || savingRevision === revision) return;
    const saved = savingRevision = revision;
    try {
      await ctx.meta.set(SPRITE, 'rig', rig);
      if (!active) return;
      await applyLock();
      if (saved === revision) dirty = false;
    } catch (e) { if (savingRevision === saved) savingRevision = -1; console.error(e); }
  }
  function save(immediate = false) {
    dirty = true; revision++;
    clearTimeout(timer);
    if (immediate) void flush();
    else timer = setTimeout(() => void flush(), 350);
    render();
  }

  /** The rig's tags can't be renamed or deleted while `lock` is on */
  async function applyLock() {
    if (!rig) return;
    const ours = (await ctx.locks.get())?.owner === ctx.id;
    if (rig.lock && usedTags(rig).length) await ctx.locks.set({ tags: { delete: true, rename: true } });
    else if (ours) await ctx.locks.clear();
  }

  function num(value: number, set: (v: number) => void, opts: { min?: number; max?: number; step?: number } = {}) {
    return <Input type="number" value={value} min={opts.min ?? 0} max={opts.max} step={opts.step ?? 1}
      onInput={e => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v)) { set(v); save(); } }} />;
  }
  const check = (value: boolean, set: (v: boolean) => void, _rebuild = false) =>
    <Check checked={value} onChange={e => { set(e.currentTarget.checked); save(true); }} />;
  function select<T extends string>(value: T, options: { value: T; label: string }[], set: (v: T) => void, _rebuild = false) {
    return <Select value={value} onChange={e => { set(e.target.value as T); save(true); }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>;
  }
  const color = (value: string, set: (v: string) => void) => <Input type="color" value={value} onInput={e => { set(e.currentTarget.value); save(); }} />;
  // Associate every visible field with its label, including rows with more than one control.
  const row = (label: string, ...kids: ReactNode[]) => <div className="row" key={label}>
    <span>{label}</span>{Children.toArray(kids).map((kid, i) => typeof kid === 'object' && kid && 'type' in kid
      && [Input, Check, Select].includes((kid as ReactElement).type as typeof Input)
        ? createElement((kid as ReactElement).type, { ...(kid as ReactElement<Record<string, unknown>>).props, 'aria-label': label, key: i }) : kid)}
  </div>;
  const unit = (text: string) => <span className="unit">{text}</span>;
  const note = (text: string) => <div className="note">{text}</div>;
  function segmented<T extends string | number>(value: T, options: { value: T; label: string; title?: string }[], set: (v: T) => void) {
    return <div className="seg">{options.map(o => <Button key={o.value} type="button" title={o.title}
      $active={o.value === value} aria-pressed={o.value === value} onClick={() => { set(o.value); save(true); }}>{o.label}</Button>)}</div>;
  }
  const openState = new Map<string, boolean>();
  function section(id: string, title: string, open: boolean, ...kids: ReactNode[]) {
    return <details key={id} open={openState.get(id) ?? open} onToggle={e => openState.set(id, e.currentTarget.open)}>
      <summary>{title}</summary><div className="body">{Children.toArray(kids)}</div>
    </details>;
  }

  const stateName = (st: State) => isBuiltin(st.id) ? t(`state.${st.id}`) : st.name || st.id;
  const dirName = (d: Dir) => t(`dir.${d}`);
  const keyName = (code?: string) => !code ? '—' : code.replace(/^Key/, '').replace(/^Digit/, '');

  /** A field that takes the next key pressed; while focused it is lit and asks for the key */
  function keyInput(get: () => string | undefined, set: (code: string) => void) {
    return <Input value={keyName(get())} readOnly title={t('settings.keyHint')} className="key"
      onFocus={e => { e.currentTarget.value = t('settings.pressKey'); }}
      onBlur={e => { e.currentTarget.value = keyName(get()); }}
      onKeyDown={e => {
        if (e.code === 'Tab') return;
        e.preventDefault();
        const code = e.code || (e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key);
        if (code && code !== 'Escape') { set(code); save(); }
        e.currentTarget.blur();
      }} />;
  }

  function characterSection(r: Rig, s: SpriteSnapshot) {
    const moves = MOVEMENTS.map(m => ({ value: m, label: t(`movement.${m}`) }));
    return section('character', t('settings.character'), true,
      row(t('settings.movement'), select(r.movement, moves, v => { Object.assign(r, changeMovement(r, s, v as Movement)); }, true)),
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
    const add = <Select value="" className="add" aria-label={t('settings.addState')}
      onChange={async e => {
        const v = e.target.value;
        if (!v) return;
        let st: State;
        if (v === '*') {
          const name = (await ctx.ui.prompt(t('settings.ownStateName'), ''))?.trim();
          if (!name || !active) return;
          const id = `own_${name.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '_')}`;
          if (r.states.some(x => x.id === id)) return;
          st = newState(id, { name, mode: 'toggle' });
        } else st = newState(v);
        r.states.push(st); selState = st.id;
        Object.assign(r, autofill(r, s.tags)); save(true);
      }}>
        <option value="">+ {t('settings.addState')}</option>
        {missing.map(id => <option key={id} value={id}>{t(`state.${id}`)}</option>)}
        <option value="*">{t('settings.ownState')}</option>
      </Select>;
    return <div className="chips">{r.states.map(st => {
      const dirs = dirsOf(r.directions), done = dirs.filter(d => r.cells[st.id]?.[d]?.tag).length;
      return <div className="chip" key={st.id}>
        <Button type="button" $active={st.id === selState} aria-pressed={st.id === selState}
          title={`${done} / ${dirs.length}`} onClick={() => { selState = st.id; render(); }}>
          {stateName(st)} <span className={`count${done === dirs.length ? ' full' : done ? '' : ' none'}`}>{done}/{dirs.length}</span>
          {st.alt.on && <span className="alt" title={st.alt.name}>+{keyName(st.alt.key)}</span>}
        </Button>
        {st.id !== 'idle' && <Button type="button" className="x" title={t('settings.removeState')} aria-label={`${t('settings.removeState')}: ${stateName(st)}`}
          onClick={() => { r.states = r.states.filter(x => x !== st); delete r.cells[st.id]; delete r.cells[altRow(st.id)]; if (selState === st.id) selState = 'idle'; save(true); }}>×</Button>}
      </div>;
    })}{add}</div>;
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

    const compassView = <canvas className="compass" width={COMPASS * devicePixelRatio} height={COMPASS * devicePixelRatio}
      ref={node => { compass = node; }} style={{ width: COMPASS, height: COMPASS }}
      onClick={e => {
        const b = e.currentTarget.getBoundingClientRect(), x = (e.clientX - b.left) * COMPASS / b.width, y = (e.clientY - b.top) * COMPASS / b.height;
        let best: Dir | null = null, dist = 26;
        for (const d of dirs) { const p = dotAt(d, COMPASS), k = Math.hypot(p.x - x, p.y - y); if (k < dist) { dist = k; best = d; } }
        if (best) { selDir = best; compassStart = performance.now(); render(); }
      }} />;

    const tags = [{ value: '', label: t('settings.noTag') }, ...s.tags.map(x => ({ value: x.name, label: x.name }))];
    const m = mirrorOf(selDir);
    return section('state', `${t('settings.state')}: ${stateName(st)}`, true,
      st.alt.on && segmented<string>(selAlt ? 'alt' : 'usual', [{ value: 'usual', label: t('settings.usual') }, { value: 'alt', label: st.alt.name }], v => { selAlt = v === 'alt'; compassStart = performance.now(); }),
      <div className="compassWrap">{compassView}</div>,
      row(t('settings.tagFor', { dir: dirName(selDir) }), select(cell.tag ?? '', tags, v => { setCell({ tag: v || null }); compassStart = performance.now(); }, true)),
      m && row(t('settings.flip'), check(cell.flip, v => setCell({ flip: v }), true), unit(t('settings.flipHint'))),
      note(t('settings.compassHint')),
      <div className="sub">{t('settings.alt')}</div>,
      row(t('settings.altOn'), check(st.alt.on, v => { st.alt.on = v; if (v) Object.assign(r, autofill(r, s.tags)); else selAlt = false; }, true)),
      st.alt.on && row(t('settings.altName'), <Input value={st.alt.name} title={t('settings.altNameHint')} onInput={e => { st.alt.name = e.currentTarget.value; save(); }} onBlur={() => { Object.assign(r, autofill(r, s.tags)); save(true); }} />),
      st.alt.on && row(t('settings.key'),
        keyInput(() => st.alt.key, code => { st.alt.key = code; }),
        select(st.alt.mode, [{ value: 'hold', label: t('mode.hold') }, { value: 'toggle', label: t('mode.toggle') }], v => { st.alt.mode = v; })),
      st.alt.on && note(t('settings.altHint')),
      <div className="sub">{t('settings.playback')}</div>,
      row(t('settings.loop'), check(st.loop, v => { st.loop = v; }, true)),
      row(t('settings.speed'), num(Math.round(st.speed * 100), v => { st.speed = Math.max(0.05, v / 100); }, { min: 5, max: 400, step: 5 }), unit('%')),
      row(t('settings.start'), num(st.start, v => { st.start = Math.max(0, Math.round(v)); compassStart = performance.now(); }, { max: 999 })),
      st.loop && row(t('settings.loopFrom'), num(st.loopFrom, v => { st.loopFrom = Math.max(0, Math.round(v)); }, { max: 999 }), unit(t('settings.loopFromHint'))),
      <div className="sub">{t('settings.switching')}</div>,
      row(t('settings.enter'), select(st.enter, [{ value: 'restart', label: t('enter.restart') }, { value: 'continue', label: t('enter.continue') }], v => { st.enter = v; })),
      row(t('settings.finish'), check(st.finish, v => { st.finish = v; })),
      row(t('settings.keepOnTurn'), check(st.keepOnTurn, v => { st.keepOnTurn = v; })),
      (MOVING.has(st.id) || !isBuiltin(st.id)) && row(t('settings.move'), num(st.move ?? 0, v => { st.move = Math.max(0, v); }, { max: 10000, step: 5 }), unit('px/s')),
      (MOVING.has(st.id) || !isBuiltin(st.id)) && row(t('settings.follow'), check(st.follow, v => { st.follow = v; })),
      !isBuiltin(st.id) && row(t('settings.ownName'), <Input value={st.name ?? ''} onInput={e => { st.name = e.currentTarget.value; save(); }} />),
      !isBuiltin(st.id) && row(t('settings.key'),
        keyInput(() => st.key, code => { st.key = code; }),
        select(st.mode ?? 'toggle', [{ value: 'toggle', label: t('mode.toggle') }, { value: 'hold', label: t('mode.hold') }], v => { st.mode = v; })),
    );
  }

  /** Keeps a canvas backing store at the current pixel ratio, which changes with the page zoom */
  function fitBacking(c: HTMLCanvasElement, w: number, h: number) {
    const W = Math.round(w * devicePixelRatio), H = Math.round(h * devicePixelRatio);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  }

  /** Draws the compass: the selected crossing's animation in the middle, dots for every direction */
  function drawCompass(now: number) {
    const c = compass, r = rig, s = sprite;
    if (!c || !c.isConnected || !r || !s) return;
    const g = c.getContext('2d')!;
    fitBacking(c, COMPASS, COMPASS);
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
  // Page zoom changes the pixel ratio and fires resize: the still collider picture is redrawn sharp


  function colliderSection(r: Rig, s: SpriteSnapshot) {
    const sources = [{ value: '', label: t('collider.manual') }, ...s.slices.map(x => ({ value: x.name, label: t('collider.slice', { name: x.name }) }))];
    colZoom = Math.max(1, Math.floor(220 / Math.max(s.width, s.height)));
    const W = s.width * colZoom, H = s.height * colZoom;
    const colliderView = <canvas className="collider" style={{ width: W, height: H }}
      ref={node => { colCanvas = node; if (node) drawCollider(); }}
      onPointerMove={e => {
        if (!e.buttons && !r.collider.slice) e.currentTarget.style.cursor = CURSORS[colliderHit(e.nativeEvent, e.currentTarget, r, s) ?? ''] ?? 'crosshair';
      }}
      onPointerDown={e => { if (!r.collider.slice) attachColliderDrag(e.nativeEvent, e.currentTarget, r, s); }} />;
    const redraw = () => drawCollider();
    return section('collider', t('settings.collider'), false,
      note(r.collider.slice ? t('collider.sliceNote') : t('collider.dragHint')),
      <div className="colliderWrap">{colliderView}</div>,
      <div className="buttons two">
        <Button type="button" title={t('collider.fitHint')} onClick={() => void fitCollider()}>{t('collider.fit')}</Button>
        <Button type="button" onClick={() => { Object.assign(r.collider, defaultCollider(s, r.movement), { slice: r.collider.slice }); save(true); }}>{t('collider.reset')}</Button></div>,
      row(t('collider.source'), select(r.collider.slice ?? '', sources, v => { r.collider.slice = v || null; }, true)),
      <div className="sub">{t('settings.shadow')}</div>,
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
    fitBacking(c, s.width * colZoom, s.height * colZoom);
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
  function colliderPoint(e: PointerEvent, c: HTMLCanvasElement, s: SpriteSnapshot) {
    const b = c.getBoundingClientRect();
    return { x: (e.clientX - b.left) * s.width / b.width, y: (e.clientY - b.top) * s.height / b.height };
  }
  function colliderHit(e: PointerEvent, c: HTMLCanvasElement, r: Rig, s: SpriteSnapshot) {
    const p = colliderPoint(e, c, s), b = r.collider, tol = 6 * s.width / c.getBoundingClientRect().width;
    const h = handles(b).find(([hx, hy]) => Math.abs(hx - p.x) <= tol && Math.abs(hy - p.y) <= tol);
    if (h) return h[2];
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h ? 'move' : null;
  }
  let dragCleanup: (() => void) | undefined;

  /** Dragging inside the box moves it, its handles resize it, outside draws a new one; whole pixels, inside the frame */
  function attachColliderDrag(e: PointerEvent, c: HTMLCanvasElement, r: Rig, s: SpriteSnapshot) {
    if (e.button !== 0) return;
    dragCleanup?.(); dragCleanup = undefined;
    const at = (event: PointerEvent) => colliderPoint(event, c, s);
    const p0 = at(e);
    let mode = colliderHit(e, c, r, s);
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
    const up = () => { if (dragCleanup === up) dragCleanup = undefined; void flush(); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('lostpointercapture', up); if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId); };
    dragCleanup = up;
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', up);
    move(e);
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
      <div className="sub">{t('settings.camera')}</div>,
      row(t('camera.mode'), segmented(r.camera.mode, (['follow', 'fixed'] as const).map(v => ({ value: v, label: t(`camera.${v}`) })), v => { r.camera.mode = v; })),
      row(t('camera.zoom'), num(r.camera.zoom, v => { r.camera.zoom = Math.max(0, Math.round(v)); }, { max: 32 }), unit(t('camera.zoomAuto'))),
      row(t('camera.smooth'), num(Math.round(r.camera.smooth * 100), v => { r.camera.smooth = Math.max(0, Math.min(0.98, v / 100)); }, { max: 98, step: 5 }), unit('%')),
      row(t('camera.dead'), num(r.camera.deadW, v => { r.camera.deadW = Math.max(0, v); }, { max: 4096 }), num(r.camera.deadH, v => { r.camera.deadH = Math.max(0, v); }, { max: 4096 })),
    );
  }

  function tagsSection(r: Rig, s: SpriteSnapshot) {
    return section('tags', t('settings.tags'), false,
      <div className="buttons">
        <Button type="button" title={t('settings.autofillHint')} onClick={() => { Object.assign(r, autofill(r, s.tags, true)); save(true); }}>{t('settings.autofill')}</Button>
        <Button type="button" title={t('settings.createTagsHint')} onClick={() => void createTags()}>{t('settings.createTags')}</Button></div>,
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

  function view() {
    const r = rig, s = sprite;
    return <>
      <div id="settings" onBlurCapture={() => void flush()}>{!r || !s ? note(t('noSprite')) : <>
        {characterSection(r, s)}{compassSection(r, s)}{physicsSection(r)}
        {colliderSection(r, s)}{viewSection(r)}{tagsSection(r, s)}
      </>}</div>
      <div className="sticky"><Button type="button" $primary disabled={!r || !s} onClick={async () => {
        clearTimeout(timer); if (rig) await ctx.meta.set(SPRITE, 'rig', rig); await ctx.ui.panels.show('preview');
      }}>{t('settings.play')}</Button></div>
    </>;
  }

  const shape = (s: SpriteSnapshot | null) => s ? JSON.stringify([s.id, s.width, s.height, s.tags.map(x => [x.name, x.from, x.to]), s.slices.map(x => x.name), ctx.i18n.lang]) : '';

  async function reload() {
    const id = ++request, ownRevision = revision;
    const s = await ctx.sprite.get().catch(() => null);
    const stored = s ? loadRig(await ctx.meta.get<Rig>(SPRITE, 'rig'), s) : null;
    const next: ImageBitmap[] = [];
    try {
      if (s) for (let f = 0; f < s.frames.length; f++) next.push(await ctx.sprite.render(f));
    } catch (error) { next.forEach(image => image.close()); throw error; }
    if (!active || id !== request || ownRevision !== revision) { next.forEach(i => i.close()); return; }
    const docChanged = s?.id !== sprite?.id;
    frames.forEach(i => i.close()); frames = next; sprite = s;
    if (!s || !stored) { rig = null; built = ''; render(); return; }
    let replaced = false;
    if (docChanged || !rig || !dirty) {
      if (!rig || JSON.stringify(stored) !== JSON.stringify(rig)) { rig = stored; replaced = true; }
    }
    const nextShape = shape(s) + rig!.collider.slice;
    if (nextShape !== built || replaced) { built = nextShape; render(); }
    else drawCollider();
  }

  let animation = 0;
  function loop(now: number) {
    if (!active) return;
    drawCompass(now);
    animation = requestAnimationFrame(loop);
  }
  let later: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { clearTimeout(later); later = setTimeout(() => void reload().catch(console.error), 150); };
  return { view, start() {
    active = true;
    const resize = () => drawCollider();
    addEventListener('resize', resize);
    const off = [ctx.events.on('sprite:change', schedule), ctx.documents.on('change', () => {
      revision++; clearTimeout(timer); dirty = false; rig = null; schedule();
    }), ctx.i18n.on('change', () => { built = ''; schedule(); })];
    void reload().catch(console.error);
    animation = requestAnimationFrame(loop);
    return () => {
      active = false; revision++; request++; clearTimeout(timer); clearTimeout(later);
      if (dirty && rig) void ctx.meta.set(SPRITE, 'rig', rig).catch(console.error);
      cancelAnimationFrame(animation); dragCleanup?.(); off.forEach(fn => fn());
      removeEventListener('resize', resize);
      frames.forEach(frame => frame.close()); frames = [];
    };
  } };
}
