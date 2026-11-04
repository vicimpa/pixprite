import { batch } from '@preact/signals-react';
import { state, bindDocumentPalette, documentPalette, documentPaletteMap } from '../State';
import type { Sprite } from '../Sprite';
import type { Bitmap } from '../Image';
import type { Mask } from '../Mask';
import { docId } from '../extensions/api/sprite';
import { checkRevision, inspect, positionEditor } from './document';
import { highlights } from '../extensions/api/ui';
import { reportActivity } from './activity';
import { activeViewer } from '../ViewerTabs';
import { hasDialogs } from '~/ui/Dialog';
import { PlaybackCursor, playbackRange } from '../PlaybackCursor';

type Cursor = { frame: number; layer: number; mask: Mask | null; view: Record<string, unknown>; playing?: boolean; clock?: PlaybackCursor; tick?: number; elapsed?: number };
export class AgentSession {
  documentId?: string;
  readonly revisions = new Map<string, number>();
  readonly historyPositions = new Map<string, number>();
  readonly cursors = new WeakMap<Sprite, Cursor>();
  readonly clipboard: { value: (Bitmap & { x?: number; y?: number }) | null } = { value: null };
  constructor(readonly source: string) {}
  cursor(doc: Sprite) {
    let cursor = this.cursors.get(doc);
    if (!cursor) {
      cursor = { frame: doc.frame, layer: doc.layer, mask: doc.mask, view: {} };
      this.cursors.set(doc, cursor);
    }
    cursor.frame = Math.min(cursor.frame, doc.frames.length - 1);
    cursor.layer = Math.min(cursor.layer, doc.layers.length - 1);
    if (cursor.playing && cursor.clock && cursor.tick !== undefined) {
      const now = performance.now();
      cursor.elapsed = (cursor.elapsed ?? 0) + now - cursor.tick; cursor.tick = now;
      let limit = 4096;
      while (cursor.elapsed >= doc.frames[cursor.frame].duration && limit--) {
        cursor.elapsed -= doc.frames[cursor.frame].duration;
        const next = cursor.clock.next();
        if (next === null) { cursor.playing = false; break; }
        cursor.frame = Math.min(next, doc.frames.length - 1);
      }
    }
    return cursor;
  }
  playback(doc: Sprite, action: unknown) {
    const cursor = this.cursor(doc);
    if (action === 'play' && !cursor.playing) {
      cursor.clock = new PlaybackCursor(playbackRange(doc, 'tag', cursor.frame), cursor.frame);
      cursor.tick = performance.now(); cursor.elapsed = 0;
    }
    cursor.playing = action === 'play';
    if (action === 'stop') cursor.frame = 0;
  }
  resolve(params: Record<string, unknown>, write = false, history = false) {
    const id = params.documentId ?? this.documentId;
    const doc = id === undefined ? (!state.home && !activeViewer.peek() ? state.sprite : undefined) : state.docs.find(doc => docId(doc) === id);
    if (!doc || !state.docs.includes(doc)) throw new Error('Target document is not open; specify documentId');
    this.documentId = docId(doc);
    bindDocumentPalette(doc);
    const expected = params.expectedRevision ?? (write ? this.revisions.get(this.documentId) : undefined);
    checkRevision(doc, expected);
    if (history && this.historyPositions.has(this.documentId) && this.historyPositions.get(this.documentId) !== doc.historyPosition)
      throw new Error('Document history changed; inspect the target before retrying');
    if (write && (doc.floating || doc.focusLayer !== null || doc.historyGuardCount)) throw new Error('Document has an unfinished user edit; retry after it is committed');
    this.cursor(doc);
    return doc;
  }
  /** No user event or React render can observe the temporary agent cursor. */
  scoped<T>(doc: Sprite, run: () => T): T {
    return batch(() => {
      const cursor = this.cursor(doc), before = { ...cursor };
      const saved = { frame: doc.frame, frameObject: doc.frames[doc.frame], layer: doc.layer, layerObject: doc.layers[doc.layer], mask: doc.mask, range: doc.range };
      let succeeded = false;
      doc.frame = cursor.frame; doc.layer = cursor.layer; doc.mask = cursor.mask; doc.range = null;
      doc.palette = documentPaletteMap(doc, cursor.frame);
      try { const result = run(); succeeded = true; return result; }
      finally {
        if (succeeded) { cursor.frame = doc.frame; cursor.layer = doc.layer; cursor.mask = doc.mask; }
        else Object.assign(cursor, before);
        const frame = doc.frames.indexOf(saved.frameObject), layer = doc.layers.indexOf(saved.layerObject);
        doc.frame = frame < 0 ? Math.min(saved.frame, doc.frames.length - 1) : frame;
        doc.layer = layer < 0 ? Math.min(saved.layer, doc.layers.length - 1) : layer;
        doc.mask = saved.mask && (saved.mask.w !== doc.width || saved.mask.h !== doc.height ? saved.mask.reframe(doc.width, doc.height, 0, 0) : saved.mask);
        doc.range = saved.range && { ...saved.range, frames: saved.range.frames.map(f => Math.min(f, doc.frames.length - 1)) as [number, number], layers: saved.range.layers.map(l => Math.min(l, doc.layers.length - 1)) as [number, number] };
        doc.palette = documentPaletteMap(doc, doc.frame);
        if (doc === state.sprite && doc.framePaletteAt()) {
          const colors = documentPalette(doc);
          if (colors.join() !== state.palette.join()) doc.paletteHost!.set(colors);
        }
      }
    });
  }
  describe(doc: Sprite) {
    const cursor = this.cursor(doc);
    return { ...inspect(doc), importWarnings: doc.asepriteWarnings, palette: documentPalette(doc, cursor.frame), framePalettes: doc.framePalettes.map(key => ({ frame: key.frame, colors: key.colors.slice() })), guides: doc.guides.map(guide => ({ ...guide })), frame: cursor.frame, layer: cursor.layer, view: cursor.view, playing: !!cursor.playing };
  }
  observe(doc: Sprite, revision = doc.version) { this.revisions.set(docId(doc), revision); this.historyPositions.set(docId(doc), doc.historyPosition); }
  report(doc: Sprite, label: string, params: Record<string, unknown>, rect?: { x: number; y: number; w: number; h: number }) {
    reportActivity(this.source, docId(doc), label, params.follow === false ? undefined : () => {
      if (!state.docs.includes(doc) || doc.floating || doc.focusLayer !== null || doc.historyGuardCount || hasDialogs() || state.commandPalette) return;
      const cursor = this.cursor(doc);
      state.switchTo(doc);
      positionEditor(doc, { ...cursor.view, frame: cursor.frame, layer: cursor.layer });
      state.playing = !!cursor.playing;
      if (rect) {
        state.flyTo(state.zoomTarget, rect.x + rect.w / 2, rect.y + rect.h / 2);
        highlights.value = [{ rect, until: performance.now() + 1200 }];
      }
    });
  }
}
