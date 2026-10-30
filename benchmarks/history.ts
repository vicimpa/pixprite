/** Browser-only regressions; this entry never ships in the production build. */
import '../src/index';
import { state } from '../src/core/State';
import { Sprite, createImage, createCelInstance } from '../src/core/Sprite';
import { tinted } from '../src/core/OnionTint';
import { ExtensionHost } from '../src/core/extensions/Host';
import { spriteHandlers } from '../src/core/extensions/api/sprite';
import type { Call } from '../src/core/extensions/api/common';
import { API_VERSION } from '../packages/api/src';
import type { SpriteContext } from '../src/core/SpriteContext';
import { dialogs } from '../src/modules/Dialogs';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const assert = (ok: unknown, text: string) => { if (!ok) throw new Error(text); };
let weakDoc: WeakRef<Sprite> | undefined, weakSnapshot: WeakRef<object> | undefined;
const host = new ExtensionHost({ id: 'history-check', manifest: { id: 'history-check', name: 'History check', version: '1.0.0', apiVersion: API_VERSION },
  files: {}, enabled: true, source: 'file', installedAt: 0 });
const call = { host } as Call;
const pixels = (doc: Sprite) => doc.canvasPixels().reduce((sum, value) => sum + value, 0);
const api = {
  onionOwnership() {
    const a = new Sprite(1, 1), b = new Sprite(1, 1);
    a.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([0xff000000]) });
    b.setCel({ x: 0, y: 0, w: 1, h: 1, data: new Uint32Array([0xffffffff]) });
    const first = tinted(a, 0, true), second = tinted(b, 0, true);
    const pixel = (canvas: OffscreenCanvas) => Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    assert(a.version === b.version && first !== second && JSON.stringify(pixel(first)) !== JSON.stringify(pixel(second)), 'Onion tint crossed document ownership');
    a.touch(); assert(tinted(a, 0, true) !== first, 'Onion tint retained an obsolete version');
    return true;
  },
  async install(budget: 'bytes' | 'operation') {
    state.setPrefs({ autosave: false, historySteps: 256, historyMB: budget === 'bytes' ? .000001 : 0,
      historyOperationMB: budget === 'operation' ? .000001 : 0 });
    const doc = new Sprite(32, 32); doc.name = 'History budget';
    state.openDocument(doc); state.tool = 'pencil'; state.fit();
    await frame(); await frame();
    return pixels(doc);
  },
  status() { const doc = state.sprite; return { pixels: pixels(doc), guards: doc.historyGuardCount, undo: doc.history.length, redo: doc.future.length, notice: doc.historyLimitNotice }; },
  history() { dialogs.history(); },
  transactionFailure() {
    const doc = state.sprite, before = pixels(doc);
    const tx = spriteHandlers['sprite.transaction.begin']!(call, 'Failed transaction') as number;
    let changed = false;
    try {
      spriteHandlers['sprite.putPixels']!({ ...call, tx }, 0, 0, { rect: { x: 0, y: 0, w: 1, h: 1 }, data: new Uint8ClampedArray([1, 2, 3, 255]), format: 'rgba' });
      changed = pixels(doc) !== before;
      throw new Error('Expected extension failure');
    } catch {
      spriteHandlers['sprite.transaction.end']!(call, tx, false);
    }
    assert(changed, 'Extension transaction did not mutate pixels');
    assert(pixels(doc) === before, 'Failed extension transaction kept its pixels');
    assert(doc.historyGuardCount === 0 && host.transactions.size === 0, 'Failed transaction retained its guard');
    const disposedTx = spriteHandlers['sprite.transaction.begin']!(call, 'Deactivated transaction') as number;
    spriteHandlers['sprite.putPixels']!({ ...call, tx: disposedTx }, 0, 0, { rect: { x: 0, y: 0, w: 1, h: 1 }, data: new Uint8ClampedArray([7, 8, 9, 255]), format: 'rgba' });
    host.dispose();
    assert(pixels(doc) === before && doc.historyGuardCount === 0 && host.transactions.size === 0, 'Extension deactivation retained transaction changes or guard');
    return true;
  },
  async close() {
    state.setPrefs({ historyOperationMB: 0, historyMB: 0 });
    const doc = state.sprite;
    state.clipSource = { sprite: doc, range: { type: 'frames', layers: [0, 0], frames: [0, 0] } };
    doc.addFrame('duplicate'); state.playing = true;
    doc.checkpoint('Retained pixels');
    doc.setCel(createCelInstance(createImage(32, 32, new Uint32Array(1024).fill(0xffffffff))));
    tinted(doc, 0, true);
    weakDoc = new WeakRef(doc);
    weakSnapshot = new WeakRef((doc as unknown as SpriteContext).undoStack[0]);
    spriteHandlers['sprite.transaction.begin']!(call, 'Outstanding transaction');
    doc.projectId = 'history-check'; doc.markSaved();
    const result = await state.closeDocument(doc);
    await state.persist(); await frame(); await frame();
    assert(result && state.home && !state.docs.includes(doc) && state.sprite !== doc && !state.clipSource && !state.playing, 'Closed document is still an active root');
    assert(doc.history.length === 0 && doc.future.length === 0 && !doc.paletteHost && doc.historyGuardCount === 0, 'Closed editor retains history or closures');
    assert(host.transactions.size === 0, 'Extension host retained a closed document');
    return { home: state.home, docs: state.docs.length, cache: (doc as unknown as SpriteContext).cache.size, transactions: host.transactions.size };
  },
  collected() { return { document: !weakDoc?.deref(), snapshot: !weakSnapshot?.deref() }; },
};
Object.assign(window, { historyCheck: api });
