/**
 * sprite.*, documents.*, meta.* and locks.*: the active document as plain data,
 * every change going through Sprite's own methods so undo and locks keep working.
 */
import type { CelInfo, DocumentInfo, LayerInfo, Locks, MetaTarget, PixelData, Rect, Selection, SliceInfo, SpriteSnapshot, TagInfo } from "@pixprite/api";
import { untracked } from "@preact/signals-react";
import { Mask } from "~/core/Mask";
import { lockedNotice, reframeCel, Sprite, type CelImage, type Layer } from "~/core/Sprite";
import { Color } from "~/core/Color";
import { setPaletteKeepingPixels, state } from "~/core/State";
import { fail, int, isObject, type Call, type Handlers } from "./common";

const docIds = new WeakMap<Sprite, string>();

/** Stable id of an open document for this session */
export function docId(doc: Sprite) {
  let id = docIds.get(doc);
  if (!id) docIds.set(doc, id = crypto.randomUUID());
  return id;
}

export const docInfo = (d: Sprite): DocumentInfo => ({
  id: docId(d), name: d.name, width: d.width, height: d.height, dirty: d.modified,
  project: d.projectId ?? `session:${d.sessionId ?? docId(d)}`,
});

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function activeDoc() {
  return state.home ? null : state.sprite;
}

/** The document a call works on: its transaction's, else the active one */
export function target(c: Call) {
  if (c.tx !== undefined) {
    const t = c.host.transactions.get(c.tx);
    if (!t) fail('invalid', `Transaction ${c.tx} is closed`);
    return t!.doc;
  }
  if (c.host.stroke) return c.host.stroke.doc;
  return activeDoc() ?? fail('no-document', 'No document is open');
}

/**
 * Runs a change. Outside a transaction or tool stroke it is its own undo step (`label`) and saved;
 * `own` changes call Sprite methods that make their step themselves.
 * A change the document's locks refuse rejects with `locked`.
 */
export function write<T>(c: Call, label: string, fn: (s: Sprite) => T, own = false): T {
  const s = target(c);
  const stroke = c.tx === undefined ? c.host.stroke : null;
  const grouped = c.tx !== undefined || !!stroke;
  const before = lockedNotice.peek()?.at;
  const out = untracked(() => {
    if (!grouped && !own) s.checkpoint(label);
    // A tool stroke makes its undo step on the first change, so strokes that change nothing leave none
    if (stroke && !stroke.started && !own) { s.checkpoint(stroke.label); stroke.started = true; }
    return fn(s);
  });
  const n = lockedNotice.peek();
  if (n && n.at !== before) fail('locked', n.reason);
  if (!grouped) state.save();
  return out;
}

const celIds = new WeakMap<CelImage, number>();
let nextCel = 1;
const celId = (cel: CelImage) => {
  let id = celIds.get(cel);
  if (!id) celIds.set(cel, id = nextCel++);
  return id;
};

function layerInfo(l: Layer): LayerInfo {
  return {
    name: l.name, visible: l.visible, locked: l.locked, background: l.background, continuous: l.continuous,
    opacity: l.opacity, blend: l.blend, group: l.group, depth: l.depth, collapsed: l.collapsed,
    tileset: l.tileset, clip: l.clip, reference: !!l.reference, userData: l.userData,
    cels: l.cels.map((cel, f): CelInfo | null => cel && {
      x: cel.x, y: cel.y, w: cel.w, h: cel.h, id: celId(cel), opacity: l.celOpacity[f] ?? 1, tilemap: !!cel.tiles,
    }),
  };
}

export function snapshot(s: Sprite): SpriteSnapshot {
  return {
    id: docId(s), name: s.name, width: s.width, height: s.height, colorMode: s.colorMode,
    // The app palette is the active document's (swatches in rgb, the colors themselves in indexed)
    palette: s === state.sprite ? state.palette.slice() : null,
    transparentIndex: s.transparentIndex,
    layers: s.layers.map(layerInfo),
    frames: s.frames.map(f => ({ duration: f.duration })),
    tags: s.tags.map(t => ({ name: t.name, from: t.from, to: t.to, color: t.color, direction: t.direction, repeat: t.repeat, userData: t.userData })),
    slices: s.slices.map(x => ({ name: x.name, color: x.color, keys: x.keys.map(k => ({ ...k })), userData: x.userData })),
    layer: s.layer, frame: s.frame, loop: s.loop,
  };
}

