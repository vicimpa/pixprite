import { unionRect, type Rect } from "~/core/Image";
import * as rendering from './SpriteRenderer';
import type { LayerFX } from './DocumentModel';
import type { SpriteContext } from "./SpriteContext";
import { bakeCel, copyEffectScope, createCelInstance, effectsForFrame, imageOf, isCelInstance, hasPixelEffects, hasColorEffects, validateLayerFX } from './DocumentModel';
import {
  celRect, cloneCel, newLayer, normalizeDepths, parentOf, rootsOf, span, subtreeStart, trimCel, type Cel,
  type CelImage, type Layer, type RefImage,
} from "./SpriteModel";

/** Bake a stack in one transaction. Group content is rasterized only in the chosen
 * frames; its hierarchy and every other frame stay editable. */
export function bakeLayerEffects(this: SpriteContext, scope: 'layer' | 'frame' | 'range' = 'layer', index = this.layer, draft?: readonly LayerFX[]): boolean {
  const original = this.layers[index];
  if (draft) validateLayerFX(draft);
  const target = original && { ...original, effects: draft ? draft.map(effect => ({ ...effect })) : original.effects };
  if (!target || target.reference || this.lockedDeep(index) || !target.effects?.length) return false;
  const chosen = scope === 'layer' ? this.frames.map((_, f) => f)
    : scope === 'frame' ? [this.frame] : this.selectedFrames;
  const selected = new Set(chosen);
  if (!chosen.some(f => effectsForFrame(target, f).length)) return false;
  const start = subtreeStart(this.layers, index);
  if (target.group && (this.layers.slice(start, index).some((l, i) => this.lockedDeep(start + i))
    || this.refuse('layers', 'create'))) return false;
  const proposed = { ...this, layers: this.layers.map((l, i) => i === index ? target : l), effectsPreview: null };
  rendering.validateEffectBounds(proposed, chosen, [index]);
  if (target.group) chosen.forEach(frame => {
    rendering.groupBounds.call(proposed, index, frame);
    rendering.nodeBounds(proposed, index, frame);
  });
  this.dropFloating();
  const source = { ...this.layers[index], effects: target.effects };
  const ids = new Set(source.effects.map(effect => effect.id));
  const bakedEffects = this.frames.map((_, f) => selected.has(f) ? [...ids]
    : (source.bakedEffects?.[f] ?? []).filter(id => ids.has(id)));
  const complete = bakedEffects.every(baked => [...ids].every(id => baked.includes(id)));
  let alpha = false, color = false;
  let layers = this.layers.slice();
  if (source.group) {
    const child = newLayer(`${source.name} FX`, this.frames.length);
    child.depth = source.depth + 1;
    const context = { ...this, ...rendering, layers: layers.map((l, i) => i === index ? source : l), floating: null, effectsPreview: null };
    child.cels = this.frames.map((_, f) => {
      if (!selected.has(f)) return null;
      alpha ||= hasPixelEffects(effectsForFrame(source, f)) || layers.slice(start, index).some(layer => hasPixelEffects(effectsForFrame(layer, f)));
      color ||= hasColorEffects(effectsForFrame(source, f)) || layers.slice(start, index).some(layer => hasColorEffects(effectsForFrame(layer, f)));
      return rendering.groupCel.call(context, index, f);
    });
    layers = layers.map((layer, i) => i >= start && i < index ? {
      ...layer, cels: layer.group ? layer.cels : layer.cels.map((cel, f) => selected.has(f) ? null : cel),
      bakedEffects: layer.bakedEffects?.map((ids, f) => selected.has(f) ? [] : ids),
    } : layer);
    layers[index] = { ...source, effects: complete ? [] : source.effects, bakedEffects: complete ? undefined : bakedEffects };
    layers.splice(index, 0, child);
  } else {
    const cache = new Map<CelImage, Map<string, Cel>>();
    const cels = source.cels.map((cel, frame) => {
      if (!cel) return null;
      const effects = selected.has(frame) ? effectsForFrame(source, frame) : [];
      alpha ||= hasPixelEffects(effects);
      color ||= hasColorEffects(effects);
      const key = JSON.stringify(effects.map(effect => effect.id));
      const variants = cache.get(cel) ?? new Map<string, Cel>();
      cache.set(cel, variants);
      if (!variants.has(key)) {
        let next = effects.length ? bakeCel(cel, effects) : cel;
        // Baked results own immutable resources, including identity/disabled stacks.
        // A tilemap converts as a layer; untouched frames keep their source resource.
        if ((effects.length || source.tileset >= 0) && next) next = createCelInstance(imageOf(next), {
          ...(isCelInstance(next) ? next.transform : {}), x: next.x, y: next.y, ext: next.ext,
        });
        variants.set(key, next);
      }
      return variants.get(key)!;
    });
    layers[index] = { ...source, cels, tileset: -1, background: alpha ? false : source.background,
      effects: complete ? [] : source.effects, bakedEffects: complete ? undefined : bakedEffects };
  }
  this.checkpoint('Bake layer effects');
  if ((alpha && this.colorMode === 'indexed') || (color && this.colorMode === 'gray')) { this.colorMode = 'rgb'; this.transparentIndex = -1; }
  this.layers = layers;
  this.layer = source.group ? index + 1 : index;
  this.range = null;
  this.touch();
  return true;
}

