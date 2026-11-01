import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture } from './desktop-helper';

test('native file batches open separate images and continue past a damaged file', async () => {
  const f = await nativeFixture();
  try {
    await f.launch();
    await f.call('create', { width: 2, height: 3, name: 'Seed' });
    await f.call('pixels', { action: 'write', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#ff0000' });
    const png = Buffer.from((await f.call('export_data', { format: 'png' })).data, 'base64');
    const first = join(f.directory, 'Frame10.png'), second = join(f.directory, 'Frame2.png');
    const broken = join(f.directory, 'Broken.png'), gif = join(f.directory, 'Animated.gif');
    await Promise.all([
      writeFile(first, png), writeFile(second, png), writeFile(broken, 'broken'),
      writeFile(gif, Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')),
    ]);
    await f.stop();
    // Launch files use the same native queue and bridge as OS file drops.
    await f.launch([first, broken, second, gif]);
    await expect.poll(async () => (await f.call('documents')).documents.map((doc: { name: string }) => doc.name))
      .toEqual(['Seed', 'Frame10', 'Frame2', 'Animated']);
    const { documents } = await f.call('documents');
    for (const name of ['Frame10', 'Frame2']) {
      await f.call('select', { id: documents.find((doc: { name: string }) => doc.name === name).id });
      const doc = await f.call('inspect');
      expect([doc.width, doc.height, doc.frames.length]).toEqual([2, 3, 1]);
      const pixels = await f.call('pixels', { action: 'read', rect: { x: 0, y: 0, w: 1, h: 1 } });
      expect([...Buffer.from(pixels.data, 'base64')]).toEqual([255, 0, 0, 255]);
    }
  } finally { await f.dispose(); }
});