function checkRect(r: unknown, s: Sprite): Rect {
  if (r === undefined || r === null) return s.canvasRect;
  if (!isObject(r)) fail('invalid', 'rect must be {x, y, w, h}');
  const { x, y, w, h } = r as Rect;
  for (const v of [x, y, w, h]) int(v, 'rect');
  if (w <= 0 || h <= 0 || w * h > 1 << 26) fail('invalid', 'rect is empty or too large');
  return { x, y, w, h };
}

function checkCel(s: Sprite, layer: unknown, frame: unknown) {
  const l = int(layer, 'layer'), f = int(frame, 'frame');
  if (!s.layers[l]) fail('not-found', `No layer ${l}`);
  if (!s.frames[f]) fail('not-found', `No frame ${f}`);
  return [l, f] as const;
}

/** Packed ABGR words viewed as rgba bytes (little-endian), a copy */
const toBytes = (data: Uint32Array) => new Uint8ClampedArray(data.slice().buffer);

function getPixels(s: Sprite, layer: number, frame: number, rect: Rect, format: 'rgba' | 'index'): PixelData {
  const data = reframeCel(s.getCel(layer, frame), rect).data;
  if (format === 'rgba') return { rect, format, data: toBytes(data) };
  if (s.colorMode !== 'indexed' || !s.palette) fail('invalid', 'index format needs an indexed sprite');
  const out = new Uint8ClampedArray(data.length);
  const t = Math.max(0, s.transparentIndex);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] >>> 24) < 128 ? t : s.palette!.index(data[i]);
  return { rect, format, data: out };
}

function putPixels(s: Sprite, layer: number, frame: number, px: PixelData) {
  if (!isObject(px) || !(px.data instanceof Uint8ClampedArray || (px.data as unknown) instanceof Uint8Array)) fail('invalid', 'pixels must be PixelData');
  const rect = checkRect(px.rect, s);
  const words = new Uint32Array(rect.w * rect.h);
  if (px.format === 'index') {
    if (!s.palette || px.data.length !== words.length) fail('invalid', 'index data needs an indexed sprite and 1 byte per pixel');
    const colors = s.palette!.colors;
    for (let i = 0; i < words.length; i++) {
      const k = px.data[i];
      words[i] = k === s.transparentIndex || k >= colors.length ? 0 : colors[k] | 0xff000000;
    }
  } else {
    if (px.data.length !== words.length * 4) fail('invalid', 'rgba data must hold 4 bytes per pixel of rect');
    words.set(new Uint32Array(px.data.buffer.slice(px.data.byteOffset, px.data.byteOffset + px.data.byteLength)));
  }
  // Merge into the cel grown to cover both
  const cel = s.getCel(layer, frame);
  const x0 = Math.min(rect.x, cel?.x ?? rect.x), y0 = Math.min(rect.y, cel?.y ?? rect.y);
  const x1 = Math.max(rect.x + rect.w, cel ? cel.x + cel.w : -Infinity), y1 = Math.max(rect.y + rect.h, cel ? cel.y + cel.h : -Infinity);
  const out = reframeCel(cel, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  for (let y = 0; y < rect.h; y++)
    out.data.set(words.subarray(y * rect.w, (y + 1) * rect.w), (rect.y - y0 + y) * out.w + (rect.x - x0));
  s.setCel(out, layer, frame);
}

async function render(s: Sprite, frame: number, opts: { scale?: number; layers?: number[]; format?: 'bitmap' | 'png'; } = {}) {
  const scale = Math.max(1, Math.min(64, Math.floor(opts.scale ?? 1)));
  const w = s.width * scale, h = s.height * scale;
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (opts.layers?.length) for (const l of opts.layers) ctx.drawImage(s.render(frame, int(l, 'layer')), 0, 0, w, h);
  else ctx.drawImage(s.render(frame), 0, 0, w, h);
  return opts.format === 'png' ? out.convertToBlob({ type: 'image/png' }) : out.transferToImageBitmap();
}

function getSelection(s: Sprite): Selection {
  const m = s.mask;
  if (!m?.bounds) return { bounds: null, mask: null };
  const b = m.bounds;
  const mask = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) mask[y * b.w + x] = m.data[(b.y + y) * m.w + b.x + x] ? 255 : 0;
  return { bounds: { ...b }, mask };
}