export function getBackgroundIndex(this: SpriteContext): number {
  return this.layers.findIndex(l => l.background);
}

export function filledCel(this: SpriteContext): CelImage {
  return { ...this.canvasRect, data: new Uint32Array(this.size).fill(this.backgroundFill) };
}

/** "Prefix N" with N one more than the highest used so far (gaps are not reused) */
export function nextName(this: SpriteContext, prefix: string): string {
  const re = new RegExp(`^${prefix} (\\d+)$`);
  return `${prefix} ${Math.max(0, ...this.layers.map(l => +(re.exec(l.name)?.[1] ?? 0))) + 1}`;
}

/** Where a new layer goes: inside an open active group (at its bottom), else right above the active layer */
export function insertionPoint(this: SpriteContext): { index: number; depth: number; } {
  const cur = this.current;
  if (!cur) return { index: this.layers.length, depth: 0 };
  if (cur.group && !cur.collapsed) return { index: subtreeStart(this.layers, this.layer), depth: cur.depth + 1 };
  return { index: this.layer + 1, depth: cur.depth };
}

export function addLayer(this: SpriteContext, below = false): string {
  if (this.refuse('layers', 'create')) return '';
  this.dropFloating();
  this.checkpoint('New layer');
  const layers = this.layers.slice();
  const layer = newLayer(this.nextName('Layer'), this.frames.length);
  let at: number;
  if (below && this.current && !this.current.background) {
    at = subtreeStart(layers, this.layer);
    layer.depth = this.current.depth;
  } else {
    const p = this.insertionPoint();
    at = p.index;
    layer.depth = p.depth;
  }
  layers.splice(at, 0, layer);
  this.layers = normalizeDepths(layers);
  this.layer = at;
  this.range = null;
  this.touch();
  return layer.name;
}

/** New group above the active layer; selected sibling layers move into it */
export function addGroup(this: SpriteContext): void {
  if (this.refuse('layers', 'create')) return;
  this.dropFloating();
  this.checkpoint('New group');
  const layers = this.layers.slice();
  const group: Layer = { ...newLayer(this.nextName('Group'), this.frames.length), group: true };
  const sel = this.range?.type === 'layers' ? this.selectedLayers : [];
  const d = layers[sel[0]]?.depth;
  const siblings = sel.length > 0 && sel.every(i => layers[i].depth === d && !layers[i].background)
    && sel.every(i => parentOf(layers, i) === parentOf(layers, sel[0]));
  if (siblings) {
    // Wrap the selected blocks: they become contiguous children right below the new group
    const top = Math.max(...sel);
    const blocks = sel.map(i => [subtreeStart(layers, i), i] as const);
    const inside = new Set(blocks.flatMap(([a, b]) => span([a, b])));
    const moved = layers.filter((_, i) => inside.has(i)).map(l => ({ ...l, depth: l.depth + 1 }));
    const rest: Layer[] = [];
    let at = 0;
    layers.forEach((l, i) => {
      if (inside.has(i)) return;
      rest.push(l);
      if (i < top) at = rest.length;
    });
    group.depth = d;
    rest.splice(at, 0, ...moved, group);
    this.layers = normalizeDepths(rest);
    this.layer = at + moved.length;
  } else {
    const p = this.insertionPoint();
    group.depth = p.depth;
    layers.splice(p.index, 0, group);
    this.layers = normalizeDepths(layers);
    this.layer = p.index;
  }
  this.range = null;
  this.touch();
}

