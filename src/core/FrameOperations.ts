import type { SpriteContext } from "./SpriteContext";
import {
  cloneCel, normalizeDepths, reframeCel, span, subtreeStart, TAG_COLORS, type Cel, type CelImage,
  type Layer, type Range, type RangeClip, type Tag, type TagDirection,
} from "./SpriteModel";

// Frames

/** Inserts frames at `at` (before it) with the given cel source per layer */
export function insertFrames(this: SpriteContext, at: number, count: number, make: (layer: Layer, li: number, k: number) => Cel, duration = 100): void {
  const frames = this.frames.slice();
  frames.splice(at, 0, ...Array.from({ length: count }, () => ({ duration })));
  this.layers.forEach((l, li) => {
    const cels = Array.from({ length: count }, (_, k) => make(l, li, k) ?? (l.background ? this.filledCel() : null));
    l.cels.splice(at, 0, ...cels);
    l.celOpacity.splice(at, 0, ...cels.map(() => 1));
  });
  this.shiftTags(at, count);
  this.frames = frames;
}

/**
 * Places outside images into this document at (x, y): as a new layer (image i lands on frame
 * current + i, frames are added when needed) or as new frames after the current one on the active layer.
 */
export function importImages(this: SpriteContext, images: { w: number; h: number; data: Uint32Array; delay: number; }[], mode: 'layer' | 'frames', x: number, y: number, name = 'Imported'): void {
  if (!images.length) return;
  this.dropFloating();
  if (mode === 'layer') {
    if (this.refuse('layers', 'create')) return;
    const need = this.frame + images.length - this.frames.length;
    if (need > 0 && (this.refuse('frames', 'create') || this.refuseFrameShift(this.frames.length, need))) return;
    this.addLayer();
    this.layers[this.layer] = { ...this.layers[this.layer], name: this.nextName(name) };
    if (need > 0) this.insertFrames(this.frames.length, need, () => null, images[images.length - 1].delay);
    images.forEach((im, i) => this.setCel({ x, y, w: im.w, h: im.h, data: im.data.slice() }, this.layer, this.frame + i));
  } else {
    if (!this.editable || this.refuse('frames', 'create') || this.refuseFrameShift(this.frame + 1, images.length)) return;
    this.checkpoint('Import frames');
    const at = this.frame + 1;
    this.insertFrames(at, images.length, () => null);
    images.forEach((im, i) => {
      this.frames[at + i] = { ...this.frames[at + i], duration: im.delay || 100 };
      this.setCel({ x, y, w: im.w, h: im.h, data: im.data.slice() }, this.layer, at + i);
    });
    this.frame = at;
  }
  this.range = null;
  this.touch();
}

export function addFrame(this: SpriteContext, mode: 'empty' | 'duplicate' = 'duplicate'): boolean {
  if (this.refuse('frames', 'create') || this.refuseFrameShift(this.frame + 1, 1)) return false;
  this.dropFloating();
  this.checkpoint(mode === 'empty' ? 'New empty frame' : 'New frame');
  const src = this.frame;
  const at = src + 1;
  this.insertFrames(at, 1, l => {
    if (mode === 'empty') return null;
    const cel = l.cels[src];
    // Continuous layers link the new cel to the previous one
    return cel && (l.continuous ? cel : cloneCel(cel));
  }, this.frames[src].duration);
  this.layers.forEach(l => { if (mode === 'duplicate') l.celOpacity[at] = l.celOpacity[src]; });
  this.frame = at;
  this.range = null;
  this.touch();
  return true;
}

export function removeFrames(this: SpriteContext): boolean {
  const sel = this.selectedFrames;
  if (sel.length >= this.frames.length) return false;
  if (this.refuse('frames', 'delete') || sel.some(f => this.refuseFrameShift(f, -1))) return false;
  this.dropFloating();
  this.checkpoint(sel.length > 1 ? 'Delete frames' : 'Delete frame');
  for (const f of sel.slice().reverse()) {
    for (const l of this.layers) {
      l.cels.splice(f, 1);
      l.celOpacity.splice(f, 1);
    }
    this.shiftTags(f + 1, -1);
  }
  this.frames = this.frames.filter((_, i) => !sel.includes(i));
  this.frame = Math.min(sel[0], this.frames.length - 1);
  this.range = null;
  this.touch();
  return true;
}

