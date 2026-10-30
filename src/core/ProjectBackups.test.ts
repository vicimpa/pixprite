import 'fake-indexeddb/auto';
import { afterEach, expect, mock, test } from 'bun:test';
import type { ProjectMeta } from '~/core/Projects';
import { serializedBytes } from '~/core/Storage';

mock.module('@vicimpa/decorators', () => ({ prop: () => {}, reactive: () => <T,>(value: T) => value }));
const { allProjectsBackup, projectBackup } = await import('~/core/Backups');
const { cleanOldSnapshots, deleteProject, listProjects, listSnapshots, loadSnapshot, saveProjectData, saveSnapshot } = await import('~/core/Projects');

const ids = new Set<string>();
const meta = (id: string, name = id): ProjectMeta => {
  ids.add(id);
  return { id, name, created: 1, updated: 2, width: 1, height: 1, frames: 1, layers: 1, colorMode: 'rgb', thumb: '' };
};
const data = { format: 'pixprite', version: 4, name: 'ёж', width: 1, height: 1, frames: [{ duration: 100 }], layers: [{ name: 'Layer', cels: [{ x: 0, y: 0, w: 1, h: 1, d: 'AQIDBA==' }] }] };
afterEach(async () => { for (const id of ids) await deleteProject(id); ids.clear(); });

async function rawDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixprite');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

test('new and legacy project/snapshot payload sizes remain accurate without rewriting legacy data', async () => {
  await saveProjectData(meta('size'), data);
  const db = await rawDatabase();
  const tx = db.transaction(['meta', 'data', 'snapshots', 'snapshotData'], 'readwrite');
  tx.objectStore('meta').put(meta('legacy'));
  tx.objectStore('data').put(data, 'legacy');
  tx.objectStore('snapshots').put({ id: 'legacy-snapshot', owner: 'legacy', time: 1 });
  tx.objectStore('snapshotData').put(data, 'legacy-snapshot');
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  expect((await listProjects()).filter(p => ids.has(p.id)).map(p => p.bytes)).toEqual([serializedBytes(data), serializedBytes(data)]);
  expect((await listSnapshots('legacy'))[0].bytes).toBe(serializedBytes(data));
  const stored = await new Promise<Record<string, unknown>>(resolve => {
    const request = db.transaction('meta').objectStore('meta').get('legacy'); request.onsuccess = () => resolve(request.result);
  });
  expect(stored.bytes).toBeUndefined();
  expect(await loadSnapshot('legacy-snapshot')).toEqual(data);
  db.close();
});

test('cleanup retains the newest recovery copy of every owner including unsaved work', async () => {
  for (const owner of ['cleanup-one', 'cleanup-unsaved']) {
    ids.add(owner);
    for (let i = 0; i < 3; i++)
      await saveSnapshot({ owner, name: owner, width: 1, height: 1, frames: 1, thumb: '' }, { ...data, revision: i });
  }
  const snapshots = await listSnapshots();
  const newest = [...ids].map(owner => snapshots.find(s => s.owner === owner)!);
  expect(snapshots.filter(s => ids.has(s.owner))).toHaveLength(6);
  await expect(cleanOldSnapshots(0)).rejects.toThrow('at least one');
  expect(await cleanOldSnapshots()).toBe(4);
  for (const snapshot of newest) {
    expect(await listSnapshots(snapshot.owner)).toHaveLength(1);
    expect(await loadSnapshot(snapshot.id)).toMatchObject({ revision: 2 });
  }
});

/** Read stored ZIP local entries independently of the archive writer. */
async function unpack(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const files = new Map<string, string>();
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true);
    const start = offset + 30 + length + view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length));
    files.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  return files;
}

test('single and full backups preserve saved payloads and avoid paths from project names', async () => {
  await saveProjectData(meta('backup-one', '../../same'), data);
  await saveProjectData(meta('backup-two', '../../same'), { ...data, name: 'second' });
  const single = await projectBackup('backup-one');
  expect(single.name).not.toContain('/');
  expect(JSON.parse(await single.blob.text())).toEqual(data);
  const files = await unpack((await allProjectsBackup()).blob);
  const manifest = JSON.parse(files.get('manifest.json')!);
  expect(manifest.format).toBe('pixprite-backup');
  expect(manifest.projects).toHaveLength(2);
  const paths = manifest.projects.map((p: { file: string }) => p.file);
  expect(new Set(paths).size).toBe(2);
  expect(paths.every((p: string) => p.startsWith('projects/') && p.split('/').length === 2)).toBe(true);
  expect(JSON.parse(files.get(manifest.projects.find((p: ProjectMeta) => p.id === 'backup-one').file)!)).toEqual(data);
  await expect(projectBackup('missing')).rejects.toThrow('missing');
});