export function duplicateLayer(this: SpriteContext): void {
  const src = this.current;
  if (!src || this.refuse('layers', 'create')) return;
  this.dropFloating();
  this.checkpoint('Duplicate layer');
  const layers = this.layers.slice();
  // A duplicate (with everything nested in it) keeps link structure inside itself but not with the original
  const start = subtreeStart(layers, this.layer);
  const copies = new Map<CelImage, Cel>();
  const block = layers.slice(start, this.layer + 1).map((l, k, all) => ({
    ...l,
    name: k === all.length - 1 ? `${l.name} copy` : l.name,
    background: false,
    cels: l.cels.map(c => c && (copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!)),
    celOpacity: l.celOpacity.slice(),
    bakedEffects: copyEffectScope(l),
  }));
  layers.splice(this.layer + 1, 0, ...block);
  this.layers = normalizeDepths(layers);
  this.layer += block.length;
  this.range = null;
  this.touch();
}

export function removeLayers(this: SpriteContext): boolean {
  // Removing a group removes everything inside it
  const sel = new Set(this.selectedLayers.flatMap(i => span([subtreeStart(this.layers, i), i])));
  if (rootsOf(this.layers).every(i => sel.has(i))) return false;
  if (this.refuse('layers', 'delete')) return false;
  this.dropFloating();
  this.checkpoint(sel.size > 1 ? 'Delete layers' : 'Delete layer');
  this.layers = normalizeDepths(this.layers.filter((_, i) => !sel.has(i)));
  // The layer below the removed block becomes active, or the one above when nothing is below
  this.layer = Math.max(0, Math.min(Math.min(...sel) - 1, this.layers.length - 1));
  this.range = null;
  this.touch();
  return true;
}

/**
 * One step up or down among siblings. At the edge of a group the layer leaves it;
 * moving down onto an open group enters it.
 */
export function moveLayer(this: SpriteContext, dir: -1 | 1): void {
  const layers = this.layers;
  const i = this.layer, cur = layers[i];
  if (!cur || cur.background) return;
  const start = subtreeStart(layers, i);
  let before: number, depth = cur.depth;
  if (dir > 0) {
    const j = i + 1;
    if (j >= layers.length) return;
    if (layers[j].depth < cur.depth) { before = j + 1; depth = layers[j].depth; }
    else {
      // Jump over the whole sibling block above (a group with its contents)
      let r = j;
      while (layers[r].depth > cur.depth) r++;
      before = r + 1;
    }
  } else {
    const k = start - 1;
    if (k < 0 || layers[k].background) {
      if (!cur.depth) return;
      before = start;
      depth = cur.depth - 1;
    } else if (layers[k].depth < cur.depth) {
      // Bottom child: step out below the parent group
      before = start;
      depth = cur.depth - 1;
    } else if (layers[k].group && !layers[k].collapsed) {
      before = k;
      depth = cur.depth + 1;
    } else before = subtreeStart(layers, k);
  }
  this.moveBlock(start, i, before, depth, 'Reorder layers');
}

/** Moves layers [a..b] so they end up right below index `before`, re-nesting the block's root at `depth` */
export function moveBlock(this: SpriteContext, a: number, b: number, before: number, depth: number, label: string): void {
  if (this.refuse('layers', 'move')) return;
  this.dropFloating();
  this.checkpoint(label);
  const delta = depth - this.layers[b].depth;
  const block = this.layers.slice(a, b + 1).map(l => ({ ...l, depth: l.depth + delta }));
  const rest = this.layers.filter((_, k) => k < a || k > b);
  const at = before > b ? before - block.length : before;
  rest.splice(at, 0, ...block);
  this.layers = normalizeDepths(rest);
  this.layer = at + block.length - 1;
  this.range = null;
  this.touch();
}

/** Takes the active layer out of its group, right above the group */
export function moveOutOfGroup(this: SpriteContext): void {
  const p = parentOf(this.layers, this.layer);
  if (p < 0) return;
  this.moveBlock(subtreeStart(this.layers, this.layer), this.layer, p + 1, this.layers[p].depth, 'Move out of group');
}

/** Dissolves a group, keeping its contents in place */
export function ungroup(this: SpriteContext): void {
  const g = this.layer, l = this.current;
  if (!l?.group || this.refuse('layers', 'delete')) return;
  this.dropFloating();
  this.checkpoint('Ungroup');
  const start = subtreeStart(this.layers, g);
  this.layers = normalizeDepths(this.layers
    .map((x, k) => k >= start && k < g ? { ...x, depth: x.depth - 1 } : x)
    .filter((_, k) => k !== g));
  this.layer = Math.max(0, g - 1);
  this.touch();
}