/** Keeps tag ranges valid after inserting (delta > 0) or removing (delta -1) frames at `at` */
export function shiftTags(this: SpriteContext, at: number, delta: number): void {
  const shift = (from: number, to: number): [number, number] => delta > 0
    ? [from >= at ? from + delta : from, to >= at - 1 ? to + delta : to]
    : [from >= at ? from + delta : from, to >= at - 1 ? to + delta : to];
  this.tags = this.tags
    .map(t => {
      const [from, to] = shift(t.from, t.to);
      return { ...t, from, to };
    })
    .filter(t => t.to >= t.from && t.to >= 0);
  if (this.loop) {
    const [from, to] = shift(...this.loop);
    this.loop = to >= from ? [from, to] : null;
  }
}

export function moveFrame(this: SpriteContext, dir: -1 | 1): void {
  const to = this.frame + dir;
  if (to < 0 || to >= this.frames.length) return;
  this.moveFrames([this.frame, this.frame], dir > 0 ? to + 1 : to, false);
}

/**
 * Moves (or copies) the frame block [a, b] so it starts before frame `before`.
 * Durations travel with the frames; copies link cels on continuous layers.
 */
export function moveFrames(this: SpriteContext, [a, b]: [number, number], before: number, copy: boolean): void {
  const count = b - a + 1;
  if (!copy && before >= a && before <= b + 1) return;
  if (copy ? this.refuse('frames', 'create') || this.refuseFrameShift(before, count)
    : this.refuse('frames', 'move') || (!!this.locks?.tags && this.refuse('tags', 'move'))) return;
  this.dropFloating();
  this.checkpoint(copy ? 'Copy frames' : 'Move frames');
  const pick = <T,>(arr: T[]) => arr.slice(a, b + 1);
  const frames = pick(this.frames).map(f => ({ ...f }));
  const copies = new Map<CelImage, Cel>();
  const blocks = this.layers.map(l => ({
    cels: pick(l.cels).map(c => c && (copy && !l.continuous ? copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)! : c)),
    op: pick(l.celOpacity),
  }));
  let at = before;
  if (!copy) {
    this.frames = this.frames.filter((_, i) => i < a || i > b);
    this.layers.forEach(l => { l.cels.splice(a, count); l.celOpacity.splice(a, count); });
    if (before > b) at -= count;
  }
  const all = this.frames.slice();
  all.splice(at, 0, ...frames);
  this.layers.forEach((l, i) => {
    l.cels.splice(at, 0, ...blocks[i].cels);
    l.celOpacity.splice(at, 0, ...blocks[i].op);
  });
  this.frames = all;
  this.frame = at + (this.frame >= a && this.frame <= b ? this.frame - a : 0);
  this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [at, at + count - 1] };
  this.touch();
}

/** Moves (or copies) a rectangle of cels by (dl, df); missing frames are created */
export function moveCels(this: SpriteContext, r: Range, dl: number, df: number, copy: boolean): void {
  if (!dl && !df) return;
  const [l0, l1] = r.layers, [f0, f1] = r.frames;
  if (l0 + dl < 0 || l1 + dl >= this.layers.length || f0 + df < 0) return;
  this.dropFloating();
  this.checkpoint(copy ? 'Copy cels' : 'Move cels');
  const need = f1 + df + 1 - this.frames.length;
  if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[this.frames.length - 1].duration);
  const src = span(r.layers).map(l => span(r.frames).map(f => ({
    cel: this.layers[l].cels[f], op: this.layers[l].celOpacity[f],
  })));
  if (!copy) span(r.layers).forEach(l => span(r.frames).forEach(f => {
    const layer = this.layers[l];
    layer.cels[f] = layer.background ? this.filledCel() : null;
  }));
  const copies = new Map<CelImage, Cel>();
  src.forEach((row, i) => row.forEach(({ cel, op }, k) => {
    const l = l0 + i + dl, f = f0 + k + df;
    const layer = this.layers[l];
    const sameLayer = dl === 0;
    // Copies within a continuous layer become links
    layer.cels[f] = cel && (copy && !(sameLayer && layer.continuous) ? copies.get(cel) ?? copies.set(cel, cloneCel(cel)).get(cel)! : cel);
    layer.celOpacity[f] = op;
  }));
  this.layer = Math.min(this.layers.length - 1, this.layer + dl);
  this.frame = this.frame + df;
  this.range = { type: 'cels', layers: [l0 + dl, l1 + dl], frames: [f0 + df, f1 + df] };
  this.layers = this.layers.slice();
  this.touch();
}

