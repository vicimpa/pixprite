import 'fake-indexeddb/auto';
import { afterEach, expect, mock, test } from 'bun:test';
import type { ProjectMeta } from '~/core/Projects';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { deleteProject, deleteSession, getProjectMeta, loadLastGoodProject, loadLastGoodSession, loadProjectData, loadProjectState, loadSession, saveProjectData, saveSessionRecord } = await import('~/core/Projects');

const ids = new Set<string>();
const meta = (id: string, updated = 1): ProjectMeta => {
  ids.add(id);
  return { id, name: id, created: 1, updated, width: 1, height: 1, frames: 1, layers: 1, colorMode: 'rgb', thumb: '' };
};
const document = (name: string) => ({ format: 'pixprite', version: 4, width: 1, height: 1, name, frames: [{ duration: 100 }], layers: [{ name: 'Layer', cels: [null] }] });
afterEach(async () => { for (const id of ids) { await deleteProject(id); await deleteSession(id); } ids.clear(); });
async function rawPut(store: string, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('pixprite'); req.onsuccess = () => resolve(req.result); });
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
}

async function abortWrite(storeName: string, work: () => Promise<unknown>) {
  const put = IDBObjectStore.prototype.put;
  const aborted = new WeakSet<IDBTransaction>();
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    const result = put.apply(this, args);
    if (this.name === storeName && !aborted.has(this.transaction)) {
      aborted.add(this.transaction);
      queueMicrotask(() => this.transaction.abort());
    }
    return result;
  };
  try { await expect(work()).rejects.toBeDefined(); } finally { IDBObjectStore.prototype.put = put; }
}

test('project write abort rolls back document, metadata, editor and previous revision together; retry succeeds', async () => {
  const id = 'reliable-project';
  await saveProjectData(meta(id), document('one'), { zoom: 1 });
  expect((await loadLastGoodProject(id))?.data).toEqual(document('one'));
  await saveProjectData(meta(id, 2), document('two'), { zoom: 2 });
  await abortWrite('data', () => saveProjectData(meta(id, 3), document('three'), { zoom: 3 }));
  expect(await loadProjectData(id)).toEqual(document('two'));
  expect((await getProjectMeta(id))?.updated).toBe(2);
  expect(await loadProjectState(id)).toEqual({ zoom: 2 });
  expect((await loadLastGoodProject(id))?.data).toEqual(document('one'));
  await saveProjectData(meta(id, 3), document('three'), { zoom: 3 });
  expect(await loadProjectData(id)).toEqual(document('three'));
  expect((await loadLastGoodProject(id))?.data).toEqual(document('two'));
});

test('invalid new payload cannot overwrite data and a damaged current payload cannot poison last-good recovery', async () => {
  const id = 'damaged-project';
  await saveProjectData(meta(id), document('one'));
  await saveProjectData(meta(id, 2), document('two'));
  await expect(saveProjectData(meta(id, 3), { format: 'pixprite' })).rejects.toThrow();
  expect(await loadProjectData(id)).toEqual(document('two'));
  await rawPut('data', id, { format: 'damaged' });
  expect((await loadLastGoodProject(id))?.data).toEqual(document('one'));
  await saveProjectData(meta(id, 4), document('four'));
  expect((await loadLastGoodProject(id))?.data).toEqual(document('one'));
});

test('session header, pixels and editor commit atomically and preserve a valid previous working copy', async () => {
  const id = 'reliable-session'; ids.add(id);
  const record = (name: string) => ({ head: { projectId: null, name }, data: document(name), editor: { tool: name } });
  await saveSessionRecord(id, record('one'));
  await saveSessionRecord(id, record('two'));
  await abortWrite('sessions', () => saveSessionRecord(id, record('three')));
  expect(await loadSession(id)).toEqual(record('two'));
  expect(await loadLastGoodSession(id)).toEqual(record('one'));
  await rawPut('sessions', `data:${id}`, { invalid: true });
  await saveSessionRecord(id, record('four'));
  expect(await loadLastGoodSession(id)).toEqual(record('one'));
  await saveSessionRecord(id, { ...record('four'), data: null, editor: { zoom: 2 } }, false);
  expect((await loadSession(id))?.data).toEqual(document('four'));
  expect((await loadSession(id))?.editor).toEqual({ zoom: 2 });
  expect(await loadLastGoodSession(id)).toEqual(record('one'));
});
