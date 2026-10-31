import { expect, test } from '@playwright/test';
import { nativeFixture } from './desktop-helper';

test('one compact window persists documents, reopens files and rejects overwrites', async () => {
  // Three cold WebKitGTK launches under Xvfb can exceed the default 90 seconds.
  // Each launch still has the fixture's 45-second readiness deadline.
  test.setTimeout(180_000);
  const f = await nativeFixture();
  try {
    await f.launch();
    const created = await f.call('create', { width: 8, height: 8, name: 'Persistent session' });
    const docs = (await f.call('documents')).documents;
    expect(docs).toHaveLength(1);
    await f.call('pixels', { action: 'write', rect: { x: 1, y: 2, w: 1, h: 1 }, fill: '#ff008080' });
    await f.stop(); await f.launch();
    expect((await f.call('documents')).documents).toHaveLength(1);
    expect((await f.call('inspect')).name).toBe(created.name);
    expect([...Buffer.from((await f.call('pixels', { action: 'read', rect: { x: 1, y: 2, w: 1, h: 1 } })).data, 'base64')]).toEqual([255, 0, 128, 128]);
    const path = `${f.directory}/saved.pixprite`;
    await f.call('save_file', { path });
    await expect(f.call('save_file', { path })).rejects.toThrow();
    await f.call('save_file', { path, overwrite: true });
    await f.stop(); await f.launch([path]);
    await expect.poll(async () => (await f.call('documents')).documents.length).toBe(2);
    expect(await f.call('desktop_info')).toMatchObject({ windows: 1, menu: false });
  } finally { await f.dispose(); }
});

test('native resize defers settings writes until the interaction settles', async () => {
  const { readFile } = await import('node:fs/promises');
  const f = await nativeFixture();
  try {
    await f.launch(); await new Promise(resolve => setTimeout(resolve, 400));
    const path = `${f.profile}/window.json`, before = await readFile(path, 'utf8');
    for (let i = 0; i < 12; i++) await f.call('window_action', { action: 'resize', width: 1100 + i, height: 800 });
    expect(await readFile(path, 'utf8')).toBe(before);
    await expect.poll(async () => JSON.parse(await readFile(path, 'utf8')).bounds?.width).toBe(1111);
  } finally { await f.dispose(); }
});