/** Copies the selected cel block right after itself (links follow each layer's continuous flag) */
export function duplicateCels(this: SpriteContext, linked?: boolean): void {
  const r = this.range ?? { type: 'cels' as const, layers: [this.layer, this.layer] as [number, number], frames: [this.frame, this.frame] as [number, number] };
  const layers = r.type === 'frames' ? this.layers.map((_, i) => i) : span(r.layers);
  const [f0, f1] = r.type === 'layers' ? [this.frame, this.frame] : r.frames;
  const count = f1 - f0 + 1;
  this.dropFloating();
  this.checkpoint('Duplicate cels');
  const need = f1 + count + 1 - this.frames.length;
  if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[f1].duration);
  for (const li of layers) {
    const l = this.layers[li];
    const copies = new Map<CelImage, Cel>();
    for (let k = 0; k < count; k++) {
      const c = l.cels[f0 + k];
      const link = linked ?? l.continuous;
      // Plain copies keep links between themselves, not with the originals
      l.cels[f1 + 1 + k] = c && (link ? c : copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!);
      l.celOpacity[f1 + 1 + k] = l.celOpacity[f0 + k];
    }
  }
  this.frame += count;
  this.range = r.type === 'layers' ? null : { ...r, frames: [f0 + count, f1 + count] };
  this.layers = this.layers.slice();
  this.touch();
}

/** Snapshot of the timeline range for copy/paste inside the timeline */
export function copyRange(this: SpriteContext): RangeClip | null {
  const r = this.range;
  if (!r) return null;
  if (r.type === 'layers') {
    // Whole layers, groups with their contents
    const idx = new Set(span(r.layers).flatMap(i => span([subtreeStart(this.layers, i), i])));
    const layers = this.layers.filter((_, i) => idx.has(i))
      .map(l => ({ ...l, background: false, cels: l.cels.slice(), celOpacity: l.celOpacity.slice() }));
    return { type: 'layers', layers };
  }
  if (r.type === 'frames') return {
    type: 'frames',
    frames: span(r.frames).map(f => ({
      duration: this.frames[f].duration,
      cels: this.layers.map(l => ({ cel: l.cels[f], op: l.celOpacity[f] })),
    })),
  };
  // Rows top to bottom, so pasting fills from the active layer downward
  return {
    type: 'cels',
    rows: span(r.layers).reverse().map(l => ({
      layer: l,
      cels: span(r.frames).map(f => ({ cel: this.layers[l].cels[f], op: this.layers[l].celOpacity[f] })),
    })),
  };
}

