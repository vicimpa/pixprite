import { t } from '../i18n';
import { base64, integer } from './data';
export { base64, bytes, integer } from './data';
export { preparePixels } from './pixels';
import { comparisonOptions, viewOptions } from './automation-schema';
import * as z from 'zod/v4-mini';
import { state } from '../State';
import { flipH, flipV, rotate, type Bitmap } from '../Image';
import { type Sprite } from '../Sprite';
import { addViewer } from '../ViewerTabs';
import { docId, snapshot } from '../extensions/api/sprite';

export function provenance(doc: Sprite) { return { documentId: docId(doc), revision: doc.version }; }
export function checkRevision(doc: Sprite, revision: unknown) {
  if (revision !== undefined && integer(revision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER) !== doc.version)
    throw new Error(`Document revision mismatch: expected ${revision}, current ${doc.version}`);
}
export function inspect(doc: Sprite) {
  return { ...snapshot(doc), ...provenance(doc), playing: doc === state.sprite && !state.home && state.playing,
    view: { zoom: state.zoom, pan: { x: state.camX, y: state.camY }, onion: { enabled: state.onion, before: state.prefs.onionBefore, after: state.prefs.onionAfter, opacity: state.prefs.onionOpacity } } };
}

/** Draw and capture provenance synchronously, before asynchronous PNG encoding. */
export function capturePng(doc: Sprite, frame: unknown, scale: unknown, layer?: unknown, applyPixelRatio = true) {
  const f = integer(frame ?? doc.frame, 'frame', 0, doc.frames.length - 1);
  const s = integer(scale ?? 1, 'scale', 1, 16);
  const l = layer === undefined ? undefined : integer(layer, 'layer', 0, doc.layers.length - 1);
  const width = doc.width * (applyPixelRatio ? doc.pixelRatioX : 1) * s, height = doc.height * (applyPixelRatio ? doc.pixelRatioY : 1) * s;
  if (Math.max(width, height) > 4096) throw new Error('Rendered image exceeds 4096 pixels per side');
  doc.flushRender();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(doc.render(f, l), 0, 0, canvas.width, canvas.height);
  return { metadata: { ...provenance(doc), frame: f, layer: l ?? null, scale: s,
    pixelRatioX: doc.pixelRatioX, pixelRatioY: doc.pixelRatioY, logicalWidth: doc.width, logicalHeight: doc.height }, blob: canvas.convertToBlob({ type: 'image/png' }) };
}

export function positionEditor(doc: Sprite, input: Record<string, unknown>) {
  const p = z.parse(z.object(viewOptions), input);
  const frame = integer(p.frame ?? doc.frame, 'frame', 0, doc.frames.length - 1);
  const layer = integer(p.layer ?? doc.layer, 'layer', 0, doc.layers.length - 1);
  state.playing = false;
  if (frame !== doc.frame || layer !== doc.layer) doc.dropFloating();
  doc.frame = frame; doc.layer = layer;
  if (p.frame !== undefined || p.layer !== undefined) doc.range = null;
  if (p.fit) state.fit();
  if (p.zoom !== undefined) state.zoom = state.zoomTarget = p.zoom;
  if (p.center || p.fit) state.panTo(doc.width / 2, doc.height / 2);
  if (p.pan) state.panTo(p.pan.x, p.pan.y);
  // Also cancel an in-flight camera animation when only zoom was supplied.
  if (p.zoom !== undefined) state.panTo(state.camX, state.camY);
  if (p.onion) {
    state.onion = p.onion.enabled;
    state.setPrefs({ ...(p.onion.before !== undefined ? { onionBefore: p.onion.before } : {}),
      ...(p.onion.after !== undefined ? { onionAfter: p.onion.after } : {}), ...(p.onion.opacity !== undefined ? { onionOpacity: p.onion.opacity } : {}) });
  }
  state.save();
  return inspect(doc);
}