export function toggleCollapsed(this: SpriteContext, i: number): void {
  this.layers = this.layers.map((l, k) => k === i ? { ...l, collapsed: !l.collapsed } : l);
  this.touch();
}

export function updateLayer(this: SpriteContext, index: number, patch: Partial<Omit<Layer, 'cels' | 'celOpacity'>>, label = 'Layer properties'): boolean {
  if (!this.layers[index]) return false;
  if (patch.effects !== undefined) {
    validateLayerFX(patch.effects);
    patch = { ...patch, effects: patch.effects.map(effect => ({ ...effect })) };
    rendering.validateEffectChange(this, index, patch.effects!, this.frames.map((_, f) => f));
  }
  if (patch.name !== undefined && patch.name !== this.layers[index].name && this.refuse('layers', 'rename')) return false;
  this.checkpoint(label);
  this.layers = this.layers.map((l, i) => i === index ? { ...l, ...patch } : l);
  this.touch();
  return true;
}

/** Reference layer above the current one holding an outside image, scaled to fit the canvas */
export function addReferenceLayer(this: SpriteContext, src: string, w: number, h: number, name = 'Reference'): void {
  if (this.refuse('layers', 'create')) return;
  this.addLayer();
  const scale = Math.min(this.width / w, this.height / h) || 1;
  const reference: RefImage = { src, scale, x: (this.width - w * scale) / 2, y: (this.height - h * scale) / 2 };
  this.layers[this.layer] = { ...this.layers[this.layer], name, reference, opacity: 0.5, locked: false };
  this.touch();
}

/** Shows only this layer (with its groups and children); called again on the same layer restores the rest */
export function soloLayer(this: SpriteContext, i: number): void {
  if (!this.layers[i]) return;
  const keep = new Set<number>();
  for (let k = i; k >= 0; k = parentOf(this.layers, k)) keep.add(k);
  for (let k = subtreeStart(this.layers, i); k <= i; k++) keep.add(k);
  const solo = this.layers.map((_, k) => keep.has(k));
  const saved = this.soloSaved;
  const isSolo = this.layers.every((l, k) => l.visible === solo[k]);
  this.checkpoint('Layer flags');
  if (saved && saved.layers.length === this.layers.length && isSolo && this.layers[i].visible) {
    this.layers = this.layers.map((l, k) => ({ ...l, visible: saved.visible[k] }));
    this.soloSaved = null;
  } else {
    this.soloSaved = { layers: this.layers, visible: this.layers.map(l => l.visible) };
    this.layers = this.layers.map((l, k) => l.visible === solo[k] ? l : { ...l, visible: solo[k] });
  }
  this.touch();
}

/** Visibility / lock / continuous for every layer: if all are on, turn all off, otherwise all on */
export function toggleAllLayers(this: SpriteContext, flag: 'visible' | 'locked' | 'continuous'): void {
  const all = this.layers.every(l => l[flag]);
  this.checkpoint('Layer flags');
  this.layers = this.layers.map(l => ({ ...l, [flag]: !all }));
  this.touch();
}

/** Turns the current layer into the opaque bottom background */
export function layerToBackground(this: SpriteContext): void {
  const l = this.current;
  if (!l || l.group || this.backgroundIndex >= 0) return;
  this.dropFloating();
  this.checkpoint('Background from layer');
  const cels = this.frames.map((_, f) => {
    const can = new OffscreenCanvas(this.width, this.height);
    const ctx = can.getContext('2d')!;
    ctx.fillStyle = `#${[0, 8, 16].map(s => ((this.backgroundFill >>> s) & 255).toString(16).padStart(2, '0')).join('')}`;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawLayer(ctx, this.layer, f, true);
    return { ...this.canvasRect, data: new Uint32Array(ctx.getImageData(0, 0, this.width, this.height).data.buffer) };
  });
  const bg: Layer = { ...l, name: 'Background', background: true, opacity: 1, blend: 'source-over', cels, celOpacity: cels.map(() => 1), ...(l.effects ? { effects: [], bakedEffects: undefined } : {}) };
  this.layers = [bg, ...this.layers.filter((_, i) => i !== this.layer)];
  this.layer = 0;
  this.touch();
}