export function pasteRange(this: SpriteContext, clip: RangeClip): void {
  if (clip.type === 'layers' && this.refuse('layers', 'create')) return;
  if (clip.type === 'frames' && (this.refuse('frames', 'create') || this.refuseFrameShift(this.frame, clip.frames.length))) return;
  this.dropFloating();
  this.checkpoint(`Paste ${clip.type}`);
  if (clip.type === 'layers') {
    // On top of everything, as independent copies
    const copies = new Map<CelImage, Cel>();
    const added = clip.layers.map(l => ({ ...l, cels: l.cels.map(c => c && (copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!)) }));
    this.layers = normalizeDepths([...this.layers, ...added]);
    this.layer = this.layers.length - 1;
    this.range = { type: 'layers', layers: [this.layers.length - added.length, this.layers.length - 1], frames: [0, this.frames.length - 1] };
  } else if (clip.type === 'frames') {
    // Inserted before the current frame with their durations
    const copies = new Map<CelImage, Cel>();
    const at = this.frame;
    clip.frames.forEach((fr, k) => {
      this.insertFrames(at + k, 1, (l, li) => {
        const c = fr.cels[li]?.cel ?? null;
        return c && (l.continuous ? c : copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!);
      }, fr.duration);
      this.layers.forEach((l, li) => { l.celOpacity[at + k] = fr.cels[li]?.op ?? 1; });
    });
    this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [at, at + clip.frames.length - 1] };
  } else {
    // Overwrites a block starting at the active cel, going down through the layers
    const copies = new Map<CelImage, Cel>();
    const f0 = this.frame;
    const need = f0 + clip.rows[0].cels.length - this.frames.length;
    if (need > 0) this.insertFrames(this.frames.length, need, () => null, this.frames[this.frames.length - 1].duration);
    let l = this.layer, bottom = l;
    for (const row of clip.rows) {
      while (l >= 0 && this.layers[l].group) l--;
      if (l < 0) break;
      const layer = this.layers[l];
      row.cels.forEach(({ cel, op }, k) => {
        // Links survive only when pasting back into the same continuous layer
        const keep = l === row.layer && layer.continuous;
        layer.cels[f0 + k] = layer.background ? reframeCel(cel, this.canvasRect, this.backgroundFill) : cel && (keep ? cel : copies.get(cel) ?? copies.set(cel, cloneCel(cel)).get(cel)!);
        layer.celOpacity[f0 + k] = op;
      });
      bottom = l;
      l--;
    }
    this.range = { type: 'cels', layers: [bottom, this.layer], frames: [f0, f0 + clip.rows[0].cels.length - 1] };
  }
  this.layers = this.layers.slice();
  this.touch();
}