export function editSelection(doc: Sprite, p: Record<string, unknown>, clipboard: { value: (Bitmap & { x?: number; y?: number }) | null }) {
  if (p.action === 'copy') {
    const bmp = doc.copySelection(p.merged === true);
    if (!bmp) throw new Error('No pixels to copy');
    const origin = doc.selectionOrigin ?? { x: 0, y: 0 };
    clipboard.value = { ...bmp, ...origin };
    return { ...provenance(doc), width: bmp.w, height: bmp.h };
  }
  if (p.action !== 'paste' && p.action !== 'transform') throw new Error('Expected copy, paste or transform');
  if (!doc.editable) throw new Error('Active layer must be visible, unlocked and editable');
  if (doc.floating) throw new Error('Commit or cancel the floating selection before editing through MCP');
  if (p.action === 'paste' && !clipboard.value) throw new Error('Pixel clipboard is empty');
  const x = p.x === undefined ? undefined : integer(p.x, 'x', -4096, 4096);
  const y = p.y === undefined ? undefined : integer(p.y, 'y', -4096, 4096);
  const turns = integer(p.turns ?? 0, 'turns', -3, 3);
  const algorithm = doc.transformAlgo;
  doc.atomicEdit('MCP selection', () => {
    doc.transformAlgo = 'fast';
    try {
      if (p.action === 'paste') {
        const clip = clipboard.value!;
        doc.paste(clip, { x: x ?? clip.x ?? 0, y: y ?? clip.y ?? 0 });
      } else doc.liftSelection();
      if (p.flipX) doc.transformSelection('Mirror', flipH);
      if (p.flipY) doc.transformSelection('Mirror', flipV);
      if (turns) doc.transformSelection('Turn', bmp => rotate(bmp, turns));
      const f = doc.floating;
      if (f && (x !== undefined || y !== undefined)) doc.moveFloating(
        f.place.x + (x === undefined ? 0 : x - f.result.x),
        f.place.y + (y === undefined ? 0 : y - f.result.y));
      doc.dropFloating();
    } finally { doc.transformAlgo = algorithm; }
  });
  state.save();
  return inspect(doc);
}

export async function compare(input: Record<string, unknown>) {
  const p = z.parse(comparisonOptions, input);
  const resolve = (item: { documentId: string; expectedRevision?: number; frame: number; layer?: number }) => {
    const doc = state.docs.find(d => docId(d) === item.documentId);
    if (!doc) throw new Error('Comparison document ID is not open');
    checkRevision(doc, item.expectedRevision);
    integer(item.frame, 'frame', 0, doc.frames.length - 1);
    if (item.layer !== undefined) integer(item.layer, 'layer', 0, doc.layers.length - 1);
    return { doc, frame: item.frame, layer: item.layer, ...provenance(doc) };
  };
  const items = p.items.map(item => ({ ...resolve(item), reference: item.reference && { ...item.reference, ...resolve(item.reference) } }));
  const cellW = Math.max(...items.map(i => i.doc.width * i.doc.pixelRatioX)), cellH = Math.max(...items.map(i => i.doc.height * i.doc.pixelRatioY));
  const columns = Math.min(p.columns, items.length), rows = Math.ceil(items.length / columns);
  const width = cellW * columns * p.scale, height = cellH * rows * p.scale;
  if (width > 4096 || height > 4096) throw new Error('Contact sheet exceeds 4096 pixels per side');
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
  const checker = Math.max(4, state.prefs.checkerSize);
  for (let y = 0; y < height; y += checker) for (let x = 0; x < width; x += checker) {
    ctx.fillStyle = ((x / checker + y / checker) % 2) ? state.prefs.checkerA : state.prefs.checkerB;
    ctx.fillRect(x, y, checker, checker);
  }
  ctx.imageSmoothingEnabled = false;
  for (const item of items) { item.doc.flushRender(); item.reference?.doc.flushRender(); }
  const metadata = items.map((item, index) => {
    const x = index % columns * cellW * p.scale, y = Math.floor(index / columns) * cellH * p.scale;
    const sx = p.scale * item.doc.pixelRatioX, sy = p.scale * item.doc.pixelRatioY;
    ctx.drawImage(item.doc.render(item.frame, item.layer), x, y, item.doc.width * sx, item.doc.height * sy);
    const ref = item.reference;
    if (ref) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, cellW * p.scale, cellH * p.scale); ctx.clip();
      ctx.globalAlpha = ref.opacity;
      ctx.drawImage(ref.doc.render(ref.frame, ref.layer), x + ref.x * sx, y + ref.y * sy, ref.doc.width * p.scale * ref.doc.pixelRatioX, ref.doc.height * p.scale * ref.doc.pixelRatioY);
      ctx.restore();
    }
    ctx.fillStyle = '#00d9ffff';
    for (const guide of p.guides) {
      if (guide.axis === 'x' && guide.pos < item.doc.width) ctx.fillRect(x + guide.pos * sx, y, 1, cellH * p.scale);
      if (guide.axis === 'y' && guide.pos < item.doc.height) ctx.fillRect(x, y + guide.pos * sy, cellW * p.scale, 1);
    }
    const info = ({ doc: _, reference: _r, ...info }: typeof item) => info;
    return { ...info(item), name: item.doc.name, reference: ref ? { documentId: ref.documentId, revision: ref.revision, frame: ref.frame, layer: ref.layer ?? null, opacity: ref.opacity, x: ref.x, y: ref.y } : null,
      rect: { x, y, w: cellW * p.scale, h: cellH * p.scale } };
  });
  const image = base64(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  const viewer = p.show ? addViewer({ name: p.title === 'Comparison' ? t('mcp.comparison') : p.title, image, items: metadata, width, height }) : null;
  return { image, items: metadata, width, height, scale: p.scale, viewerId: viewer?.id ?? null };
}