export function backgroundToLayer(this: SpriteContext): void {
  const i = this.backgroundIndex;
  if (i < 0) return;
  this.checkpoint('Layer from background');
  this.layers = this.layers.map((l, k) => k === i ? { ...l, background: false, name: l.name === 'Background' ? 'Layer 0' : l.name } : l);
  this.touch();
}

/** The layer below must be a plain layer at the same level */
export function getCanMergeDown(this: SpriteContext): boolean {
  const top = this.current, below = this.layers[this.layer - 1];
  // A plain layer can't merge into a clipping one: the result would have to be clipped and not at once
  return !!top && !!below && !top.group && !below.group && below.depth === top.depth && (!below.clip || !!top.clip)
    && !top.reference && !below.reference;
}

export function mergeDown(this: SpriteContext): void {
  if (!this.canMergeDown || this.refuse('layers', 'delete')) return;
  this.dropFloating();
  this.checkpoint('Merge down');
  const top = this.layer, bottom = top - 1;
  const below = this.layers[bottom];
  // Only what is shown is merged; when both are hidden both go in and the result stays hidden
  const shown = below.visible || this.layers[top].visible;
  const vis = (i: number) => !shown || this.layers[i].visible;
  const cels = this.frames.map((_, f) =>
    this.layers[top].cels[f] || below.cels[f] ? this.flatten(f, [bottom, top], !below.background, vis) : null);
  // Opacity is baked in; the blend mode stays, it still applies against what is under the result
  this.layers = this.layers
    .filter((_, i) => i !== top)
    .map((l, i) => i === bottom ? { ...below, visible: shown, opacity: 1, cels, celOpacity: cels.map(() => 1), ...(below.effects ? { effects: [], bakedEffects: undefined } : {}) } : l);
  this.layer = bottom;
  this.range = null;
  this.touch();
}

/** Sibling nodes of the timeline layer range (bottom to top), when there are at least two */
export function getRangeNodes(this: SpriteContext): number[] | null {
  const r = this.range;
  if (r?.type !== 'layers' && r?.type !== 'cels') return null;
  const L = this.layers;
  const [a, b] = r.layers[0] <= r.layers[1] ? r.layers : [r.layers[1], r.layers[0]];
  // The top of the range sets the level; everything must sit in the same parent
  const p = parentOf(L, b), d = L[b]?.depth ?? 0;
  const out: number[] = [];
  for (let i = a; i <= b; i++) {
    if (L[i].depth > d) continue;
    if (L[i].depth < d || parentOf(L, i) !== p) return null;
    out.push(i);
  }
  // A clipping layer at the bottom would lose its base below the range
  if (out.length && L[out[0]].clip && out.some(i => !L[i].clip)) return null;
  return out.length > 1 && !out.some(i => L[i].reference) ? out : null;
}

export function getCanMergeVisible(this: SpriteContext): boolean {
  return rootsOf(this.layers).filter(i => this.layers[i].visible && !this.layers[i].reference).length > 1;
}

/** Merges the shown top-level layers into one, in place of the lowest; hidden ones are kept */
export function mergeVisible(this: SpriteContext): void {
  if (!this.canMergeVisible) return;
  this.mergeNodes(rootsOf(this.layers).filter(i => this.layers[i].visible && !this.layers[i].reference), 'Merge visible');
}

/** Merges the sibling layers of the timeline range (hidden ones in it are dropped) */
export function mergeSelected(this: SpriteContext): void {
  const nodes = this.rangeNodes;
  if (nodes) this.mergeNodes(nodes, 'Merge layers');
}

export function mergeNodes(this: SpriteContext, nodes: number[], label: string): void {
  if (this.refuse('layers', 'delete')) return;
  this.dropFloating();
  this.checkpoint(label);
  const L = this.layers;
  const first = L[nodes[0]];
  const shown = nodes.filter(i => L[i].visible);
  const hasBg = shown.some(i => L[i].background);
  const merged = newLayer(first.name, this.frames.length);
  merged.background = hasBg;
  merged.depth = first.depth;
  if (nodes.every(i => L[i].clip)) merged.clip = true;
  merged.visible = shown.length > 0;
  const vis = (i: number) => !shown.length || L[i].visible;
  merged.cels = this.frames.map((_, f) => this.flatten(f, nodes, !hasBg, vis));
  const drop = new Set<number>();
  for (const i of nodes) for (let k = subtreeStart(L, i); k <= i; k++) drop.add(k);
  const at = subtreeStart(L, nodes[0]);
  const out: Layer[] = [];
  L.forEach((l, i) => {
    if (i === at) out.push(merged);
    if (!drop.has(i)) out.push(l);
  });
  this.layers = out;
  this.layer = out.indexOf(merged);
  this.range = null;
  this.touch();
}

