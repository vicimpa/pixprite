import { t } from "~/core/i18n";
import { Color } from "~/core/Color";
import { held, onModifiers } from "~/core/Hotkeys";
import type { Mask } from "~/core/Mask";
import { state } from "~/core/State";
import {
  active, beginSession, beginTransform, brushOffsets, currentPlacement, EFFECT_TOOLS, handlePoints, hitHandle, hitSlice, PAINT_TOOLS, sliceCursor,
  outlinePreview, previewDab, referenceCorners, trackPen, SELECT_TOOLS, selectGridCell, type Handle, type ToolPointer,
} from "~/core/Tools";
import { sliceKey } from "~/core/Sprite";
import { referenceImage, setGuides } from "~/core/Reference";
import { placementCorners } from "~/core/Transform";
import { dialogs } from "~/modules/Dialogs";
import { Canvas } from "~/ui/Canvas";
import { openContextMenu } from "~/ui/Menu";
import { item } from "~/modules/MainMenu";
import { drawExtensionHighlights, drawExtensionOverlay } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, type FC, type PointerEvent, type WheelEvent } from "react";

type Pan = { x: number; y: number; cx: number; cy: number; };
type Mods = Pick<ToolPointer, 'alt' | 'shift' | 'ctrl' | 'secondary'>;

const CURSORS: Partial<Record<string, string>> = {
  hand: 'grab',
  move: 'move',
  zoom: 'zoom-in',
  picker: 'copy',
  text: 'text',
};

const BRUSH_TOOLS = ['pencil', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'blur', 'jumble', 'spray'];
const HANDLE = 6;
/** Ruler thickness in view pixels */
const RULER = 16;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Box = { x: number; y: number; w: number; h: number; };

/** Rulers along the top and left edges in sprite pixels, with guide marks and the cursor position */
function drawRulers(ctx: CanvasRenderingContext2D, width: number, height: number, ox: number, oy: number, zoom: number, flip: boolean, cursor: { sx: number; sy: number; } | null) {
  const R = RULER;
  const toX = (v: number) => flip ? width - (ox + v * zoom) : ox + v * zoom;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(s => s * zoom >= 48) ?? 5000;
  const minor = step / ([1, 2].includes(step) ? step : 5);
  const bg = cssVar('--ruler') || '#17141d', fg = cssVar('--ruler-fg') || '#8f87a0';
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, R);
  ctx.fillRect(0, 0, R, height);
  ctx.font = '9px sans-serif';
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  // Top ruler: sprite x
  const xa = Math.floor(-ox / zoom / minor) * minor - minor, xb = Math.ceil((width - ox) / zoom / minor) * minor;
  ctx.textBaseline = 'top';
  for (let v = xa; v <= xb; v += minor) {
    const x = Math.round(toX(v)) + 0.5;
    if (x < R || x > width) continue;
    const major = Math.abs(v % step) < 1e-6;
    ctx.moveTo(x, major ? 0 : R - 4); ctx.lineTo(x, R);
    if (major) ctx.fillText(String(v), x + 2, 1);
  }
  // Left ruler: sprite y, numbers written sideways
  const ya = Math.floor(-oy / zoom / minor) * minor - minor, yb = Math.ceil((height - oy) / zoom / minor) * minor;
  for (let v = ya; v <= yb; v += minor) {
    const y = Math.round(oy + v * zoom) + 0.5;
    if (y < R || y > height) continue;
    const major = Math.abs(v % step) < 1e-6;
    ctx.moveTo(major ? 0 : R - 4, y); ctx.lineTo(R, y);
    if (major) {
      ctx.save();
      ctx.translate(1, y + 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(String(v), 0, -R + 2);
      ctx.restore();
    }
  }
  ctx.moveTo(0, R - 0.5); ctx.lineTo(width, R - 0.5);
  ctx.moveTo(R - 0.5, 0); ctx.lineTo(R - 0.5, height);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const accent = cssVar('--accent') || '#4d7cff';
  ctx.fillStyle = accent;
  for (const g of state.guides) {
    if (g.axis === 'x') { const x = toX(g.pos); if (x >= R) ctx.fillRect(Math.round(x) - 2, R - 6, 5, 6); }
    else { const y = oy + g.pos * zoom; if (y >= R) ctx.fillRect(R - 6, Math.round(y) - 2, 6, 5); }
  }
  if (cursor) {
    ctx.fillStyle = fg;
    const cx = flip ? width - cursor.sx : cursor.sx;
    if (cx >= R) ctx.fillRect(Math.round(cx), 0, 1, R);
    if (cursor.sy >= R) ctx.fillRect(0, Math.round(cursor.sy), R, 1);
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, R, R);
  ctx.restore();
}

/** Labelled distance lines from `a` to `b` along both axes (gaps, or edge offsets when they overlap) */
/** Thick line with a dark halo, readable over any pixels */
function boldStroke(ctx: CanvasRenderingContext2D, color: string, path: () => void) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, .65)';
  ctx.beginPath(); path(); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath(); path(); ctx.stroke();
  ctx.restore();
}

function drawGuides(ctx: CanvasRenderingContext2D, a: Box, b: Box, ox: number, oy: number, zoom: number, color: string) {
  const X = (v: number) => Math.round(ox + v * zoom) + 0.5, Y = (v: number) => Math.round(oy + v * zoom) + 0.5;
  const label = (text: string, x: number, y: number) => {
    ctx.font = `bold ${cssVar('--font-size') || '12px'} sans-serif`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(0, 0, 0, .65)';
    ctx.fillRect(Math.round(x - w / 2) - 1, Math.round(y - 9) - 1, w + 2, 20);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - 9), w, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };
  ctx.strokeStyle = color;
  // Pairs of edges to measure on one axis
  const spans = (a0: number, a1: number, b0: number, b1: number): [number, number][] => {
    if (a1 <= b0) return [[a1, b0]];
    if (b1 <= a0) return [[b1, a0]];
    return [[a0, b0], [a1, b1]].filter(([p, q]) => p !== q) as [number, number][];
  };
  const midY = a.y + a.h / 2, midX = a.x + a.w / 2;
  for (const [p, q] of spans(a.x, a.x + a.w, b.x, b.x + b.w)) {
    boldStroke(ctx, color, () => { ctx.moveTo(X(p), Y(midY)); ctx.lineTo(X(q), Y(midY)); });
    label(`${Math.abs(q - p)} px`, (X(p) + X(q)) / 2, Y(midY) - 12);
  }
  for (const [p, q] of spans(a.y, a.y + a.h, b.y, b.y + b.h)) {
    boldStroke(ctx, color, () => { ctx.moveTo(X(midX), Y(p)); ctx.lineTo(X(midX), Y(q)); });
    label(`${Math.abs(q - p)} px`, X(midX) + 24, (Y(p) + Y(q)) / 2);
  }
}