/** Every later frame of the range shares the first non-empty cel of each layer */
export function linkCels(this: SpriteContext): void {
  const r = this.range;
  if (!r || r.frames[0] === r.frames[1]) return;
  this.checkpoint('Link cels');
  const layers = r.type === 'frames' ? this.layers.map((_, i) => i) : span(r.layers);
  for (const li of layers) {
    const l = this.layers[li];
    if (l.locked) continue;
    const first = span(r.frames).find(f => l.cels[f]);
    if (first === undefined) continue;
    for (const f of span(r.frames)) if (f > first) l.cels[f] = l.cels[first];
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function unlinkCels(this: SpriteContext): void {
  this.checkpoint('Unlink cels');
  for (const [li, f] of this.selectedCels) {
    const l = this.layers[li];
    const c = l.cels[f];
    if (c && !l.locked && this.isLinked(li, f)) l.cels[f] = cloneCel(c);
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function clearCels(this: SpriteContext): void {
  this.dropFloating();
  this.checkpoint('Clear cel');
  for (const [li, f] of this.selectedCels) {
    const l = this.layers[li];
    if (l.locked) continue;
    l.cels[f] = l.background ? this.filledCel() : null;
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function setCelOpacity(this: SpriteContext, opacity: number): void {
  this.checkpoint('Cel opacity');
  for (const [li, f] of this.selectedCels) {
    const l = this.layers[li];
    if (!l.background) l.celOpacity[f] = opacity;
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function reverseFrames(this: SpriteContext): void {
  const sel = this.selectedFrames.length > 1 ? this.selectedFrames : this.frames.map((_, i) => i);
  const cels = this.range?.type === 'cels';
  if (!cels && this.refuse('frames', 'move')) return;
  this.checkpoint('Reverse frames');
  const rev = <T,>(arr: T[]) => {
    const part = sel.map(i => arr[i]).reverse();
    sel.forEach((i, k) => arr[i] = part[k]);
  };
  if (!cels) {
    const frames = this.frames.slice();
    rev(frames);
    this.frames = frames;
  }
  const layers = cels ? this.selectedLayers : this.layers.map((_, i) => i);
  for (const li of layers) {
    rev(this.layers[li].cels);
    rev(this.layers[li].celOpacity);
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function setDuration(this: SpriteContext, duration: number, all = false): void {
  const sel = all ? this.frames.map((_, i) => i) : this.selectedFrames;
  if (this.refuse('frames', 'resize')) return;
  this.checkpoint('Frame duration');
  this.frames = this.frames.map((f, i) => sel.includes(i) ? { ...f, duration } : f);
  this.touch();
}

/** Bulk timing: set, multiply or add to the duration of the selected (or all) frames */
export function changeDurations(this: SpriteContext, mode: 'set' | 'multiply' | 'add', value: number, all = false): void {
  const sel = all ? this.frames.map((_, i) => i) : this.selectedFrames;
  const apply = (d: number) => mode === 'set' ? value : mode === 'multiply' ? d * value : d + value;
  if (this.refuse('frames', 'resize')) return;
  this.checkpoint('Frame duration');
  this.frames = this.frames.map((f, i) => sel.includes(i) ? { ...f, duration: Math.max(10, Math.round(apply(f.duration))) } : f);
  this.touch();
}

/** Scales a tag's frame durations so the whole tag lasts `total` ms */
export function stretchTag(this: SpriteContext, index: number, total: number): void {
  const tag = this.tags[index];
  if (!tag) return;
  let sum = 0;
  for (let i = tag.from; i <= tag.to; i++) sum += this.frames[i].duration;
  if (!sum || this.refuse('frames', 'resize')) return;
  this.checkpoint('Stretch tag');
  // Rounding error is carried along so the total comes out exact
  let acc = 0, given = 0;
  this.frames = this.frames.map((f, i) => {
    if (i < tag.from || i > tag.to) return f;
    acc += f.duration * total / sum;
    const d = Math.max(10, Math.round(acc - given));
    given += d;
    return { ...f, duration: d };
  });
  this.touch();
}

/**
 * Inserts `count` in-between frames before the last frame of the range (or after the current one),
 * moving the current layer's cel position and opacity from the first key to the last.
 * Pixels come from the nearer key; other layers hold the first key's cel.
 */
export function tweenFrames(this: SpriteContext, count: number, ease = false): boolean {
  const [a, b] = this.range && this.range.type !== 'layers' ? this.range.frames : [this.frame, this.frame + 1];
  const li = this.range && this.range.type !== 'frames' ? this.range.layers[0] : this.layer;
  const l = this.layers[li];
  if (!l || b <= a || b >= this.frames.length || count < 1) return false;
  const k0 = l.cels[a], k1 = l.cels[b];
  if (!k0 && !k1) return false;
  const o0 = l.celOpacity[a] ?? 1, o1 = l.celOpacity[b] ?? 1;
  if (this.refuse('frames', 'create') || this.refuseFrameShift(b, count)) return false;
  this.dropFloating();
  this.checkpoint('In-between frames');
  const at = b;
  const curve = (t: number) => ease ? t * t * (3 - 2 * t) : t;
  const ts = Array.from({ length: count }, (_, k) => curve((k + 1) / (count + 1)));
  this.insertFrames(at, count, (layer, i, k) => {
    if (i !== li) return layer.cels[a];
    const t = ts[k];
    const src = (t < 0.5 ? k0 ?? k1 : k1 ?? k0)!;
    if (layer.tileset >= 0 || layer.background || !k0 || !k1) return src;
    return { ...src, x: Math.round(k0.x + (k1.x - k0.x) * t), y: Math.round(k0.y + (k1.y - k0.y) * t) };
  }, this.frames[a].duration);
  this.layers.forEach((layer, i) => {
    for (let k = 0; k < count; k++)
      layer.celOpacity[at + k] = i === li ? o0 + (o1 - o0) * ts[k] : layer.celOpacity[a] ?? 1;
  });
  this.layers = this.layers.slice();
  this.range = { type: 'frames', layers: [0, this.layers.length - 1], frames: [a, b + count] };
  this.touch();
  return true;
}

/** Moves the content of every selected cel by (dx, dy); linked cels move once */
export function nudgeCels(this: SpriteContext, dx: number, dy: number): void {
  this.dropFloating();
  this.checkpoint('Move cel');
  const done = new Set<CelImage>();
  for (const [li, f] of this.selectedCels) {
    const l = this.layers[li];
    const cel = l?.cels[f];
    if (!cel || done.has(cel) || l.locked || l.background || l.tileset >= 0) continue;
    const next = { ...cel, x: cel.x + dx, y: cel.y + dy };
    done.add(cel).add(next);
    l.cels.forEach((c, i) => { if (c === cel) l.cels[i] = next; });
  }
  this.layers = this.layers.slice();
  this.touch();
}

export function addTag(this: SpriteContext): boolean {
  const [from, to] = this.range && this.range.type !== 'layers' ? this.range.frames : [this.frame, this.frame];
  if (this.refuse('tags', 'create')) return false;
  this.checkpoint('New tag');
  this.tags = [...this.tags, {
    name: `Tag ${this.tags.length + 1}`,
    from, to,
    color: TAG_COLORS[this.tags.length % TAG_COLORS.length],
    direction: 'forward',
  }];
  this.touch();
  return true;
}

export function updateTag(this: SpriteContext, index: number, patch: Partial<Tag>, checkpoint = true): boolean {
  const t = this.tags[index];
  if (!t) return false;
  if (patch.name !== undefined && patch.name !== t.name && this.refuse('tags', 'rename')) return false;
  const from = patch.from ?? t.from, to = patch.to ?? t.to;
  if (to - from !== t.to - t.from && this.refuse('tags', 'resize')) return false;
  if (from !== t.from && to - from === t.to - t.from && this.refuse('tags', 'move')) return false;
  if (checkpoint) this.checkpoint('Tag properties');
  this.tags = this.tags.map((t, i) => i === index ? { ...t, ...patch } : t);
  this.touch();
  return true;
}

export function removeTag(this: SpriteContext, index: number): boolean {
  if (this.refuse('tags', 'delete')) return false;
  this.checkpoint('Delete tag');
  this.tags = this.tags.filter((_, i) => i !== index);
  this.touch();
  return true;
}

/** The innermost (shortest) tag containing the frame */
export function tagAt(this: SpriteContext, frame = this.frame): Tag | null {
  let best: Tag | null = null;
  for (const t of this.tags)
    if (frame >= t.from && frame <= t.to && (!best || t.to - t.from < best.to - best.from)) best = t;
  return best;
}

/** Frames playback and frame navigation stay within: innermost tag, else loop section, else everything */
export function playRange(this: SpriteContext, frame = this.frame): { from: number; to: number; direction: TagDirection; repeat?: number; } {
  const tag = this.tagAt(frame);
  if (tag) return tag;
  if (this.loop && frame >= this.loop[0] && frame <= this.loop[1])
    return { from: this.loop[0], to: this.loop[1], direction: 'forward' };
  return { from: 0, to: this.frames.length - 1, direction: 'forward' };
}

/** Frame order of a tag: one pass per its direction, unrolled `repeat` times (at least once) */
export function tagSequence(this: SpriteContext, t: { from: number; to: number; direction: TagDirection; repeat?: number; }): number[] {
  const fwd = Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
  const pass = t.direction === 'reverse' ? fwd.slice().reverse()
    : t.direction === 'pingpong' ? [...fwd, ...fwd.slice(1, -1).reverse()]
    : t.direction === 'pingpong-reverse' ? [...fwd.slice().reverse(), ...fwd.slice(1, -1)] : fwd;
  const out: number[] = [];
  for (let k = 0; k < Math.max(1, t.repeat ?? 0); k++) out.push(...pass);
  return out;
}

/** Sets the loop section to the selected frames, or clears it */
export function setLoopSection(this: SpriteContext): void {
  const r = this.range && this.range.type !== 'layers' ? this.range.frames : null;
  this.checkpoint('Loop section');
  this.loop = r && r[1] > r[0] ? [r[0], r[1]] : null;
}