export function flattenAll(this: SpriteContext): void {
  if (this.layers.length < 2 || this.refuse('layers', 'delete')) return;
  this.dropFloating();
  this.checkpoint('Flatten');
  const visible = rootsOf(this.layers).filter(i => this.layers[i].visible);
  const hasBg = this.layers.some(l => l.background && l.visible);
  const merged = newLayer(hasBg ? 'Background' : 'Flattened', this.frames.length);
  merged.background = hasBg;
  merged.cels = this.frames.map((_, f) => this.flatten(f, visible, !hasBg));
  this.layers = [merged];
  this.layer = 0;
  this.range = null;
  this.touch();
}

/** Composites layers into one cel; `elastic` keeps pixels outside the canvas (else canvas-sized) */
/**
 * Layers are sibling nodes, bottom to top, composited as the canvas shows them (clipping included).
 * `vis` decides which of them count as shown; a leading clipping layer has no base in the list
 * and is drawn plainly (it gets clipped again by its own base after the merge).
 */
export function flatten(this: SpriteContext, frame: number, layers: number[], elastic = false, vis = (i: number) => this.layers[i].visible): Cel {
  let rect: Rect | null = elastic ? null : this.canvasRect;
  if (elastic) for (const i of layers)
    for (let k = subtreeStart(this.layers, i); k <= i; k++) {
      const c = this.layers[k]?.cels[frame];
      if (c) rect = unionRect(rect, celRect(c));
    }
  if (!rect) return null;
  const can = new OffscreenCanvas(rect.w, rect.h);
  const ctx = can.getContext('2d')!;
  let k = 0;
  if (this.layers[layers[0]]?.clip)
    for (; k < layers.length && this.layers[layers[k]].clip; k++)
      if (vis(layers[k])) this.drawNode(ctx, layers[k], frame, true, undefined, rect.x, rect.y);
  this.drawSiblings(ctx, layers.slice(k), frame, undefined, rect.x, rect.y, vis);
  const cel = { ...rect, data: new Uint32Array(ctx.getImageData(0, 0, rect.w, rect.h).data.buffer) };
  return elastic ? trimCel(cel) : cel;
}

/** Moves (or copies) the layer block [a, b] so it sits right below layer index `before` (bottom-to-top order) */
export function moveLayers(this: SpriteContext, [a, b]: [number, number], before: number, copy: boolean): boolean {
  // Groups travel with everything inside them
  a = Math.min(a, subtreeStart(this.layers, b));
  const count = b - a + 1;
  if (!copy && before >= a && before <= b + 1) return false;
  const block = this.layers.slice(a, b + 1);
  if (!copy && block.some(l => l.background)) return false;
  const bg = this.backgroundIndex;
  if (bg >= 0 && before <= bg) return false;
  if (this.refuse('layers', copy ? 'create' : 'move')) return false;
  this.dropFloating();
  this.checkpoint(copy ? 'Copy layers' : 'Move layers');
  const copies = new Map<CelImage, Cel>();
  const moved = block.map(l => copy
    ? { ...l, background: false, name: `${l.name} copy`, cels: l.cels.map(c => c && (copies.get(c) ?? copies.set(c, cloneCel(c)).get(c)!)), celOpacity: l.celOpacity.slice(), bakedEffects: copyEffectScope(l) }
    : l);
  let layers = this.layers.slice();
  let at = before;
  if (!copy) {
    layers = layers.filter((_, i) => i < a || i > b);
    if (before > b) at -= count;
  }
  // Dropped right below an open group = its top child; otherwise a sibling of the layer above
  const above = layers[at];
  const depth = !above ? 0 : above.group && !above.collapsed ? above.depth + 1 : above.depth;
  const delta = depth - moved[moved.length - 1].depth;
  layers.splice(at, 0, ...moved.map(l => ({ ...l, depth: l.depth + delta })));
  this.layers = normalizeDepths(layers);
  this.layer = at + (this.layer >= a && this.layer <= b ? this.layer - a : count - 1);
  this.range = { type: 'layers', layers: [at, at + count - 1], frames: [0, this.frames.length - 1] };
  this.touch();
  return true;
}