function drawAnts(ctx: CanvasRenderingContext2D, mask: Mask, ox: number, oy: number, zoom: number, time: number) {
  const e = mask.edges;
  ctx.beginPath();
  for (let i = 0; i < e.length; i += 4) {
    ctx.moveTo(Math.round(ox + e[i] * zoom) + 0.5, Math.round(oy + e[i + 1] * zoom) + 0.5);
    ctx.lineTo(Math.round(ox + e[i + 2] * zoom) + 0.5, Math.round(oy + e[i + 3] * zoom) + 0.5);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -Math.floor(time / 90) % 8;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.setLineDash([]);
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M4 10a6 6 0 1 1 6 6" fill="none" stroke="black" stroke-width="3"/><path d="M4 10a6 6 0 1 1 6 6" fill="none" stroke="white" stroke-width="1.5"/><path d="M1 8h6l-3 4z" fill="white" stroke="black"/></svg>')}") 10 10, crosshair`;

/** Resize cursor for a handle direction, rotated with the box */
function handleCursor(h: Handle, angle: number) {
  if (h === 'move') return 'move';
  if (h === 'pivot') return 'grab';
  if (h.startsWith('rotate')) return ROTATE_CURSOR;
  if (h.startsWith('skew')) return Math.abs(((angle % 180) + 180) % 180 - 90) < 45 ? 'ns-resize' : 'ew-resize';
  const dirs = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const i = dirs.indexOf(h.slice(6));
  const k = (i + Math.round(angle / 45) + 8) % 8;
  return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][k % 4];
}

/** Ghost frames for onion skin: steps from the current frame, wrapping inside the tag when asked */
function onionFrames() {
  const { sprite, prefs } = state;
  const out: { frame: number; k: number; past: boolean; }[] = [];
  const range = prefs.onionInTag ? sprite.playRange() : { from: 0, to: sprite.frames.length - 1 };
  const len = range.to - range.from + 1;
  const step = (k: number) => {
    const f = sprite.frame + k;
    if (!prefs.onionInTag) return f >= 0 && f < sprite.frames.length ? f : -1;
    return range.from + (((f - range.from) % len) + len) % len;
  };
  for (let k = 1; k <= prefs.onionBefore; k++) out.push({ frame: step(-k), k, past: true });
  for (let k = 1; k <= prefs.onionAfter; k++) out.push({ frame: step(k), k, past: false });
  return out.filter(o => o.frame >= 0 && o.frame !== sprite.frame);
}

/** Frame tinted red (past) or blue (future) by luminance, cached per sprite version */
const tintCache = new Map<string, OffscreenCanvas>();
function tinted(frame: number, past: boolean) {
  const { sprite } = state;
  const key = `${sprite.version}:${frame}:${past}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  if (tintCache.size > 32) tintCache.clear();
  const src = sprite.render(frame);
  const out = new OffscreenCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 2;
    d[i] = past ? 128 + l : l;
    d[i + 1] = l;
    d[i + 2] = past ? l : 128 + l;
  }
  ctx.putImageData(img, 0, 0);
  tintCache.set(key, out);
  return out;
}

