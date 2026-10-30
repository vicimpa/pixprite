/** Optimized browser-only fixtures. This entry is never included in the production build. */
import '../src/index';
import { state } from '../src/core/State';
import { Sprite } from '../src/core/Sprite';
import { fixture } from './fixtures';
import { dialogs } from '../src/modules/Dialogs';
import { extensionsHost, setExtensionsHost } from '../src/modules/Extensions/bridge';
import { openProblems } from '../src/modules/Problems/Problems';
import { openSnapshots } from '../src/modules/Home/Snapshots';
import { listProjects } from '../src/core/Projects';
import { signal } from '@preact/signals-react';

const api = {
  timeline() {
    state.setPrefs({ autosave: false, historySteps: 10000, historyMB: 0 });
    const { doc } = fixture({ id: 'Virtual timeline', width: 16, height: 16, frames: 1000, layers: 100, linked: true });
    state.openDocument(doc); state.fit();
    state.palette = Array.from({ length: 10000 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
  },
  select(layer: number, frame: number) { state.sprite.layer = layer; state.sprite.frame = frame; },
  fold(collapsed: boolean) {
    const doc = state.sprite;
    doc.layers[99].group = true; doc.layers[99].collapsed = collapsed;
    doc.layers[99].cels = Array.from({ length: 1000 }, () => null);
    for (let i = 90; i < 99; i++) doc.layers[i].depth = 1;
    doc.layer = 99; doc.frame = 0; doc.touch();
  },
  frames() { return state.sprite.frames.slice(400, 405).map(f => f.duration); },
  tilePixel(i: number) { return state.sprite.tileset!.tiles[i][0]; },
  selection() { return { layer: state.sprite.layer, frame: state.sprite.frame, palette: state.paletteSelection, tile: state.tileA }; },
  size() { state.setPrefs({ uiSize: 'large', uiFont: 'tiny5' }); },
  history() {
    const doc = new Sprite(1, 1); state.openDocument(doc);
    for (let i = 0; i < 1000; i++) doc.updateLayer(0, { name: `Step ${i}` }, `Rename ${i}`);
    dialogs.history();
  },
  step() { return state.sprite.history.length; },
  tiles() {
    const { doc } = fixture({ id: 'Virtual tiles', width: 16, height: 16, frames: 1, layers: 1, linked: false, tiles: 10000 });
    state.openDocument(doc); state.fit();
  },
  problems() {
    const host = extensionsHost.value!;
    const problems = signal([{ ext: 'fixture', validator: 'large', problems: Array.from({ length: 10000 }, (_, i) => ({
      severity: 'warning', message: `Problem ${i}: ${'wrapped validator message '.repeat(i % 4 + 1)}`, at: { frame: i % state.sprite.frames.length },
    })) }]);
    setExtensionsHost(new Proxy(host, { get(target, key) {
      if (key === 'problems') return problems;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } }));
    openProblems();
  },
  async home() {
    await listProjects();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('pixprite', 8);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['meta', 'folders', 'snapshots', 'snapshotData'], 'readwrite');
        const data = new Sprite(1, 1).captureDocument();
        for (let i = 0; i < 1000; i++) {
          tx.objectStore('meta').put({ id: `p${i}`, name: `Project ${String(i).padStart(4, '0')}`, width: 1, height: 1, frames: 1, layers: 1, colorMode: 'rgba', created: i, updated: i, thumb: '', bytes: 100 });
          tx.objectStore('folders').put({ id: `f${i}`, name: `Folder ${String(i).padStart(4, '0')}`, parentId: null, created: i, updated: i });
          tx.objectStore('snapshots').put({ id: `s${i}`, owner: 'fixture', name: `Snapshot ${i}`, width: 1, height: 1, frames: 1, time: i, thumb: '', bytes: 100 });
          tx.objectStore('snapshotData').put(data, `s${i}`);
        }
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    state.home = true; state.projectsVersion++;
  },
  snapshots() { openSnapshots('fixture', 'Fixture'); },
};
Object.assign(window, { virtualization: api });