function setSelection(s: Sprite, sel: unknown) {
  if (!sel) return s.deselect();
  const data = new Uint8Array(s.width * s.height);
  const isSel = isObject(sel) && 'bounds' in sel;
  const b = isSel ? (sel as Selection).bounds : sel as Rect;
  if (!b) return s.deselect();
  const r = checkRect(b, s);
  const m = isSel ? (sel as Selection).mask : null;
  if (m && m.length !== r.w * r.h) fail('invalid', 'mask must hold one byte per pixel of bounds');
  for (let y = Math.max(0, r.y); y < Math.min(s.height, r.y + r.h); y++)
    for (let x = Math.max(0, r.x); x < Math.min(s.width, r.x + r.w); x++)
      data[y * s.width + x] = !m || m[(y - r.y) * r.w + x - r.x] ? 1 : 0;
  s.setMask(new Mask(s.width, s.height, data), 'Select');
}

const has = <T>(list: T[], i: unknown, what: string) => {
  const k = int(i, what);
  if (!list[k]) fail('not-found', `No ${what} ${k}`);
  return k;
};

const pick = <T extends object>(o: unknown, keys: (keyof T)[]): Partial<T> =>
  isObject(o) ? Object.fromEntries(keys.filter(k => o[k as string] !== undefined).map(k => [k, o[k as string]])) as Partial<T> : {};

/** Moves an item of `list` from `from` to `to` step by step with the sprite's own move */
function stepMove(from: number, to: number, set: (i: number) => void, step: (dir: -1 | 1) => void) {
  let i = from;
  while (i !== to) {
    set(i);
    const dir = to > i ? 1 : -1;
    step(dir);
    i += dir;
  }
}