export const View: FC = () => {
  useSignals();
  const pan = useRef<Pan | null>(null);
  const pressed = useRef<number | null>(null);
  const fittedSprite = useRef<typeof state.sprite | null>(null);
  const fitted = useRef('');
  const lastFrame = useRef(0);
  /** Last mouse position in viewport pixels, to recompute the hovered sprite pixel when the camera moves */
  const lastPointer = useRef<{ sx: number; sy: number; mods: Mods; } | null>(null);
  const hover = useRef<Handle | 'symX' | 'symY' | null>(null);
  const preview = useRef<{ key: string; data: Uint32Array | null; }>({ key: '', data: null });
  /** Touch points in view pixels; two of them pan and pinch-zoom */
  const touches = useRef(new Map<number, { x: number; y: number; }>());
  const gesture = useRef<{ d0: number; z0: number; px: number; py: number; } | null>(null);
  /** A single finger waits a moment before drawing, in case a second one follows */
  const pendingTouch = useRef<{ ev: PointerEvent<HTMLDivElement>; x: number; y: number; timer: number; } | null>(null);
  /** Fingers left over from a gesture don't draw */
  const ignoreTouch = useRef(false);
  const { prefs } = state;

  // Ctrl+wheel would zoom the whole page; React's wheel listener is passive, so block it natively
  useEffect(() => {
    const block = (e: globalThis.WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    addEventListener('wheel', block, { passive: false });
    return () => removeEventListener('wheel', block);
  }, []);

  // Modifier changes re-shape the current drag without waiting for a mouse move
  useEffect(() => onModifiers(() => {
    const s = active.session, lp = lastPointer.current;
    if (!s || !lp) return;
    const p = toPointer(lp.sx, lp.sy, { ...lp.mods, alt: held.alt, shift: held.shift, ctrl: held.ctrl });
    if (pressed.current !== null) s.move(p);
    else s.hover?.(p);
  }), []);

  // Cancel any half-done shape when the tool changes
  useEffect(() => () => { active.session?.cancel?.(); active.session = null; }, [state.tool]);

  const toPointer = (sx: number, sy: number, mods: Mods): ToolPointer => {
    const fx = (sx - state.offsetX) / state.zoom, fy = (sy - state.offsetY) / state.zoom;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy, sx, sy, space: held.space, ...mods };
  };

  const pointer = (e: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; currentTarget: Element; pointerType?: string; pressure?: number; buttons?: number; }, secondary = false) => {
    trackPen(e);
    const rect = e.currentTarget.getBoundingClientRect();
    // A flipped view mirrors the screen: everything below works in the mirrored space
    const sx = state.flipView ? state.viewW - (e.clientX - rect.left) : e.clientX - rect.left, sy = e.clientY - rect.top;
    const mods: Mods = { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, secondary };
    lastPointer.current = { sx, sy, mods };
    return { sx, sy, p: toPointer(sx, sy, mods) };
  };

  const toScreen = (x: number, y: number): [number, number] =>
    [state.offsetX + x * state.zoom, state.offsetY + y * state.zoom];

  /** Selection tools (and the move tool on floating pixels) show transform handles */
  const handlesVisible = () => {
    const t = state.activeTool;
    return !active.session && (SELECT_TOOLS.includes(t) && t !== 'wand' || t === 'move' && !!state.sprite.floating) && !!currentPlacement();
  };

  /** Is the (mirrored-space) point over the ruler that holds `axis` guides' marks */
  const inRuler = (sx: number, sy: number, axis: 'x' | 'y') => {
    if (!state.showRulers) return false;
    const rx = state.flipView ? state.viewW - sx : sx;
    return axis === 'x' ? sy < RULER && rx >= RULER : rx < RULER && sy >= RULER;
  };

  /** A guide mark on a ruler, or a new guide when pressing a ruler elsewhere */
  const rulerHit = (sx: number, sy: number): { axis: 'x' | 'y'; index?: number; } | null => {
    for (const axis of ['x', 'y'] as const) {
      if (!inRuler(sx, sy, axis)) continue;
      const index = state.guides.findIndex(g => g.axis === axis &&
        Math.abs((axis === 'x' ? state.offsetX : state.offsetY) + (g.pos) * state.zoom - (axis === 'x' ? sx : sy)) < 5);
      return { axis, index: index < 0 ? undefined : index };
    }
    // With the move tool a guide line on the canvas can be grabbed too
    if (state.activeTool === 'move') {
      const index = state.guides.findIndex(g =>
        Math.abs((g.axis === 'x' ? state.offsetX : state.offsetY) + g.pos * state.zoom - (g.axis === 'x' ? sx : sy)) < 4);
      if (index >= 0) return { axis: state.guides[index].axis, index };
    }
    return null;
  };

  const symHit = (sx: number, sy: number) => {
    if (!state.symmetryX && !state.symmetryY) return null;
    const { sprite, zoom, offsetX: ox, offsetY: oy } = state;
    if (state.symmetryX) {
      const x = ox + state.symAxisX * zoom;
      if (Math.abs(sx - x) < 8 && (Math.abs(sy - (oy - 8)) < 9 || Math.abs(sy - (oy + sprite.height * zoom + 8)) < 9)) return 'symX';
    }
    if (state.symmetryY) {
      const y = oy + state.symAxisY * zoom;
      if (Math.abs(sy - y) < 8 && (Math.abs(sx - (ox - 8)) < 9 || Math.abs(sx - (ox + sprite.width * zoom + 8)) < 9)) return 'symY';
    }
    return null;
  };

  const touchPoint = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startGesture = () => {
    const [a, b] = [...touches.current.values()];
    const mx = state.flipView ? state.viewW - (a.x + b.x) / 2 : (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    gesture.current = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: state.zoom,
      px: state.camX + (mx - state.viewW / 2) / state.zoom, py: state.camY + (my - state.viewH / 2) / state.zoom,
    };
  };

  const moveGesture = () => {
    const g = gesture.current;
    const [a, b] = [...touches.current.values()];
    if (!g || !a || !b) return;
    const mx = state.flipView ? state.viewW - (a.x + b.x) / 2 : (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z = Math.max(0.25, Math.min(128, g.z0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
    state.zoom = state.zoomTarget = z;
    // The sprite point under the fingers' midpoint stays under it
    state.panTo(g.px - (mx - state.viewW / 2) / z, g.py - (my - state.viewH / 2) / z);
  };

  const flushTouch = () => {
    const t = pendingTouch.current;
    if (!t) return;
    clearTimeout(t.timer);
    pendingTouch.current = null;
    press(t.ev);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return press(e);
    const pt = touchPoint(e);
    touches.current.set(e.pointerId, pt);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (touches.current.size === 1) {
      if (ignoreTouch.current) return;
      // React reuses nothing, but currentTarget is gone once the handler returns
      const el = e.currentTarget;
      const ev = {
        clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        button: 0, buttons: 1, pointerId: e.pointerId, pointerType: 'touch', currentTarget: el,
      } as unknown as PointerEvent<HTMLDivElement>;
      pendingTouch.current = { ev, ...pt, timer: window.setTimeout(flushTouch, 90) };
      return;
    }
    // A second finger: drop the stroke that just began and start pan / pinch
    if (pendingTouch.current) { clearTimeout(pendingTouch.current.timer); pendingTouch.current = null; }
    if (pressed.current !== null) {
      active.session?.cancel?.();
      active.session = null;
      pressed.current = null;
      pan.current = null;
    }
    lastPointer.current = null;
    ignoreTouch.current = true;
    if (touches.current.size === 2) startGesture();
  };

  /** Handles touch moves; true when the event is used up */
  const touchMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return false;
    const pt = touchPoint(e);
    touches.current.set(e.pointerId, pt);
    if (gesture.current) { moveGesture(); return true; }
    const t = pendingTouch.current;
    if (t) {
      if (Math.hypot(pt.x - t.x, pt.y - t.y) < 4) return true;
      flushTouch();
    }
    return ignoreTouch.current;
  };

  /** Handles touch ends; true when the event is used up */
  const touchUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return false;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) gesture.current = null;
    if (pendingTouch.current) flushTouch(); // a tap
    if (ignoreTouch.current) {
      if (!touches.current.size) ignoreTouch.current = false;
      return true;
    }
    return false;
  };

  const press = (e: PointerEvent<HTMLDivElement>) => {
    const { sx, sy, p } = pointer(e, e.button === 2);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a deferred tap whose finger is already up */ }

    // The other button during a stroke cancels it
    if (pressed.current !== null && active.session) {
      active.session.cancel?.();
      active.session = null;
      pressed.current = null;
      return;
    }
    pressed.current = e.button;

    const scrollButton = e.button === 2 && state.prefs.rightClick === 'scroll' && !SELECT_TOOLS.includes(state.activeTool);
    if (e.button === 1 || state.activeTool === 'hand' || scrollButton) {
      pan.current = { x: sx, y: sy, cx: state.camX, cy: state.camY };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    // While playing: right click stops, left drag pans
    if (state.playing) {
      if (e.button === 2) { state.playing = false; pressed.current = null; return; }
      pan.current = { x: sx, y: sy, cx: state.camX, cy: state.camY };
      return;
    }

    const g = e.button === 0 ? rulerHit(sx, sy) : null;
    if (g && g.index !== undefined && state.sprite.guidesLocked) {
      state.showTip(t('canvas.guidesAreLocked'));
      pressed.current = null;
      return;
    }
    if (g) {
      // Dragging out of a ruler makes a guide, dragging its mark moves it, dropping it on the ruler removes it
      const before = state.guides;
      const index = g.index ?? before.length;
      const guide = g.index === undefined ? { axis: g.axis, pos: 0 } : before[g.index];
      active.session = {
        move(q) {
          const pos = Math.round(g.axis === 'x' ? q.fx : q.fy);
          const list = state.guides.slice();
          list[index] = { axis: guide.axis, pos };
          state.guides = list;
          active.session!.info = `${g.axis === 'x' ? 'X' : 'Y'}: ${pos}`;
        },
        up(q) {
          const removed = inRuler(q.sx, q.sy, guide.axis);
          const after = removed ? state.guides.filter((_, k) => k !== index) : state.guides;
          state.sprite.guides = before;
          const same = after.length === before.length && after.every((x, k) => x.axis === before[k].axis && x.pos === before[k].pos);
          if (!same) setGuides(after, removed ? 'Remove guide' : g.index === undefined ? 'Add guide' : 'Move guide');
          return true;
        },
        cancel() { state.guides = before; },
      };
      if (g.index === undefined) active.session.move(p);
      return;
    }

    const sym = symHit(sx, sy);
    if (sym) {
      active.session = {
        move(q) {
          if (sym === 'symX') state.symAxisX = Math.max(1, Math.min(state.sprite.width - 1, Math.round(q.fx * 2) / 2));
          else state.symAxisY = Math.max(1, Math.min(state.sprite.height - 1, Math.round(q.fy * 2) / 2));
          active.session!.info = sym === 'symX'
            ? `Mirror axis: ${state.symAxisX} | ${state.sprite.width - state.symAxisX}`
            : `Mirror axis: ${state.symAxisY} | ${state.sprite.height - state.symAxisY}`;
        },
        up: () => true,
        cancel() { },
      };
      return;
    }

    if (active.session?.down) return active.session.down(p);

    if (e.button === 0 && handlesVisible()) {
      const h = hitHandle(sx, sy, toScreen, HANDLE);
      if (h) { active.session = beginTransform(h, p); return; }
    }

    const tool = state.activeTool;
    active.session = beginSession(tool, { ...p, alt: tool === 'picker' ? false : p.alt });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (touchMove(e)) return;
    const { sx, sy, p } = pointer(e, (e.buttons & 2) !== 0);
    state.cursorX = p.x;
    state.cursorY = p.y;
    if (pan.current) {
      state.panTo(
        pan.current.cx - (sx - pan.current.x) / state.zoom,
        pan.current.cy - (sy - pan.current.y) / state.zoom,
      );
      return;
    }
    const s = active.session;
    if (s) {
      if (pressed.current !== null) s.move(p);
      else s.hover?.(p);
      return;
    }
    hover.current = symHit(sx, sy) ?? (handlesVisible() ? hitHandle(sx, sy, toScreen, HANDLE) : null);
    if (!hover.current && SELECT_TOOLS.includes(state.activeTool) && state.sprite.mask?.has(p.x, p.y) && !p.shift && !p.alt)
      hover.current = 'move';
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (touchUp(e)) return;
    if (pressed.current === null) return;
    pressed.current = null;
    if (pan.current) { pan.current = null; return; }
    const s = active.session;
    if (!s) return;
    const { p } = pointer(e, e.button === 2);
    if (s.up(p)) {
      if (active.session === s) active.session = null;
      if (state.snapLines.length) state.snapLines = [];
      state.hint = '';
      state.save();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { sx, sy, p } = pointer(e);
    const tool = state.activeTool;
    const gh = rulerHit(sx, sy);
    if (gh?.index !== undefined) { dialogs.guidePosition(gh.index); return; }
    if (tool === 'hand') state.fitSmooth();
    else if (tool === 'slice') {
      const h = hitSlice(p.fx, p.fy);
      if (h) dialogs.sliceProperties(h.index);
    }
    else if (SELECT_TOOLS.includes(tool) && tool !== 'polyLasso' && tool !== 'wand' && !active.session) selectGridCell(p);
  };

  /** Ctrl/Cmd (or trackpad pinch) + wheel zooms one step per ~notch; plain wheel scrolls */
  const wheelAcc = useRef(0);
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const { sx, sy } = pointer(e);
    if (e.ctrlKey || e.metaKey) {
      // Line/page deltas come from some mice; normalize to pixels
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (Math.abs(dy) < 40) {
        // Trackpad pinch: continuous zoom, still eased by the camera animation
        state.zoomTo(state.zoomTarget * Math.exp(-dy / 120), sx, sy);
        return;
      }
      wheelAcc.current += dy;
      const notch = 100;
      while (Math.abs(wheelAcc.current) >= notch) {
        const dir = wheelAcc.current < 0 ? 1 : -1;
        state.zoomStep(dir, sx, sy);
        wheelAcc.current += dir * notch;
      }
      return;
    }
    wheelAcc.current = 0;
    if (e.altKey) {
      // Alt+wheel walks through the palette
      const pal = state.palette;
      const cur = pal.indexOf(state.colorA.toHexString(false));
      const next = Math.max(0, Math.min(pal.length - 1, (cur < 0 ? 0 : cur) + (e.deltaY > 0 ? 1 : -1)));
      if (pal[next]) state.colorA = Color.fromHex(pal[next]);
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    state.panBy(state.flipView ? -dx : dx, e.shiftKey ? 0 : e.deltaY);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const { sprite } = state;
    if (state.activeTool === 'slice') {
      e.preventDefault();
      const { p } = pointer(e);
      const h = hitSlice(p.fx, p.fy);
      if (h && !sprite.selectedSlices.includes(h.index)) sprite.selectedSlices = [h.index];
      if (!sprite.selectedSlices.length) return;
      const first = sprite.selectedSlices[0];
      openContextMenu([
        { label: t('canvas.sliceProperties'), run: () => dialogs.sliceProperties(first) },
        { label: t('common.duplicate'), run: () => { sprite.duplicateSlices(); state.save(); } },
        { label: sprite.slices[first]?.keys.some(k => k.frame === sprite.frame) && sprite.slices[first].keys.length > 1 ? 'Remove this frame\'s key' : 'Hide from this frame on', run: () => { sprite.toggleSliceHere(first); state.save(); } },
        { label: t('common.delete'), run: () => { sprite.removeSlices(); state.save(); } },
      ], e.clientX, e.clientY);
      return;
    }
    // Right button paints; the menu opens with Ctrl+right click
    if (!e.ctrlKey) return;
    openContextMenu([
      item('edit.cut'), item('edit.copy'), item('edit.paste'), item('edit.clear'), '-',
      item('select.all'), item('select.none'), item('select.invert'), '-',
      item('edit.flipH'), item('edit.flipV'), item('edit.rotateCw'), '-',
      item('edit.brushFromSelection'),
    ], e.clientX, e.clientY);
  };

  const loop = (can: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const now = performance.now(), time = now;
    const dt = Math.min(100, now - (lastFrame.current || now));
    lastFrame.current = now;
    // Drawing is in CSS pixels; the backing store is in device pixels
    const k = can.width / Math.max(1, parseFloat(can.style.width) || can.width);
    const width = can.width / k, height = can.height / k;
    // Viewport size first: the offsets below are derived from it (camera is centered)
    state.viewW = width;
    state.viewH = height;
    const { sprite } = state;

    // The same document changing size (new sprite in place, canvas resize) re-enables fitting;
    // switching documents keeps each one's own camera
    const fitKey = `${sprite.width}x${sprite.height}`;
    if (fittedSprite.current === sprite && fitted.current !== fitKey) state.autoFit = true;
    fitted.current = fitKey;
    fittedSprite.current = sprite;

    // Auto-scroll while dragging past the edge of the view
    const lp = lastPointer.current;
    if (pressed.current !== null && active.session && lp && !pan.current) {
      const m = 16;
      const ex = lp.sx < m ? lp.sx - m : lp.sx > width - m ? lp.sx - width + m : 0;
      const ey = lp.sy < m ? lp.sy - m : lp.sy > height - m ? lp.sy - height + m : 0;
      if (ex || ey) state.panBy(ex * dt / 60, ey * dt / 60);
    }

    state.tickCamera(dt);
    const { zoom, offsetX: ox, offsetY: oy } = state;
    const sw = sprite.width * zoom, sh = sprite.height * zoom;

    // The camera may have moved under a still mouse (zoom animation, scrolling):
    // re-derive the sprite pixel under the cursor and feed it to an active stroke
    const s = active.session;
    if (lp && !pan.current) {
      const p = toPointer(lp.sx, lp.sy, lp.mods);
      if (p.x !== state.cursorX || p.y !== state.cursorY) {
        state.cursorX = p.x;
        state.cursorY = p.y;
        if (s && pressed.current !== null) s.move(p);
        else s?.hover?.(p);
      }
    }
    if (s?.tick && pressed.current !== null) s.tick();
    if (s?.info !== undefined && state.hint !== s.info) state.hint = s.info;

    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = cssVar('--workspace') || '#444';
    ctx.fillRect(0, 0, width, height);
    // Flipped view: the whole picture is drawn mirrored, pointer input is mirrored to match
    ctx.setTransform(state.flipView ? -k : k, 0, 0, k, state.flipView ? width * k : 0, 0);

    // Brush preview: the current layer with one real dab at the cursor
    const tool = state.activeTool;
    const { cursorX: cx, cursorY: cy } = state;
    let override: { layer: number; data: Uint32Array; } | undefined;
    if (prefs.brushPreview === 'full' && !s && lp && !pan.current && !state.playing && sprite.inBounds(cx, cy) && !outlinePreview(tool)) {
      const key = `${sprite.version}:${tool}:${cx}:${cy}:${state.colorA.toHexString(true)}:${state.brushSize}:${state.brushShape}:${state.brushAngle}:${state.ink}:${state.opacity}:${state.symmetryX}:${state.symmetryY}:${state.symmetryD1}:${state.symmetryD2}`;
      if (preview.current.key !== key) preview.current = { key, data: previewDab(tool, cx, cy) };
      if (preview.current.data) override = { layer: sprite.layer, data: preview.current.data };
    }

    const fp = state.filterPreview;
    if (fp && fp.frame === sprite.frame) override = { layer: fp.layer, data: fp.data };
    // While a stroke paints one layer, the layers below and above it are composited once
    sprite.focusLayer = s && pressed.current !== null && PAINT_TOOLS.includes(tool) ? sprite.layer : null;
    const image = sprite.render(sprite.frame, undefined, override);
    const checker = Math.max(1, prefs.checkerSize) * (prefs.checkerFollowsZoom ? zoom : 1);

    // Tiled mode shows neighbours dimmed around the sprite
    const tx = state.tiledX ? [-1, 0, 1] : [0];
    const ty = state.tiledY ? [-1, 0, 1] : [0];
    for (const j of ty) for (const i of tx) {
      const x = ox + i * sw, y = oy + j * sh;
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(width, x + sw), y1 = Math.min(height, y + sh);
      if (x1 <= x0 || y1 <= y0) continue;
      // Checkerboard aligned to the sprite origin, only over the visible part
      ctx.fillStyle = prefs.checkerA;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = prefs.checkerB;
      const c0 = Math.floor((x0 - x) / checker), c1 = Math.ceil((x1 - x) / checker);
      const r0 = Math.floor((y0 - y) / checker), r1 = Math.ceil((y1 - y) / checker);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      if ((c1 - c0) * (r1 - r0) < 40000)
        for (let r = r0; r < r1; r++)
          for (let c = c0 + (((c0 + r) % 2) + 2) % 2; c < c1; c += 2)
            ctx.fillRect(x + c * checker, y + r * checker, checker, checker);
      ctx.restore();
      if (i || j) {
        ctx.drawImage(image, x, y, sw, sh);
        ctx.fillStyle = 'rgba(0, 0, 0, .25)';
        ctx.fillRect(x, y, sw, sh);
      }
    }

    // Reference layers: under the sprite when below every pixel layer, over it otherwise
    const firstPixel = sprite.layers.findIndex(l => !l.reference && !l.group);
    const drawRefs = (front: boolean) => sprite.layers.forEach((l, i) => {
      if (!l.reference || (i > firstPixel) !== front || !sprite.visibleDeep(i)) return;
      const img = referenceImage(l.reference.src);
      if (!img) return;
      const { x, y, scale, angle = 0 } = l.reference;
      const w = img.naturalWidth * scale * zoom, h = img.naturalHeight * scale * zoom;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.imageSmoothingEnabled = scale * zoom < 1 || angle % 90 !== 0;
      // Rotated about its center
      ctx.translate(ox + x * zoom + w / 2, oy + y * zoom + h / 2);
      ctx.rotate(angle * Math.PI / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    });
    drawRefs(false);

    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.fillRect(ox + 3, oy + sh, sw, 3);
    ctx.fillRect(ox + sw, oy + 3, 3, sh);

    const onion = state.onion && !state.playing ? onionFrames() : [];
    const drawOnion = () => {
      for (const o of onion.slice().sort((a, b) => b.k - a.k)) {
        const alpha = Math.max(0, prefs.onionOpacity - prefs.onionStep * (o.k - 1));
        if (!alpha) continue;
        ctx.globalAlpha = alpha;
        ctx.drawImage(prefs.onionMode === 'tint' ? tinted(o.frame, o.past) : sprite.render(o.frame), ox, oy, sw, sh);
      }
      ctx.globalAlpha = 1;
    };
    if (!prefs.onionFront) drawOnion();
    ctx.drawImage(image, ox, oy, sw, sh);
    if (prefs.onionFront) drawOnion();
    drawExtensionOverlay(ctx, ox, oy, zoom);
    drawExtensionHighlights(ctx, ox, oy, zoom);

    const x0 = Math.max(0, Math.floor(-ox / zoom)), x1 = Math.min(sprite.width, Math.ceil((width - ox) / zoom));
    const y0 = Math.max(0, Math.floor(-oy / zoom)), y1 = Math.min(sprite.height, Math.ceil((height - oy) / zoom));

    // Pixel grid fades in as you zoom
    // Starts above 2× and reaches full strength at 16×
    const pgAlpha = Math.min(1, Math.max(0, (zoom - 2) / 14));
    if (state.showPixelGrid && pgAlpha > 0.02) {
      ctx.beginPath();
      for (let x = Math.max(1, x0); x < x1; x++) {
        ctx.moveTo(Math.round(ox + x * zoom) + 0.5, Math.max(0, oy));
        ctx.lineTo(Math.round(ox + x * zoom) + 0.5, Math.min(height, oy + sh));
      }
      for (let y = Math.max(1, y0); y < y1; y++) {
        ctx.moveTo(Math.max(0, ox), Math.round(oy + y * zoom) + 0.5);
        ctx.lineTo(Math.min(width, ox + sw), Math.round(oy + y * zoom) + 0.5);
      }
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.18 * pgAlpha})`;
      ctx.stroke();
    }

    if (state.showGrid || sprite.tileset) {
      // On a tilemap layer the grid is the tile grid
      const ts = sprite.tileset;
      const { gridW, gridH, gridX, gridY } = ts ? { gridW: ts.tw, gridH: ts.th, gridX: 0, gridY: 0 } : prefs;
      // Fades out when cells get tiny on screen
      const cell = Math.min(gridW, gridH) * zoom;
      const alpha = prefs.gridAutoOpacity ? Math.min(1, (gridW + gridH) / 2 * zoom / 32) : 1;
      if (cell > 2 && 0.65 * alpha > 8 / 255) {
        ctx.beginPath();
        for (let x = ((gridX % gridW) + gridW) % gridW; x <= sprite.width; x += gridW) {
          ctx.moveTo(Math.round(ox + x * zoom) + 0.5, oy);
          ctx.lineTo(Math.round(ox + x * zoom) + 0.5, oy + sh);
        }
        for (let y = ((gridY % gridH) + gridH) % gridH; y <= sprite.height; y += gridH) {
          ctx.moveTo(ox, Math.round(oy + y * zoom) + 0.5);
          ctx.lineTo(ox + sw, Math.round(oy + y * zoom) + 0.5);
        }
        ctx.strokeStyle = prefs.gridColor;
        ctx.globalAlpha = 0.65 * alpha;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Symmetry axes with drag handles at both ends
    const accent = cssVar('--accent');
    if (state.symmetryOn) {
      ctx.beginPath();
      ctx.setLineDash([6, 3]);
      if (state.symmetryX) {
        const x = Math.round(ox + state.symAxisX * zoom) + 0.5;
        ctx.moveTo(x, oy - 4); ctx.lineTo(x, oy + sh + 4);
      }
      if (state.symmetryY) {
        const y = Math.round(oy + state.symAxisY * zoom) + 0.5;
        ctx.moveTo(ox - 4, y); ctx.lineTo(ox + sw + 4, y);
      }
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.setLineDash([]);
      // Diagonals through the axes' crossing point, clipped to the canvas
      if (state.symmetryD1 || state.symmetryD2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, sw, sh);
        ctx.clip();
        ctx.beginPath();
        ctx.setLineDash([6, 3]);
        const cx = ox + state.symAxisX * zoom, cy = oy + state.symAxisY * zoom, L = sw + sh;
        if (state.symmetryD1) { ctx.moveTo(cx - L, cy - L); ctx.lineTo(cx + L, cy + L); }
        if (state.symmetryD2) { ctx.moveTo(cx - L, cy + L); ctx.lineTo(cx + L, cy - L); }
        ctx.strokeStyle = accent;
        ctx.stroke();
        ctx.restore();
      }
      const tri = (x: number, y: number, dx: number, dy: number) => {
        // Triangle pointing along (dx, dy) toward the canvas
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 7 * dx - 5 * dy, y - 7 * dy - 5 * dx);
        ctx.lineTo(x - 7 * dx + 5 * dy, y - 7 * dy + 5 * dx);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.stroke();
      };
      if (state.symmetryX) {
        const x = ox + state.symAxisX * zoom;
        tri(x, oy - 2, 0, 1);
        tri(x, oy + sh + 2, 0, -1);
      }
      if (state.symmetryY) {
        const y = oy + state.symAxisY * zoom;
        tri(ox - 2, y, 1, 0);
        tri(ox + sw + 2, y, -1, 0);
      }
    }

    drawRefs(true);

    // Guides cross the whole view
    if (state.guides.length) {
      ctx.beginPath();
      for (const g of state.guides) {
        if (g.axis === 'x') { const x = Math.round(ox + g.pos * zoom) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        else { const y = Math.round(oy + g.pos * zoom) + 0.5; ctx.moveTo(0, y); ctx.lineTo(width, y); }
      }
      ctx.strokeStyle = cssVar('--guides') || 'rgba(64, 140, 255, .8)';
      ctx.stroke();
    }
    // Lines the current drag snapped to stand out
    if (s && state.snapLines.length) {
      ctx.beginPath();
      for (const g of state.snapLines) {
        if (g.axis === 'x') { const x = Math.round(ox + g.pos * zoom) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        else { const y = Math.round(oy + g.pos * zoom) + 0.5; ctx.moveTo(0, y); ctx.lineTo(width, y); }
      }
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssVar('--accent') || '#ff5ad1';
      ctx.stroke();
      ctx.restore();
    }
    // Move tool on a reference layer: its outline with scale corners
    const refBox = tool === 'move' && !s ? referenceCorners() : null;
    if (refBox) {
      const pts = refBox.map(([x, y]) => [ox + x * zoom, oy + y * zoom] as const);
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = cssVar('--accent') || '#fff';
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of pts) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
      }
    }

    ctx.strokeStyle = '#000';
    ctx.strokeRect(ox - 0.5, oy - 0.5, sw + 1, sh + 1);

    // Cel bounds: the only hint of pixels kept outside the canvas.
    // Hidden while painting or playing; Ctrl with the move tool shows them with distance guides.
    const painting = !!s && (PAINT_TOOLS.includes(tool) || EFFECT_TOOLS.includes(tool));
    const guides = tool === 'move' && held.ctrl && !sprite.floating && !sprite.mask && prefs.autoGuides;
    const cel = !painting && !state.playing && (state.showLayerEdges || guides) ? sprite.getCel() : null;
    const screenRect = (r: { x: number; y: number; w: number; h: number; }) =>
      [Math.round(ox + r.x * zoom) + 0.5, Math.round(oy + r.y * zoom) + 0.5, Math.round(r.w * zoom) - 1, Math.round(r.h * zoom) - 1] as const;
    if (cel) {
      const edge = cssVar('--layer-edges') || '#6cb6ff';
      // Plain hairline for the layer-edges view, bold while measuring with Ctrl
      if (guides) boldStroke(ctx, edge, () => ctx.rect(...screenRect(cel)));
      else { ctx.strokeStyle = edge; ctx.strokeRect(...screenRect(cel)); }
    }
    if (cel && guides) {
      // Compare against the cel under the cursor, or the canvas when there is none
      let target = null;
      for (let l = sprite.layers.length - 1; l >= 0; l--) {
        if (!sprite.layers[l].visible || l === sprite.layer) continue;
        if (sprite.celPixel(cx, cy, l) >>> 24) { target = sprite.getCel(l); break; }
      }
      const guideColor = cssVar('--guides') || '#6cb6ff';
      if (target) boldStroke(ctx, guideColor, () => ctx.rect(...screenRect(target)));
      drawGuides(ctx, cel, target ?? sprite.canvasRect, ox, oy, zoom, guideColor);
    }

    // Slices: outline in their color, 9-slice lines and pivot fainter, names on top
    if (state.showSlices && sprite.slices.length && !state.playing) {
      const sliceTool = tool === 'slice';
      ctx.save();
      ctx.font = `${Math.max(10, Math.round(parseFloat(cssVar('--font-size')) * 0.85 || 11))}px sans-serif`;
      ctx.textBaseline = 'bottom';
      sprite.slices.forEach((sl, i) => {
        const k = sliceKey(sl, sprite.frame);
        if (!k) return;
        const X = (v: number) => Math.round(ox + v * zoom) + 0.5, Y = (v: number) => Math.round(oy + v * zoom) + 0.5;
        const sel = sliceTool && sprite.selectedSlices.includes(i);
        ctx.globalAlpha = 1;
        // Dark halo keeps the outline readable over any pixels
        ctx.strokeStyle = 'rgba(0, 0, 0, .45)';
        ctx.lineWidth = sel ? 4 : 3;
        ctx.strokeRect(X(k.x), Y(k.y), X(k.x + k.w) - X(k.x), Y(k.y + k.h) - Y(k.y));
        ctx.strokeStyle = sl.color;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.setLineDash(sel ? [5, 3] : []);
        ctx.strokeRect(X(k.x), Y(k.y), X(k.x + k.w) - X(k.x), Y(k.y + k.h) - Y(k.y));
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        if (k.center) {
          const c = k.center;
          for (const vx of [c.x, c.x + c.w]) if (vx > 0 && vx < k.w) { ctx.moveTo(X(k.x + vx), Y(k.y)); ctx.lineTo(X(k.x + vx), Y(k.y + k.h)); }
          for (const vy of [c.y, c.y + c.h]) if (vy > 0 && vy < k.h) { ctx.moveTo(X(k.x), Y(k.y + vy)); ctx.lineTo(X(k.x + k.w), Y(k.y + vy)); }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (k.pivot) {
          ctx.beginPath();
          ctx.rect(X(k.x + k.pivot.x), Y(k.y + k.pivot.y), zoom, zoom);
          ctx.stroke();
        }
        ctx.globalAlpha = sliceTool ? 1 : 0.7;
        if (sliceTool || zoom >= 4) {
          const tw = ctx.measureText(sl.name).width + 6, th = parseInt(ctx.font) + 4;
          ctx.fillStyle = sl.color;
          ctx.fillRect(X(k.x) - 0.5, Y(k.y) - th - 1, tw, th);
          ctx.fillStyle = '#000';
          ctx.fillText(sl.name, X(k.x) + 2.5, Y(k.y) - 2);
        }
      });
      ctx.restore();
    }

    const mask = s?.previewMask ?? sprite.mask;
    if (mask && !s?.hideAnts) drawAnts(ctx, mask, ox, oy, zoom, time);

    if (s?.preview?.length) {
      ctx.beginPath();
      s.preview.forEach(([x, y], i) => {
        const px = ox + (x + 0.5) * zoom, py = oy + (y + 0.5) * zoom;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      if (s.previewClosed) ctx.closePath();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Transform box, handles and pivot
    const pl = currentPlacement();
    if (pl && (handlesVisible() || s?.hideAnts)) {
      const corners = placementCorners(pl).map(([x, y]) => toScreen(x, y));
      ctx.beginPath();
      corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.setLineDash([]);
      if (!s) {
        const { handles, pivot } = handlePoints(pl, toScreen, HANDLE);
        for (const h of handles) {
          const hx = Math.round(h.x - HANDLE / 2) + 0.5, hy = Math.round(h.y - HANDLE / 2) + 0.5;
          ctx.fillStyle = '#fff';
          ctx.fillRect(hx, hy, HANDLE, HANDLE);
          ctx.strokeStyle = '#000';
          ctx.strokeRect(hx, hy, HANDLE, HANDLE);
        }
        if (pl.angle || state.showPivot || sprite.floating) {
          ctx.beginPath();
          ctx.arc(pivot.x, pivot.y, 4, 0, Math.PI * 2);
          ctx.moveTo(pivot.x - 7, pivot.y); ctx.lineTo(pivot.x + 7, pivot.y);
          ctx.moveTo(pivot.x, pivot.y - 7); ctx.lineTo(pivot.x, pivot.y + 7);
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Brush outline: for effects / transparent color, or when the painted preview is off
    const paintsHere = !['hand', 'move', 'zoom', 'picker'].includes(tool) && !SELECT_TOOLS.includes(tool);
    if (prefs.brushPreview !== 'none' && lp && !pan.current && paintsHere && (outlinePreview(tool) || prefs.brushPreview === 'outline' || !override)) {
      const offsets = BRUSH_TOOLS.includes(tool) ? brushOffsets() : [[0, 0]];
      ctx.beginPath();
      for (const [dx, dy] of offsets) ctx.rect(ox + (cx + dx) * zoom, oy + (cy + dy) * zoom, zoom, zoom);
      ctx.strokeStyle = 'rgba(0, 0, 0, .8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Crosshair that stays visible on any background
    const cursorKind = hover.current;
    if (lp && !pan.current && !cursorKind && (paintsHere || SELECT_TOOLS.includes(tool))) {
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      const px = Math.round(lp.sx) + 0.5, py = Math.round(lp.sy) + 0.5;
      ctx.moveTo(px - 8, py); ctx.lineTo(px - 2, py);
      ctx.moveTo(px + 2, py); ctx.lineTo(px + 8, py);
      ctx.moveTo(px, py - 8); ctx.lineTo(px, py - 2);
      ctx.moveTo(px, py + 2); ctx.lineTo(px, py + 8);
      ctx.stroke();
      ctx.restore();
    }

    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (state.showRulers) drawRulers(ctx, width, height, ox, oy, zoom, state.flipView, lp && !pan.current ? lp : null);

    // Cursor kind follows what is under the mouse
    const el = can.parentElement;
    if (el) {
      el.style.cursor = pan.current ? 'grabbing'
        : cursorKind === 'symX' ? 'ew-resize' : cursorKind === 'symY' ? 'ns-resize'
          : cursorKind ? handleCursor(cursorKind, pl?.angle ?? 0)
            : tool === 'slice' ? sliceCursor(s || !lp ? null : (() => { const q = toPointer(lp.sx, lp.sy, lp.mods); return hitSlice(q.fx, q.fy); })())
            : CURSORS[tool] ?? (!sprite.editable && !SELECT_TOOLS.includes(tool) ? 'not-allowed' : 'none');
      if (lp && !s && (inRuler(lp.sx, lp.sy, 'x') || inRuler(lp.sx, lp.sy, 'y'))) el.style.cursor = inRuler(lp.sx, lp.sy, 'x') ? 'col-resize' : 'row-resize';
    }
  };

  return (
    <Canvas
      inset
      hidpi
      loop={loop}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (pressed.current !== null) return;
        lastPointer.current = null;
        hover.current = null;
        state.cursorX = state.cursorY = -100;
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel} />
  );
};
