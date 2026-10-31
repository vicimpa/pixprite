import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './desktop-helper';
import { splitDocument } from '../src/core/DocumentResources';
import type { Migration } from '../desktop/migration';

const document = (name: string, color: number[]) => ({
  format: 'pixprite', version: 5, name, width: 1, height: 1,
  frames: [{ duration: 100 }], images: [{ id: 'image', w: 1, h: 1, d: Buffer.from(color).toString('base64') }],
  layers: [{ name: 'Layer', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'image' } }] }],
});

for (const version of [7, 8]) test(`migrates IndexedDB v${version} into portable files and keeps working copies separate`, async () => {
  const f = await nativeFixture();
  const saved = document('Saved sprite', [255, 0, 0, 255]);
  const working = document('Working sprite', [0, 255, 0, 255]);
  const meta = { id: 'saved-project', name: saved.name, created: 1, updated: 1, width: 1, height: 1, frames: 1, layers: 1, colorMode: 'rgb', thumb: '', folderId: 'folder' };
  const bundle = await splitDocument(saved);
  const session = { head: { projectId: meta.id, name: working.name }, data: working, editor: { zoom: 4 } };
  const snapshot = { id: 'snapshot', owner: meta.id, time: 1, name: saved.name, width: 1, height: 1, frames: 1, thumb: '' };
  const store = (name: string, keyPath: string | null, keys: unknown[], values: unknown[], indexes: Migration['databases'][number]['stores'][number]['indexes'] = []) => ({ name, keyPath, keys, values, indexes, autoIncrement: false });
  const dump: Migration = {
    format: 'pixprite-browser-storage', version: 1, id: 'file-library-migration',
    localStorage: { 'pixprite:session': JSON.stringify({ tabs: ['working-session'], active: 'working-session' }) },
    databases: [{ name: 'pixprite', version, stores: [
      ...(version === 8 ? [store('resources', null, [...bundle.payloads.keys()], [...bundle.payloads.values()]), store('previews', null, [], []), store('revisions', null, [], [])] : []),
      store('meta', 'id', [meta.id], [meta]), store('data', null, [meta.id], [version === 8 ? bundle.manifest : saved]),
      store('lastGoodMeta', 'id', [meta.id], [meta]), store('lastGoodData', null, [meta.id], [saved]),
      store('state', null, [meta.id], [{ zoom: 2 }]),
      store('sessions', null, ['head:working-session', 'data:working-session', 'editor:working-session', 'good:working-session'], [session.head, session.data, session.editor, session]),
      store('snapshots', 'id', [snapshot.id], [snapshot], [{ name: 'owner', keyPath: 'owner', unique: false, multiEntry: false }]),
      store('snapshotData', null, [snapshot.id], [saved]),
      store('folders', 'id', ['folder'], [{ id: 'folder', name: 'Sprites', parentId: null, created: 1, updated: 1 }]),
    ] }],
  };
  const root = join(f.profile, 'data');
  try {
    await mkdir(f.profile, { recursive: true });
    await writeFile(join(f.profile, 'electron-migration.json'), JSON.stringify(dump));
    await f.launch();
    expect((await f.call('inspect')).name).toBe(working.name);
    expect([...Buffer.from((await f.call('pixels', { action: 'read', rect: { x: 0, y: 0, w: 1, h: 1 } })).data, 'base64')]).toEqual([0, 255, 0, 255]);
    const files = await readdir(join(root, 'Projects'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/Saved_sprite.*\.pixprite$/);
    const path = join(root, 'Projects', files[0]);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored).toMatchObject(saved);
    expect(stored._pixpriteLibrary.meta).toMatchObject(meta);
    expect((await readdir(join(root, 'Recovery'))).length).toBeGreaterThan(0);
    expect((await readdir(join(root, 'Snapshots'))).length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(root, 'migration-v1.json'), 'utf8'))).toEqual({ version: 1 });
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    // A normal file opener accepts the library file directly, with all pixels intact.
    await f.call('open_file', { path });
    expect((await f.call('inspect')).name).toBe(saved.name);
    expect([...Buffer.from((await f.call('pixels', { action: 'read', rect: { x: 0, y: 0, w: 1, h: 1 } })).data, 'base64')]).toEqual([255, 0, 0, 255]);
    await f.stop();
    await rm(path); // Removing a saved file must never resurrect the old IndexedDB copy.
    await f.launch();
    expect((await f.call('documents')).documents).toHaveLength(2);
    expect(await readdir(join(root, 'Projects'))).toEqual([]);
    // Saving again uses the file library, without touching or re-importing the source database.
    await f.call('command', { id: 'file.save' });
    await expect.poll(async () => (await readdir(join(root, 'Projects'))).length).toBe(1);
  } finally { await f.dispose(); }
});