export const spriteHandlers: Handlers = {
  'sprite.get': c => snapshot(target(c)),
  'sprite.getPixels': (c, layer, frame, rect, format = 'rgba') => {
    const s = target(c);
    const [l, f] = checkCel(s, layer, frame);
    if (format !== 'rgba' && format !== 'index') fail('invalid', 'format is rgba or index');
    return getPixels(s, l, f, checkRect(rect, s), format);
  },
  'sprite.putPixels': (c, layer, frame, px) => write(c, 'Extension edit', s => {
    const [l, f] = checkCel(s, layer, frame);
    if (s.layers[l].group || s.layers[l].reference) fail('invalid', 'Layer has no pixels');
    putPixels(s, l, f, px);
  }),
  'sprite.render': (c, frame, opts) => {
    const s = target(c);
    return render(s, has(s.frames, frame, 'frame'), isObject(opts) ? opts : {});
  },

  'sprite.transaction.begin': (c, label) => {
    const doc = target(c);
    // Nested requests already carry the outer tx (the client joins them), so this is always a new step
    const tx = c.host.beginTransaction(doc);
    untracked(() => doc.checkpoint(String(label || 'Extension edit')));
    return tx;
  },
  'sprite.transaction.end': (c, tx, commit) => {
    const t = c.host.transactions.get(int(tx, 'tx'));
    if (!t) return;
    c.host.transactions.delete(tx);
    if (!commit) untracked(() => t.guard.cancel());
    else { untracked(() => t.guard.commit()); state.save(); }
  },

  'sprite.layers.add': (c, opts) => write(c, 'New layer', s => {
    const o = isObject(opts) ? opts : {};
    if (o.at !== undefined) s.layer = Math.max(0, Math.min(s.layers.length - 1, int(o.at, 'at') - 1));
    s.range = null;
    // A refusal by the locks is reported by write()
    if (o.group) s.addGroup();
    else s.addLayer();
    const patch = pick<Layer>(o, ['name', 'opacity', 'blend', 'visible']);
    if (Object.keys(patch).length) s.updateLayer(s.layer, patch, 'Layer properties');
    return s.layer;
  }, true),
  'sprite.layers.remove': (c, i) => write(c, 'Delete layer', s => {
    s.layer = has(s.layers, i, 'layer');
    s.range = null;
    if (s.layers.length < 2) fail('invalid', 'The last layer cannot be removed');
    s.removeLayers();
  }, true),
  'sprite.layers.update': (c, i, patch) => write(c, 'Layer properties', s => {
    s.updateLayer(has(s.layers, i, 'layer'), pick<Layer>(patch, ['name', 'visible', 'locked', 'opacity', 'blend', 'userData']));
  }, true),
  'sprite.layers.move': (c, from, to) => write(c, 'Move layer', s => {
    const a = has(s.layers, from, 'layer'), b = has(s.layers, to, 'layer');
    stepMove(a, b, i => { s.layer = i; s.range = null; }, d => s.moveLayer(d));
  }, true),

  'sprite.frames.add': (c, at, opts) => write(c, 'New frame', s => {
    const o = isObject(opts) ? opts : {};
    const pos = at === undefined ? s.frames.length : Math.max(0, Math.min(s.frames.length, int(at, 'at')));
    s.frame = Math.max(0, pos - 1);
    s.range = null;
    if (!s.addFrame(o.copy ? 'duplicate' : 'empty')) fail('locked', 'locks.frames.create');
    // addFrame inserts after the current frame; a frame at 0 is moved to the front
    if (pos === 0) { s.moveFrame(-1); }
    if (typeof o.duration === 'number') s.setDuration(o.duration);
    return s.frame;
  }, true),
  'sprite.frames.remove': (c, i) => write(c, 'Delete frame', s => {
    s.frame = has(s.frames, i, 'frame');
    s.range = null;
    if (!s.removeFrames()) fail('invalid', 'Frame cannot be removed');
  }, true),
  'sprite.frames.setDuration': (c, i, ms) => write(c, 'Frame duration', s => {
    s.frame = has(s.frames, i, 'frame');
    s.range = null;
    s.setDuration(Math.max(1, Math.round(Number(ms) || 100)));
  }, true),
  'sprite.frames.move': (c, from, to) => write(c, 'Move frame', s => {
    const a = has(s.frames, from, 'frame'), b = has(s.frames, to, 'frame');
    stepMove(a, b, i => { s.frame = i; s.range = null; }, d => s.moveFrame(d));
  }, true),

  'sprite.tags.add': (c, tag) => write(c, 'New tag', s => {
    const t = pick<TagInfo>(tag, ['name', 'from', 'to', 'color', 'direction', 'repeat', 'userData']);
    const from = has(s.frames, t.from, 'frame'), to = has(s.frames, t.to, 'frame');
    s.range = { type: 'frames', frames: [Math.min(from, to), Math.max(from, to)], layers: [0, s.layers.length - 1] };
    if (!s.addTag()) fail('locked', 'locks.tags.create');
    s.range = null;
    const i = s.tags.length - 1;
    s.updateTag(i, { ...t, from: Math.min(from, to), to: Math.max(from, to) }, false);
    return i;
  }, true),
  'sprite.tags.remove': (c, i) => write(c, 'Delete tag', s => s.removeTag(has(s.tags, i, 'tag')), true),
  'sprite.tags.update': (c, i, patch) => write(c, 'Tag properties', s =>
    s.updateTag(has(s.tags, i, 'tag'), pick<TagInfo>(patch, ['name', 'from', 'to', 'color', 'direction', 'repeat', 'userData'])), true),

  'sprite.slices.add': (c, slice) => write(c, 'New slice', s => {
    const x = pick<SliceInfo>(slice, ['name', 'color', 'keys', 'userData']);
    const key = x.keys?.[0];
    const r = key ? checkRect(key, s) : s.canvasRect;
    if (!s.addSlice(r, typeof x.color === 'string' ? x.color : undefined)) fail('locked', 'locks.slices.create');
    const i = s.slices.length - 1;
    const patch = pick<SliceInfo>(x, ['name', 'userData']);
    if (Object.keys(patch).length) s.updateSlice(i, patch, null);
    return i;
  }, true),
  'sprite.slices.remove': (c, i) => write(c, 'Delete slice', s => s.removeSlices([has(s.slices, i, 'slice')]), true),
  'sprite.slices.update': (c, i, patch) => write(c, 'Slice properties', s => {
    const k = has(s.slices, i, 'slice');
    const p = pick<SliceInfo>(patch, ['name', 'color', 'userData']);
    s.updateSlice(k, p);
    if (isObject(patch) && Array.isArray(patch.keys)) {
      for (const key of patch.keys) if (isObject(key)) s.updateSliceKey(k, { ...checkRect(key, s), frame: int(key.frame ?? 0, 'frame') }, null);
    }
  }, true),

  'sprite.palette.set': (c, colors, opts) => {
    const s = target(c);
    // The app palette belongs to the active document
    if (s !== state.sprite) fail('invalid', 'Only the active document\'s palette can be changed');
    if (!Array.isArray(colors) || !colors.length || colors.length > 256 || !colors.every(v => typeof v === 'string' && HEX.test(v)))
      fail('invalid', 'colors must be 1..256 css hex strings');
    // Palette entries are opaque `#rrggbb`
    const next = (colors as string[]).map(v => Color.fromHex(v).toHexString(false));
    const now = state.palette;
    if (next.join() === now.join()) return;
    const op = next.length > now.length ? 'create' : next.length < now.length ? 'delete' : 'move';
    if (s.isLocked('palette', op)) fail('locked', `locks.palette.${op}`);
    // The palette effect records the undo step and recolors indexed pixels
    if (isObject(opts) && opts.keepPixels) setPaletteKeepingPixels(next);
    else state.palette = next;
    if (c.tx === undefined) state.save();
  },

  'sprite.selection.get': c => getSelection(target(c)),
  'sprite.selection.set': (c, sel) => write(c, 'Select', s => setSelection(s, sel), true),

  'documents.list': () => state.docs.map(docInfo),
  'documents.active': () => { const d = activeDoc(); return d && docInfo(d); },
  'documents.open': async (_c, file) => {
    if (!isObject(file) || typeof file.name !== 'string' || !(file.data instanceof ArrayBuffer)) fail('invalid', 'file must be {name, data: ArrayBuffer}');
    const { loadFile } = await import("~/core/Files");
    await loadFile(new File([file.data as ArrayBuffer], file.name as string));
    return docId(state.sprite);
  },
  'documents.create': (_c, opts) => {
    const o = isObject(opts) ? opts : {};
    const w = int(o.width, 'width'), h = int(o.height, 'height');
    if (w < 1 || h < 1 || w > 4096 || h > 4096) fail('invalid', 'Size must be 1..4096');
    const doc = state.newDocument();
    doc.reset(w, h, typeof o.name === 'string' ? o.name : 'untitled');
    if (o.colorMode === 'indexed' || o.colorMode === 'gray') doc.convertColorMode(o.colorMode);
    state.fit();
    return docId(doc);
  },

  // Extension data: namespaced by the calling extension; one object per part, `key` inside it

  'meta.get': (c, t, key) => {
    const v = target(c).getExtData(metaTarget(t), c.host.id);
    return isObject(v) ? v[String(key)] : undefined;
  },
  'meta.set': (c, t, key, value) => write(c, 'Extension data', s => {
    const mt = metaTarget(t);
    const old = s.getExtData(mt, c.host.id);
    if (!s.setExtData(mt, c.host.id, { ...(isObject(old) ? old : {}), [String(key)]: value }, null)) fail('not-found', 'No such part of the document');
  }),
  'meta.delete': (c, t, key) => write(c, 'Extension data', s => {
    const mt = metaTarget(t);
    const old = s.getExtData(mt, c.host.id);
    if (!isObject(old)) return;
    const { [String(key)]: _, ...rest } = old;
    s.setExtData(mt, c.host.id, Object.keys(rest).length ? rest : undefined, null);
  }),

  // Locks: one owner per document

  'locks.get': c => { const l = target(c).getLocks(); return l && structuredClone(l); },
  'locks.set': (c, locks: Locks) => {
    if (!isObject(locks)) fail('invalid', 'locks must be an object');
    if (!target(c).setLocks(c.host.id, locks)) fail('locked', 'Locks belong to another extension');
    state.save();
  },
  'locks.clear': c => { target(c).clearLocks(c.host.id); state.save(); },
};

function metaTarget(t: unknown): MetaTarget {
  if (!isObject(t) || typeof t.kind !== 'string') fail('invalid', 'target must be {kind, ...}');
  const m = t as MetaTarget;
  switch (m.kind) {
    case 'sprite': return m;
    case 'layer': return { kind: 'layer', layer: int(m.layer, 'layer') };
    case 'frame': return { kind: 'frame', frame: int(m.frame, 'frame') };
    case 'tag': return { kind: 'tag', tag: int(m.tag, 'tag') };
    case 'slice': return { kind: 'slice', slice: int(m.slice, 'slice') };
    case 'cel': return { kind: 'cel', layer: int(m.layer, 'layer'), frame: int(m.frame, 'frame') };
  }
  return fail('invalid', `Unknown target ${(t as { kind: string; }).kind}`);
}
