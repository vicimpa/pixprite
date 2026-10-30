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

test('concurrent project validation retries against the revision actually replaced, including its recovery metadata', async () => {
  const { compute } = await import('./compute');
  const id = 'concurrent-project';
  await saveProjectData(meta(id), document('one'));
  const original = globalThis.Worker;
  let release!: () => void, entered!: () => void, blocked = false;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  class ValidationWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminate() {}
    postMessage(message: { op: 'inspectDocument'; args: { data: { name?: string } } }) {
      const copy = structuredClone(message);
      void (async () => {
        if (copy.args.data.name === 'one' && !blocked) {
          blocked = true; entered();
          await new Promise<void>(resolve => { release = resolve; });
        }
        try { this.onmessage?.({ data: { type: 'done', result: await compute(copy.op, copy.args, () => {}) } }); }
        catch (error) { this.onmessage?.({ data: { type: 'error', message: (error as Error).message } }); }
      })();
    }
  }
  globalThis.Worker = ValidationWorker as unknown as typeof Worker;
  try {
    const pending = saveProjectData(meta(id, 3), document('three'), { zoom: 3 });
    await waiting;
    await saveProjectData(meta(id, 2), document('two'), { zoom: 2 });
    release();
    await pending;
    expect(await loadProjectData(id)).toEqual(document('three'));
    expect((await loadLastGoodProject(id))?.data).toEqual(document('two'));
    expect((await loadLastGoodProject(id))?.meta.updated).toBe(2);
    expect(await loadProjectState(id)).toEqual({ zoom: 3 });
  } finally { globalThis.Worker = original; release?.(); }
});

test('concurrent session validation retries and retains matching previous header, pixels and editor', async () => {
  const { compute } = await import('./compute');
  const id = 'concurrent-session'; ids.add(id);
  const record = (name: string) => ({ head: { projectId: null, name }, data: document(name), editor: { revision: name } });
  await saveSessionRecord(id, record('one'));
  const original = globalThis.Worker;
  let release!: () => void, entered!: () => void, blocked = false;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  class ValidationWorker {
    onmessage?: (event: { data: unknown }) => void;
    terminate() {}
    postMessage(message: { op: 'inspectDocument'; args: { data: { name?: string } } }) {
      const copy = structuredClone(message);
      void (async () => {
        if (copy.args.data.name === 'one' && !blocked) {
          blocked = true; entered();
          await new Promise<void>(resolve => { release = resolve; });
        }
        try { this.onmessage?.({ data: { type: 'done', result: await compute(copy.op, copy.args, () => {}) } }); }
        catch (error) { this.onmessage?.({ data: { type: 'error', message: (error as Error).message } }); }
      })();
    }
  }
  globalThis.Worker = ValidationWorker as unknown as typeof Worker;
  try {
    const pending = saveSessionRecord(id, record('three'));
    await waiting;
    await saveSessionRecord(id, record('two'));
    release(); await pending;
    expect(await loadSession(id)).toEqual(record('three'));
    expect(await loadLastGoodSession(id)).toEqual(record('two'));
  } finally { globalThis.Worker = original; release?.(); }
});

test('worker runtime failure while checking previous data rejects writes without treating the previous revision as corrupt', async () => {
  const { compute } = await import('./compute');
  const { BackgroundWorkerError } = await import('./BackgroundTask');
  const id = 'worker-error-save';
  const record = (name: string) => ({ head: { projectId: null, name }, data: document(name), editor: { revision: name } });
  await saveProjectData(meta(id), document('one'));
  await saveSessionRecord(id, record('one'));
  const original = globalThis.Worker;
  class FailingValidationWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string; preventDefault(): void }) => void;
    terminate() {}
    postMessage(message: { op: 'inspectDocument'; args: { data: { name?: string } } }) {
      if (message.args.data.name === 'one') {
        queueMicrotask(() => this.onerror?.({ message: 'module runtime failed', preventDefault() {} }));
      } else {
        void compute(message.op, structuredClone(message.args), () => {}).then(result => this.onmessage?.({ data: { type: 'done', result } }));
      }
    }
  }
  globalThis.Worker = FailingValidationWorker as unknown as typeof Worker;
  try {
    await expect(saveProjectData(meta(id, 2), document('two'))).rejects.toBeInstanceOf(BackgroundWorkerError);
    await expect(saveSessionRecord(id, record('two'))).rejects.toBeInstanceOf(BackgroundWorkerError);
  } finally { globalThis.Worker = original; }
  expect(await loadProjectData(id)).toEqual(document('one'));
  expect((await getProjectMeta(id))?.updated).toBe(1);
  expect((await loadLastGoodProject(id))?.data).toEqual(document('one'));
  expect(await loadSession(id)).toEqual(record('one'));
  expect(await loadLastGoodSession(id)).toEqual(record('one'));
});

test('deletion during incoming or previous worker validation wins over pending project/session writes and snapshots', async () => {
  const { compute } = await import('./compute');
  const { DeletedDocumentError, listSnapshots, saveSnapshot } = await import('./Projects');
  for (const kind of ['project', 'session'] as const) for (const phase of ['incoming', 'previous'] as const) {
    const id = `delete-${kind}-${phase}`;
    ids.add(id);
    const record = (name: string) => ({ head: { projectId: null, name }, data: document(name), editor: { revision: name } });
    if (kind === 'project') await saveProjectData(meta(id), document('one'), { revision: 'one' });
    else await saveSessionRecord(id, record('one'));
    const original = globalThis.Worker;
    let release!: () => void, entered!: () => void, blocked = false;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    class DelayedValidationWorker {
      onmessage?: (event: { data: unknown }) => void;
      terminate() {}
      postMessage(message: { op: 'inspectDocument'; args: { data: { name?: string } } }) {
        const copy = structuredClone(message);
        void (async () => {
          if (copy.args.data.name === (phase === 'previous' ? 'one' : 'two') && !blocked) {
            blocked = true; entered();
            await new Promise<void>(resolve => { release = resolve; });
          }
          try { this.onmessage?.({ data: { type: 'done', result: await compute(copy.op, copy.args, () => {}) } }); }
          catch (error) { this.onmessage?.({ data: { type: 'error', message: (error as Error).message } }); }
        })();
      }
    }
    globalThis.Worker = DelayedValidationWorker as unknown as typeof Worker;
    try {
      const pending = kind === 'project' ? saveProjectData(meta(id, 2), document('two')) : saveSessionRecord(id, record('two'));
      await waiting;
      if (kind === 'project') await deleteProject(id);
      else await deleteSession(id);
      release();
      await expect(pending).rejects.toBeInstanceOf(DeletedDocumentError);
    } finally { globalThis.Worker = original; release?.(); }
    if (kind === 'project') {
      expect(await getProjectMeta(id)).toBeNull(); expect(await loadProjectData(id)).toBeNull();
      expect(await loadProjectState(id)).toBeNull(); expect(await loadLastGoodProject(id)).toBeNull();
    } else {
      expect(await loadSession(id)).toBeNull(); expect(await loadLastGoodSession(id)).toBeNull();
      await expect(saveSessionRecord(id, { ...record('two'), data: null }, false)).rejects.toBeInstanceOf(DeletedDocumentError);
      expect(await loadSession(id)).toBeNull();
    }
    await expect(saveSnapshot({ owner: id, name: id, width: 1, height: 1, frames: 1, thumb: '' }, document('snapshot'))).rejects.toBeInstanceOf(DeletedDocumentError);
    expect(await listSnapshots(id)).toEqual([]);
  }
});
