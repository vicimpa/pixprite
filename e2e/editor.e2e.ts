import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

declare global {
  interface Window { sessionWrites: number; restoreStorage?: () => void; }
}

type DocumentData = {
  name: string; width: number; height: number;
  frames: { duration: number }[];
  layers: { name: string; cels: unknown[] }[];
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:extensionRegistry', '/__e2e__/registry.json');
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] }));
    const monitor = window;
    monitor.sessionWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      if (this.name === 'sessions' && String(args[1]).startsWith('data:'))
        this.transaction.addEventListener('complete', () => monitor.sessionWrites++);
      return request;
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
});

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toBeHidden();
}

async function create(page: Page, name: string) {
  await command(page, 'file.new');
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('spinbutton').nth(0).fill('32');
  await dialog.getByRole('spinbutton').nth(1).fill('32');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

async function draw(page: Page, offset = 0) {
  await page.keyboard.press('b');
  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Missing drawing surface');
  await page.mouse.move(box.x + box.width / 2 + offset, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + offset + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  // Match the completed live frame, not an intermediate autosave or an extra pointer-up write.
  const title = await page.locator('[draggable=true][data-active=true]').getAttribute('title');
  const name = title!.replace(/ · \d+×\d+$/, '');
  const frame = Number(await page.locator('[data-hit=frame][data-current=true]').getAttribute('data-f'));
  const expected = await pngPixels(page, await download(page, 'file.exportPng'));
  await expect.poll(async () => {
    const document = await documentNamed(page, name);
    if (!document) return null;
    return documentPixels(page, document, frame);
  }).toEqual(expected);
}

/** Decode/composite plain drawing fixtures independently of the editor and stored manifest loader. */
async function documentPixels(page: Page, document: DocumentData, frame = 0) {
  return page.evaluate(({ document, frame }: { document: any; frame: number }) => {
    const canvas = new OffscreenCanvas(document.width, document.height), ctx = canvas.getContext('2d')!;
    for (const layer of document.layers) {
      if (layer.visible === false) continue;
      let cel = layer.cels[frame];
      while (cel && 'link' in cel) cel = layer.cels[cel.link];
      if (!cel) continue;
      if (cel.flipX || cel.flipY || cel.rotation || cel.opacity !== undefined || layer.effects?.length || layer.group || layer.clip)
        throw new Error('Draw helper requires plain layer fixtures');
      const image = document.images.find((image: { id: string }) => image.id === cel.image.id);
      const bytes = Uint8ClampedArray.from(atob(image.d), value => value.charCodeAt(0));
      const source = new OffscreenCanvas(image.w, image.h);
      source.getContext('2d')!.putImageData(new ImageData(bytes, image.w, image.h), 0, 0);
      ctx.globalAlpha = (layer.opacity ?? 1) * (layer.celOpacity?.[frame] ?? 1);
      ctx.drawImage(source, cel.x, cel.y);
    }
    return { width: canvas.width, height: canvas.height, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, { document, frame });
}

async function documentNamed(page: Page, name: string): Promise<DocumentData | null> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pixprite');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      const tx = db.transaction(['sessions', 'resources']);
      const request = <T,>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const [sessions, keys, payloads] = await Promise.all([
        request(tx.objectStore('sessions').getAll()), request(tx.objectStore('resources').getAllKeys()), request(tx.objectStore('resources').getAll()),
      ]);
      const value = sessions.find(v => (v?.document ?? v)?.format === 'pixprite' && (v.document ?? v).name === name);
      if (!value) return null;
      if (!value.storage) return value;
      // Resolve internal pointers independently; pixel assertions below still decode/composite the file themselves.
      const resources = new Map(keys.map((key, i) => [key, payloads[i].payload]));
      const document = structuredClone(value.document);
      const hydrate = (owner: any, field: string) => {
        const ref = owner[field]?.$resource;
        if (ref !== undefined) {
          if (!resources.has(ref)) throw new Error(`Missing test resource ${ref}`);
          owner[field] = resources.get(ref);
        }
      };
      for (const image of document.images ?? []) hydrate(image, 'd');
      for (const tileset of document.tilesets ?? []) hydrate(tileset, 'd');
      for (const layer of document.layers) for (const cel of layer.cels) if (cel && !('link' in cel)) { hydrate(cel, 'd'); hydrate(cel, 't'); }
      return document;
    } finally { db.close(); }
  }, name);
}

async function assertPainted(page: Page, name: string) {
  await expect.poll(async () => {
    const document = await documentNamed(page, name);
    return document?.layers.some(l => l.cels.some(Boolean));
  }).toBe(true);
}

async function download(page: Page, id: string) {
  const pending = page.waitForEvent('download');
  await command(page, id);
  return pending;
}

async function pngPixels(page: Page, file: Download) {
  const path = await file.path();
  if (!path) throw new Error('Download has no local path');
  return page.evaluate(async encoded => {
    const raw = Uint8Array.from(atob(encoded), v => v.charCodeAt(0));
    const image = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = Array.from(ctx.getImageData(0, 0, image.width, image.height).data);
    image.close();
    return { width: canvas.width, height: canvas.height, data };
  }, (await readFile(path)).toString('base64'));
}

test('@smoke create, draw, undo/redo, add layer/frame, save and restore after reload', async ({ page }) => {
  await create(page, 'Workflow');
  await draw(page);
  await assertPainted(page, 'Workflow');
  const painted = await documentNamed(page, 'Workflow');
  expect([painted?.width, painted?.height]).toEqual([32, 32]);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await documentNamed(page, 'Workflow'))?.layers[0].cels[0]).toBeNull();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => documentNamed(page, 'Workflow')).toEqual(painted);

  await command(page, 'layer.new');
  await command(page, 'anim.newFrame');
  await expect(page.locator('[data-hit="layer"]')).toHaveCount(2);
  await expect(page.locator('[data-hit="frame"]')).toHaveCount(2);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Workflow', { exact: true })).toBeVisible();
  const saved = await documentNamed(page, 'Workflow');
  expect(saved?.layers).toHaveLength(2);
  expect(saved?.frames).toHaveLength(2);

  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-hit="layer"]')).toHaveCount(2);
  await expect(page.locator('[data-hit="frame"]')).toHaveCount(2);
  await expect.poll(() => documentNamed(page, 'Workflow')).toEqual(saved);
  await page.locator('[data-home]').click();
  await expect(page.locator('[data-key^="p:"]', { hasText: 'Workflow' })).toBeVisible();
});

test('@smoke PNG download → file picker import → identical pixel export', async ({ page }) => {
  await create(page, 'Pixels');
  await draw(page);
  await assertPainted(page, 'Pixels');
  const original = await download(page, 'file.exportPng');
  expect(original.suggestedFilename()).toBe('Pixels.png');
  const before = await pngPixels(page, original);
  expect([before.width, before.height]).toEqual([32, 32]);
  expect(before.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  const picker = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await picker).setFiles({ name: 'Pixels.png', mimeType: 'image/png', buffer: await readFile((await original.path())!) });
  await expect(page.locator('[draggable=true][title="Pixels · 32×32"]')).toHaveCount(2);
  const reexported = await download(page, 'file.exportPng');
  expect(await pngPixels(page, reexported)).toEqual(before);
});

test('multiple document tabs and active tab survive page reload', async ({ page }) => {
  await create(page, 'First');
  await draw(page);
  await assertPainted(page, 'First');
  await create(page, 'Second');
  await draw(page);
  await assertPainted(page, 'Second');
  await page.locator('[draggable=true][title="First · 32×32"]').click();
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('pixprite:session') ?? '{}');
    return session.active === session.tabs?.[0];
  })).toBe(true);
  await page.reload();
  await expect(page.locator('[draggable=true]')).toHaveCount(2);
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'First · 32×32');
  await assertPainted(page, 'First');
  await page.locator('[draggable=true][title="Second · 32×32"]').click();
  await assertPainted(page, 'Second');
});

test('crashed renderer restores unsaved work and offers a recoverable snapshot', async ({ page, context }) => {
  const start = Date.now();
  await page.clock.setFixedTime(start);
  await create(page, 'Crash');
  await draw(page);
  await assertPainted(page, 'Crash');
  const pixels = await pngPixels(page, await download(page, 'file.exportPng'));
  // Advance Date only: the normal snapshot interval elapses while browser timers stay real.
  await page.clock.setFixedTime(start + 120_001);
  await command(page, 'layer.new');
  await expect.poll(async () => (await documentNamed(page, 'Crash'))?.layers.length).toBe(2);
  // Snapshots are asynchronous; wait for the real browser transaction before crashing.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      return await new Promise<number>(resolve => { const r = db.transaction('snapshots').objectStore('snapshots').count(); r.onsuccess = () => resolve(r.result); });
    } finally { db.close(); }
  })).toBeGreaterThan(1);
  const data = await documentNamed(page, 'Crash');
  const cdp = await context.newCDPSession(page);
  const crashed = page.waitForEvent('crash');
  void cdp.send('Page.crash').catch(() => {});
  await crashed;
  await page.close();
  const recovered = await context.newPage();
  await recovered.goto('/');
  await expect(recovered.getByRole('dialog', { name: 'Recovery', exact: true })).toBeVisible();
  await recovered.getByRole('button', { name: 'Show snapshots', exact: true }).click();
  await expect.poll(() => documentNamed(recovered, 'Crash')).toEqual(data);
  await recovered.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect(recovered.getByTestId('sprite-canvas')).toBeVisible();
  await expect(recovered.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', /Crash/);
  expect(await pngPixels(recovered, await download(recovered, 'file.exportPng'))).toEqual(pixels);
});

test('offline reload preserves unsaved work', async ({ page, context }) => {
  await create(page, 'Offline');
  await draw(page);
  await assertPainted(page, 'Offline');
  const before = await documentNamed(page, 'Offline');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first installed worker controls subsequent navigations; its full snapshot is already cached.
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect.poll(() => documentNamed(page, 'Offline')).toEqual(before);
  await draw(page, 80);
  await context.setOffline(false);
  await assertPainted(page, 'Offline');
  await expect.poll(() => documentNamed(page, 'Offline')).not.toEqual(before);
});

test('install extension from registry, block forbidden API, uninstall and remove its command', async ({ page }) => {
  await create(page, 'Permissions');
  await command(page, 'extensions.openStore');
  await expect(page.getByText('E2E permissions', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(page.locator('[data-status=active]')).toHaveText('Running');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'e2e-permissions:probe');
  await expect(page.getByText('Denied API: permission: Permission "sprite:read" is not granted', { exact: true })).toBeVisible();
  await command(page, 'extensions.openInstalled');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('No extensions installed. Open the Store tab to add some.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+k');
  const query = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(query).toBeFocused();
  await expect(query).toHaveValue('');
  await query.fill('e2e-permissions:probe');
  await expect(page.getByText('Nothing found', { exact: true })).toBeVisible();
});

test('export GIF animation and reimport both frames with pixels and timing', async ({ page }) => {
  await create(page, 'Animation');
  await draw(page);
  await command(page, 'anim.newEmptyFrame');
  await draw(page, 80);
  await expect.poll(async () => (await documentNamed(page, 'Animation'))?.frames.length).toBe(2);
  const before = await documentNamed(page, 'Animation');
  await command(page, 'anim.first');
  const first = await pngPixels(page, await download(page, 'file.exportPng'));
  await command(page, 'anim.last');
  const last = await pngPixels(page, await download(page, 'file.exportPng'));
  for (const frame of [first, last]) expect(frame.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  expect(last).not.toEqual(first);
  await command(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog.getByRole('button', { name: 'GIF animation', exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const animation = await pending;
  const buffer = await readFile((await animation.path())!);
  expect(buffer.subarray(0, 6).toString()).toBe('GIF89a');
  const picker = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await picker).setFiles({ name: 'Imported.gif', mimeType: 'image/gif', buffer });
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Imported · 32×32');
  await expect.poll(async () => (await documentNamed(page, 'Imported'))?.frames).toEqual(before?.frames);
  await assertPainted(page, 'Imported');
  await expect(page.locator('[data-hit="frame"]')).toHaveCount(2);
  await command(page, 'anim.first');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(first);
  await command(page, 'anim.last');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(last);
});

test('IndexedDB quota failure is visible and keeps the last saved project intact', async ({ page }) => {
  await create(page, 'Quota');
  await draw(page);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Quota', { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<unknown[]>(resolve => { const r = db.transaction('data').objectStore('data').getAll(); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  });
  await command(page, 'layer.new');
  // Browser fault injection at the write boundary; the editor's save/error path is real.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const result = put.apply(this, args);
      if (this.name === 'data') {
        const tx = this.transaction;
        Object.defineProperty(tx, 'error', { value: new DOMException('Storage is full', 'QuotaExceededError') });
        queueMicrotask(() => tx.abort());
      }
      return result;
    };
  });
  await command(page, 'file.save');
  await expect(page.getByText(/Could not save/)).toBeVisible();
  await expect(page.locator('[draggable=true] [data-modified=true]')).toHaveCount(1);
  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<unknown[]>(resolve => { const r = db.transaction('data').objectStore('data').getAll(); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  });
  expect(after).toEqual(saved);
});

test('failed autosave reports quota exhaustion and retries the pending document', async ({ page }) => {
  await create(page, 'Autosave');
  await draw(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.restoreStorage = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const result = put.apply(this, args);
      if (this.name === 'sessions' && String(args[1]).startsWith('data:')) {
        const tx = this.transaction;
        Object.defineProperty(tx, 'error', { value: new DOMException('Storage is full', 'QuotaExceededError') });
        queueMicrotask(() => tx.abort());
      }
      return result;
    };
  });
  await command(page, 'layer.new');
  await expect(page.getByText(/Could not save.*Storage is full/)).toBeVisible();
  expect((await documentNamed(page, 'Autosave'))?.layers).toHaveLength(1);
  await expect(page.locator('[draggable=true] [data-modified=true]')).toHaveCount(1);
  await page.evaluate(() => window.restoreStorage!());
  // Home triggers the normal session flush with exactly the same document version.
  await page.locator('[data-home]').click();
  await expect.poll(async () => (await documentNamed(page, 'Autosave'))?.layers.length).toBe(2);
  await page.reload();
  await page.locator('[draggable=true][title="Autosave · 32×32"]').click();
  await expect(page.locator('[data-hit=layer]')).toHaveCount(2);
});

test('storage controls show usage, request persistence, export backups and preserve the newest snapshot', async ({ page }) => {
  await create(page, 'Backup');
  await draw(page);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Backup', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false, configurable: true });
    Object.defineProperty(navigator.storage, 'persist', { value: async () => true, configurable: true });
    Object.defineProperty(navigator.storage, 'estimate', { value: async () => ({ usage: 90, quota: 100 }), configurable: true });
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['snapshots', 'snapshotData', 'data'], 'readwrite');
    const r = tx.objectStore('data').getAll();
    r.onsuccess = () => {
      for (let i = 1; i <= 3; i++) {
        const id = `storage-ui:${i}`;
        tx.objectStore('snapshots').put({ id, owner: 'storage-ui', name: 'Backup', width: 32, height: 32, frames: 1, thumb: '', time: i });
        tx.objectStore('snapshotData').put(r.result[0], id);
      }
    };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    db.close();
  });
  await page.locator('[data-home]').click();
  const panel = page.getByRole('region', { name: 'Storage and backups', exact: true });
  await expect(panel.getByText('Storage may be cleared by the browser.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('85%');
  await expect(page.locator('[data-key^="p:"]', { hasText: 'Backup' })).toContainText(/(?:B|KiB|MiB)/);
  await panel.getByRole('button', { name: 'Request persistent storage', exact: true }).click();
  await expect(panel.getByText('Persistent storage is enabled.', { exact: true })).toBeVisible();
  const allDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Back up all projects (ZIP)', exact: true }).click();
  const archive = await allDownload;
  expect(archive.suggestedFilename()).toBe('pixprite-backup.zip');
  expect((await readFile((await archive.path())!)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await panel.getByRole('button', { name: 'Clean older snapshots', exact: true }).click();
  await page.getByRole('dialog', { name: 'Clean older snapshots', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Clean older snapshots', exact: true })).toBeEnabled();
  const remaining = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      return await new Promise<string[]>(resolve => {
        const r = db.transaction('snapshots').objectStore('snapshots').index('owner').getAll('storage-ui');
        r.onsuccess = () => resolve(r.result.map(s => s.id));
      });
    } finally { db.close(); }
  });
  expect(remaining).toEqual(['storage-ui:3']);
  const individualDownload = page.waitForEvent('download');
  await page.locator('[data-key^="p:"]', { hasText: 'Backup' }).getByTitle('Download (.pixprite)').click();
  const individual = await individualDownload;
  expect(JSON.parse(await readFile((await individual.path())!, 'utf8'))).toMatchObject({ format: 'pixprite', name: 'Backup' });
});

test('damaged saved project recovers its previous version as a separate unsaved copy', async ({ page }) => {
  await create(page, 'Recoverable');
  await draw(page);
  await assertPainted(page, 'Recoverable');
  const previous = await pngPixels(page, await download(page, 'file.exportPng'));
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Recoverable', { exact: true })).toBeVisible();
  await command(page, 'layer.new');
  await command(page, 'file.save');
  const projectId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<string>(resolve => { const r = db.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result[0].id); }); }
    finally { db.close(); }
  });
  await expect.poll(() => page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<number>(resolve => { const r = db.transaction('data').objectStore('data').get(id); r.onsuccess = () => resolve((r.result.document ?? r.result).layers.length); }); }
    finally { db.close(); }
  }, projectId)).toBe(2);
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      const tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').put({ damaged: true }, id);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    } finally { db.close(); }
  }, projectId);
  await page.locator('[data-home]').click();
  await page.locator('[data-key^="p:"]', { hasText: 'Recoverable' }).click({ button: 'right' });
  await page.getByText('Recover previous version', { exact: true }).click();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Recoverable (recovered) · 32×32');
  await expect(page.locator('[data-hit=layer]')).toHaveCount(1);
  await expect(page.locator('[draggable=true][data-active=true] [data-modified=true]')).toHaveCount(1);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(previous);
  expect(await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<unknown>(resolve => { const r = db.transaction('data').objectStore('data').get(id); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  }, projectId)).toEqual({ damaged: true });
  await assertPainted(page, 'Recoverable (recovered)');
  await page.reload();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Recoverable (recovered) · 32×32');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(previous);
});

test('one damaged session and malformed preferences do not prevent restoring healthy tabs', async ({ page }) => {
  await create(page, 'Broken'); await draw(page); await assertPainted(page, 'Broken');
  await create(page, 'Healthy'); await draw(page); await assertPainted(page, 'Healthy');
  const healthy = await pngPixels(page, await download(page, 'file.exportPng'));
  const damagedId = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('pixprite:session')!);
    const id = session.tabs[0];
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({ damaged: true }, `data:${id}`);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    } finally { db.close(); }
    localStorage.setItem('pixprite:editor', '{broken');
    localStorage.setItem('pixprite:docs', '{broken legacy');
    return id as string;
  });
  await page.reload();
  await expect(page.locator('[draggable=true][title="Healthy · 32×32"]')).toBeVisible();
  await page.locator('[draggable=true][title="Healthy · 32×32"]').click();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(healthy);
  expect(await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<unknown>(resolve => { const r = db.transaction('sessions').objectStore('sessions').get(`data:${id}`); r.onsuccess = () => resolve(r.result); }); }
    finally { db.close(); }
  }, damagedId)).toEqual({ damaged: true });
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('pixprite:session')!).tabs.includes(id), damagedId)).toBe(true);
  const count = await page.locator('[draggable=true]').count();
  await page.reload();
  await expect(page.locator('[draggable=true]')).toHaveCount(count);
  await expect(page.locator('[draggable=true][title="Healthy · 32×32"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pixprite:docs'))).toBe('{broken legacy');
  const legacy = { ...(await documentNamed(page, 'Healthy')), name: 'Legacy' };
  await page.evaluate(data => localStorage.setItem('pixprite:docs', JSON.stringify({ docs: [data, { damaged: true }] })), legacy);
  await page.reload();
  await expect(page.locator('[draggable=true][title="Healthy · 32×32"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[draggable=true][title="Healthy · 32×32"]')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:docs')!))).toEqual({ docs: [{ damaged: true }] });
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<number>(resolve => { const r = db.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result.filter(p => p.name === 'Legacy').length); }); }
    finally { db.close(); }
  })).toBe(1);
});

test('v5 shared image instances and layer effects retain source pixels across import, PNG export and reload', async ({ page }) => {
  const source = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]).toString('base64');
  const fixture = {
    format: 'pixprite', version: 5, name: 'Placed model', width: 3, height: 3,
    frames: [{ duration: 100 }], images: [{ id: 'shared-source', w: 2, h: 1, d: source }],
    layers: [{ name: 'Placed', cels: [{ x: 1, y: 0, image: { kind: 'image', id: 'shared-source' }, flipX: true, rotation: 90, opacity: 0.5 }],
      effects: [{ id: 'alpha', type: 'opacity', enabled: true, amount: 0.5 }] }],
  };
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: 'Placed model.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('[data-key^="p:"]', { hasText: 'Placed model' }).dblclick();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  const expected = Array(3 * 3 * 4).fill(0);
  expected.splice(4, 4, 0, 255, 0, 64);
  expected.splice(16, 4, 255, 0, 0, 64);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual({ width: 3, height: 3, data: expected });
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Placed model', { exact: true })).toBeVisible();
  const saved = await documentNamed(page, 'Placed model');
  expect(saved).toMatchObject({ version: 7, images: [{ id: 'shared-source', d: source }], layers: [{ effects: fixture.layers[0].effects }] });
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual({ width: 3, height: 3, data: expected });
  await expect.poll(() => documentNamed(page, 'Placed model')).toEqual(saved);
});

test('large autosave sends raw pixels to a real worker and accepts drawing before completion without losing later edits', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const monitor = window as unknown as {
      holdPreparation: boolean; preparationStarted: boolean; workerCompleted: boolean; rawPixels: boolean;
      releasePreparation?: () => void; firstSessionLayers?: number; backgroundOps: string[]; heldTerminated: boolean; writtenLayers: number[];
    };
    monitor.holdPreparation = false; monitor.preparationStarted = false; monitor.workerCompleted = false; monitor.rawPixels = false; monitor.backgroundOps = []; monitor.heldTerminated = false; monitor.writtenLayers = [];
    const NativeWorker = Worker;
    class ObservedWorker extends NativeWorker {
      private hold = false;
      override terminate() { if (this.hold) monitor.heldTerminated = true; super.terminate(); }
      override set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = event => {
          if (this.hold && event.data.type !== 'progress') {
            monitor.workerCompleted = event.data.type === 'done';
            // Keep the real worker result pending until the test has sent editor input.
            monitor.releasePreparation = () => { this.hold = false; handler?.call(this, event); };
          } else handler?.call(this, event);
        };
      }
      override get onmessage() { return super.onmessage; }
      override postMessage(message: any, options?: any) {
        monitor.backgroundOps.push(message.op);
        if (message.op === 'prepareDocument' && message.args.raw.width === 2048 && message.args.raw.images[0]?.d.length >= 2048 * 2048 && monitor.holdPreparation) {
          monitor.holdPreparation = false; monitor.preparationStarted = true; this.hold = true;
          monitor.rawPixels = message.args.raw.images[0]?.d instanceof Uint32Array && options === undefined;
        }
        super.postMessage(message, options);
      }
    }
    window.Worker = ObservedWorker;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'sessions' && String(args[1]).startsWith('data:') && monitor.preparationStarted) {
        const layers = ((args[0] as any).document ?? args[0]).layers.length;
        monitor.writtenLayers.push(layers);
        monitor.firstSessionLayers ??= layers;
      }
      return put.apply(this, args);
    };
  });
  await page.reload();
  await command(page, 'file.new');
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('textbox').fill('Large background');
  await dialog.getByRole('spinbutton').nth(0).fill('2048');
  await dialog.getByRole('spinbutton').nth(1).fill('2048');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  const surface = await page.getByTestId('sprite-canvas').boundingBox();
  if (!surface) throw new Error('Missing drawing surface');
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2);
  await page.evaluate(() => { (window as any).holdPreparation = true; });
  await command(page, 'select.all');
  await command(page, 'edit.fill');
  await expect.poll(() => page.evaluate(() => (window as any).preparationStarted), { intervals: [10, 20, 50] }).toBe(true);
  expect(await page.evaluate(() => (window as any).rawPixels)).toBe(true);

  // Real keyboard input and timeline mutation while the autosave operation is pending.
  await command(page, 'select.none');
  await command(page, 'layer.new');
  await expect(page.locator('[data-hit=layer]')).toHaveCount(2);
  await page.keyboard.press('b');
  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Missing drawing surface');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).heldTerminated)).toBe(true);
  // A result already delivered by the real worker can arrive late; its cancelled promise cannot commit.
  await page.evaluate(() => (window as any).releasePreparation?.());
  expect(await page.evaluate(() => (window as any).writtenLayers)).not.toContain(1);
  await expect.poll(async () => {
    const saved = await documentNamed(page, 'Large background');
    return saved?.layers.length === 2 && !!saved.layers[1].cels[0];
  }).toBe(true);
  expect(await page.evaluate(() => (window as any).backgroundOps)).toContain('inspectDocument');

  // Explicit saves keep captured project metadata and dirty flags consistent with the same snapshot.
  await page.evaluate(() => {
    Object.assign(window, { holdPreparation: true, preparationStarted: false, workerCompleted: false, releasePreparation: undefined });
  });
  await command(page, 'file.save');
  await expect.poll(() => page.evaluate(() => (window as any).preparationStarted)).toBe(true);
  await command(page, 'layer.new');
  await expect(page.locator('[data-hit=layer]')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => (window as any).workerCompleted)).toBe(true);
  await page.evaluate(() => (window as any).releasePreparation());
  await expect(page.getByText('Saved: Large background', { exact: true })).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true] [data-modified=true]')).toHaveCount(1);
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('pixprite'); r.onsuccess = () => resolve(r.result); });
    try {
      const tx = db.transaction(['meta', 'data']);
      const request = <T,>(r: IDBRequest<T>) => new Promise<T>(resolve => { r.onsuccess = () => resolve(r.result); });
      const [metas, values] = await Promise.all([request(tx.objectStore('meta').getAll()), request(tx.objectStore('data').getAll())]);
      const data = values[0].document ?? values[0];
      return { metaLayers: metas[0].layers, dataLayers: data.layers.length, metaWidth: metas[0].width, dataWidth: data.width };
    } finally { db.close(); }
  })).toEqual({ metaLayers: 2, dataLayers: 2, metaWidth: 2048, dataWidth: 2048 });
  await expect.poll(async () => (await documentNamed(page, 'Large background'))?.layers.length).toBe(3);
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-hit=layer]')).toHaveCount(3);
  expect((await documentNamed(page, 'Large background'))?.layers[1].cels[0]).toBeTruthy();
});

test('incremental autosave reuses pixels and previews, coalesces bursts and cancels obsolete preparation', async ({ page }) => {
  await create(page, 'Incremental');
  await draw(page);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Incremental', { exact: true })).toBeVisible();
  const original = await documentNamed(page, 'Incremental');
  await page.evaluate(() => {
    const monitor = (window as any).incremental = { prepares: 0, rawImages: 0, previews: 0, resources: 0, previewWrites: 0, dataWrites: 0, holdNext: false, held: false, cancelled: false };
    const NativeWorker = Worker;
    class ObservedWorker extends NativeWorker {
      private held = false;
      override terminate() { if (this.held) monitor.cancelled = true; super.terminate(); }
      override set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = event => {
          if (this.held && event.data.type !== 'progress') monitor.held = true;
          else handler?.call(this, event);
        };
      }
      override get onmessage() { return super.onmessage; }
      override postMessage(message: any, options?: any) {
        if (message.op === 'prepareDocument') {
          monitor.prepares++;
          monitor.rawImages += message.args.raw.images.filter((image: any) => image.d instanceof Uint32Array).length;
          if (message.args.preview) monitor.previews++;
          if (monitor.holdNext) { this.held = true; monitor.holdNext = false; }
        }
        super.postMessage(message, options);
      }
    }
    window.Worker = ObservedWorker;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'resources') monitor.resources++;
      if (this.name === 'previews') monitor.previewWrites++;
      if (this.name === 'sessions' && String(args[1]).startsWith('data:')) monitor.dataWrites++;
      return put.apply(this, args);
    };
  });
  await command(page, 'image.properties');
  const properties = page.getByRole('dialog', { name: 'Image properties', exact: true });
  await properties.getByRole('textbox').nth(1).fill('Incremental author');
  await properties.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(async () => (await documentNamed(page, 'Incremental') as any)?.info?.author).toBe('Incremental author');
  await command(page, 'file.save');
  await expect.poll(() => page.locator('[draggable=true][data-active=true] [data-modified=true]').count()).toBe(0);
  expect(await page.evaluate(() => {
    const m = (window as any).incremental;
    return { rawImages: m.rawImages, resources: m.resources, previews: m.previews, previewWrites: m.previewWrites };
  })).toEqual({ rawImages: 0, resources: 0, previews: 0, previewWrites: 0 });

  await page.evaluate(() => Object.assign((window as any).incremental, { holdNext: true, prepares: 0, dataWrites: 0 }));
  await command(page, 'layer.new');
  await expect.poll(() => page.evaluate(() => (window as any).incremental.held)).toBe(true);
  // Eight rapid keyboard edits request one latest save behind the cancelled worker.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Alt+n');
  await expect(page.locator('[data-hit=frame]')).toHaveCount(9);
  await expect.poll(async () => {
    const saved = await documentNamed(page, 'Incremental');
    return { frames: saved?.frames.length, layers: saved?.layers.length };
  }).toEqual({ frames: 9, layers: 2 });
  const counts = await page.evaluate(() => {
    const m = (window as any).incremental;
    return { prepares: m.prepares, dataWrites: m.dataWrites, cancelled: m.cancelled, resources: m.resources };
  });
  expect(counts).toEqual({ prepares: 2, dataWrites: 1, cancelled: true, resources: 0 });
  expect((await documentNamed(page, 'Incremental') as any).images).toEqual((original as any).images);
  await draw(page, 20);
  expect(await page.evaluate(() => (window as any).incremental.resources)).toBe(1);
  const final = await documentNamed(page, 'Incremental');
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-hit=frame]')).toHaveCount(9);
  await expect(page.locator('[data-hit=layer]')).toHaveCount(2);
  expect(await documentNamed(page, 'Incremental')).toEqual(final);
});

async function observeQuietPreparation(page: Page, name: string) {
  await page.evaluate(name => {
    const monitor = (window as any).quiet = { prepares: 0, copies: 0, cancelled: 0, held: false, holdNext: true, starts: [] as string[], downs: 0, moves: 0, ups: 0 };
    const clone = structuredClone;
    window.structuredClone = function <T,>(value: T, options?: StructuredSerializeOptions): T {
      if ((value as any)?.format === 'pixprite' && (value as any).name === name) monitor.copies++;
      return options === undefined ? clone(value) : clone(value, options);
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
      const pointer = event as PointerEvent;
      if (!pointer.isTrusted || !(pointer.target as Element)?.closest('[data-testid="sprite-canvas"]')) return;
      if (type === 'pointerdown') monitor.downs++;
      else if (type === 'pointermove' && pointer.buttons === 1) monitor.moves++;
      else if (type === 'pointerup') monitor.ups++;
    }, true);
    const NativeWorker = Worker;
    class ObservedWorker extends NativeWorker {
      private held = false;
      override terminate() { if (this.held) monitor.cancelled++; super.terminate(); }
      override set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = event => {
          if (this.held && event.data.type !== 'progress') monitor.held = true;
          else handler?.call(this, event);
        };
      }
      override get onmessage() { return super.onmessage; }
      override postMessage(message: any, options?: any) {
        if (message.op === 'prepareDocument') {
          monitor.prepares++; monitor.starts.push(message.args.raw.name);
          if (monitor.holdNext) { this.held = true; monitor.holdNext = false; }
        }
        super.postMessage(message, options);
      }
    }
    window.Worker = ObservedWorker;
  }, name);
}

test('continuous trusted pencil mutations cancel on pointerdown and wait for quiet without repeated preparation or copies', async ({ page }) => {
  await create(page, 'Quiet stroke');
  await draw(page);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Quiet stroke', { exact: true })).toBeVisible();
  await observeQuietPreparation(page, 'Quiet stroke');
  await command(page, 'layer.new');
  await expect.poll(() => page.evaluate(() => (window as any).quiet.held)).toBe(true);
  expect(await page.evaluate(() => ({ prepares: (window as any).quiet.prepares, copies: (window as any).quiet.copies }))).toEqual({ prepares: 1, copies: 1 });
  await page.keyboard.press('b');
  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Missing drawing surface');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x - 120, y);
  await page.mouse.down();
  // The first mutation is pointerdown, before any move or pointerup/state.save().
  expect(await page.evaluate(() => ({ cancelled: (window as any).quiet.cancelled, downs: (window as any).quiet.downs, moves: (window as any).quiet.moves, ups: (window as any).quiet.ups })))
    .toEqual({ cancelled: 1, downs: 1, moves: 0, ups: 0 });
  for (let i = 0; i < 200; i++) {
    await page.mouse.move(x - 120 + i * 240 / 199, y + Math.sin(i / 8) * 40);
    if (i % 40 === 39) expect(await page.evaluate(() => ({ prepares: (window as any).quiet.prepares, copies: (window as any).quiet.copies, ups: (window as any).quiet.ups })))
      .toEqual({ prepares: 1, copies: 1, ups: 0 });
  }
  expect(await page.evaluate(() => (window as any).quiet.moves)).toBe(200);
  // Keep the button down: only actual version mutations have stopped. No pointerup save is available.
  await expect.poll(() => page.evaluate(() => (window as any).quiet.prepares)).toBe(2);
  expect(await page.evaluate(() => (window as any).quiet.ups)).toBe(0);
  await page.mouse.up();
  const expected = await pngPixels(page, await download(page, 'file.exportPng'));
  await expect.poll(async () => {
    const stored = await documentNamed(page, 'Quiet stroke');
    return stored ? documentPixels(page, stored) : null;
  }).toEqual(expected);
  expect(await page.evaluate(() => (window as any).quiet.prepares)).toBe(2);
  await expect(page.getByText(/Could not save/)).toHaveCount(0);
  const final = await documentNamed(page, 'Quiet stroke');
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  expect(await documentNamed(page, 'Quiet stroke')).toEqual(final);
});

test('closing a pending preparation disposes its watch and disabled autosave stays disabled after further strokes', async ({ page }) => {
  await create(page, 'Closing quiet');
  await draw(page);
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Closing quiet', { exact: true })).toBeVisible();
  await observeQuietPreparation(page, 'Closing quiet');
  await command(page, 'layer.new');
  await expect.poll(() => page.evaluate(() => (window as any).quiet.held)).toBe(true);
  await page.locator('[draggable=true][data-active=true]').getByRole('button').click();
  await page.getByRole('button', { name: "Don't save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).quiet.cancelled)).toBe(1);
  await expect(page.locator('[draggable=true]')).toHaveCount(0);
  await command(page, 'edit.prefs');
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await preferences.getByLabel('Keep work in the browser between sessions', { exact: true }).uncheck();
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();
  await create(page, 'Manual quiet');
  await command(page, 'file.save');
  await expect(page.getByText('Saved: Manual quiet', { exact: true })).toBeVisible();
  const before = await documentNamed(page, 'Manual quiet');
  const prepares = await page.evaluate(() => (window as any).quiet.prepares);
  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Missing drawing surface');
  await page.keyboard.press('b');
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 60 });
  await page.mouse.up();
  await page.waitForTimeout(700); // Beyond both autosave and editor-state debounce deadlines.
  expect(await page.evaluate(() => (window as any).quiet.prepares)).toBe(prepares);
  expect(await documentNamed(page, 'Manual quiet')).toEqual(before);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:prefs')!).autosave)).toBe(false);
  expect((await page.evaluate(() => (window as any).quiet.starts) as string[]).filter(name => name === 'Closing quiet')).toHaveLength(1);
  await expect(page.locator('[draggable=true][data-active=true] [data-modified=true]')).toHaveCount(1);
  await command(page, 'file.save');
  await expect.poll(() => page.locator('[draggable=true][data-active=true] [data-modified=true]').count()).toBe(0);
  const expected = await pngPixels(page, await download(page, 'file.exportPng'));
  const stored = await documentNamed(page, 'Manual quiet');
  expect(await documentPixels(page, stored!)).toEqual(expected);
  await expect(page.getByText(/Could not save/)).toHaveCount(0);
});

test('Layer FX controls preview/cancel/reorder/play, persist editable stacks, and bake one frame with one undo', async ({ page }) => {
  const source = Buffer.from(Array.from({ length: 4 }, () => [255, 0, 0, 255]).flat()).toString('base64');
  const fixture = {
    format: 'pixprite', version: 5, name: 'Layer FX controls', width: 2, height: 2,
    frames: [{ duration: 400 }, { duration: 400 }], images: [{ id: 'red-source', w: 2, h: 2, d: source }],
    layers: [{ name: 'Paint', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red-source' } }, { link: 0 }] }],
  };
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: 'Layer FX controls.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('[data-key^="p:"]', { hasText: fixture.name }).dblclick();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  const sample = () => page.getByTestId('sprite-canvas').locator('canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data);
  });
  const original = await sample();
  await command(page, 'layer.effects');
  let dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Add opacity', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Effect opacity' }).fill('0');
  await expect.poll(sample).not.toEqual(original);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).uncheck();
  await expect.poll(sample).toEqual(original);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).check();
  await expect.poll(sample).not.toEqual(original);
  await dialog.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect(dialog.getByText('Frame 2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(sample).toEqual(original);
  expect(await documentNamed(page, fixture.name)).toMatchObject({ images: [{ id: 'red-source', d: source }] });

  await command(page, 'layer.effects');
  dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Add opacity', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Effect opacity' }).nth(0).fill('50');
  await dialog.getByRole('button', { name: 'Add opacity', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Effect opacity' }).nth(1).fill('80');
  await dialog.getByRole('button', { name: 'Move effect up', exact: true }).nth(1).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Effect opacity' }).nth(0)).toHaveValue('80');
  await dialog.getByRole('checkbox', { name: 'Effect enabled' }).nth(0).uncheck();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].effects?.map((fx: any) => [fx.amount, fx.enabled]))
    .toEqual([[.8, false], [.5, true]]);
  const expected = { width: 2, height: 2, data: Array.from({ length: 4 }, () => [255, 0, 0, 128]).flat() };
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  const before = await documentNamed(page, fixture.name) as any;
  expect(before.images).toEqual([{ id: 'red-source', w: 2, h: 2, d: source }]);

  await command(page, 'layer.effects');
  dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Entire layer', exact: true }).click();
  await page.getByText('Current frame (1)', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Bake effects', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].bakedEffects?.map((ids: string[]) => ids.length))
    .toEqual([2, 0]);
  const baked = await documentNamed(page, fixture.name) as any;
  expect(baked.version).toBe(7);
  expect(baked.layers[0].cels[1]).toMatchObject({ image: { id: 'red-source' } });
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await command(page, 'edit.undo');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
  await command(page, 'edit.redo');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(baked);
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await command(page, 'layer.effects');
  dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await expect(dialog.getByRole('spinbutton', { name: 'Effect opacity' }).nth(0)).toHaveValue('80');
  await expect(dialog.getByRole('checkbox', { name: 'Effect enabled' }).nth(0)).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

/** Independent small-fixture oracle: distances are computed by enumeration, not editor transforms. */
function outlinedPixels(source: { width: number; height: number; data: number[] }, thickness: number, position: 'inside' | 'center' | 'outside', join: 'round' | 'miter' | 'bevel', alpha = 128) {
  const { width: w, height: h } = source, data = source.data.slice();
  const inner = position === 'outside' ? 0 : position === 'inside' ? thickness : Math.floor(thickness / 2);
  const outer = position === 'inside' ? 0 : position === 'outside' ? thickness : Math.ceil(thickness / 2);
  const metric = (dx: number, dy: number) => join === 'round' ? Math.hypot(dx, dy) : join === 'miter' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, solid = source.data[i + 3] > 0;
    let distance = Infinity;
    for (let sy = -1; sy <= h; sy++) for (let sx = -1; sx <= w; sx++) {
      const candidate = sx >= 0 && sy >= 0 && sx < w && sy < h && source.data[(sy * w + sx) * 4 + 3] > 0;
      if (candidate !== solid) distance = Math.min(distance, metric(x - sx, y - sy));
    }
    if (solid && distance <= inner) {
      data[i] = Math.round(source.data[i] * (1 - alpha / 255));
      data[i + 1] = Math.round(source.data[i + 1] * (1 - alpha / 255));
      data[i + 2] = Math.round(255 * alpha / 255 + source.data[i + 2] * (1 - alpha / 255));
    } else if (!solid && distance <= outer) data.splice(i, 4, 0, 0, 255, alpha);
  }
  return { width: w, height: h, data };
}

async function openFixture(page: Page, fixture: { name: string }) {
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: fixture.name + '.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('[data-key^="p:"]', { hasText: fixture.name }).dblclick();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

const canvasFingerprint = (page: Page) => page.getByTestId('sprite-canvas').locator('canvas').evaluate(canvas => {
  const c = canvas as HTMLCanvasElement, pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let hash = 2166136261;
  for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
});

test('Outline UI previews color/alpha/geometry, updates after real drawing and erasing, and bakes without changing sources early', async ({ page }) => {
  const source = Buffer.from(Array.from({ length: 9 }, () => [255, 0, 0, 255]).flat()).toString('base64');
  const fixture = {
    format: 'pixprite', version: 6, name: 'Outline drawing', width: 9, height: 9,
    frames: [{ duration: 100 }], images: [{ id: 'red-source', w: 3, h: 3, d: source }],
    layers: [{ name: 'Paint', cels: [{ x: 3, y: 3, image: { kind: 'image', id: 'red-source' } }] }],
  };
  await openFixture(page, fixture);
  const original = await canvasFingerprint(page);
  await command(page, 'layer.effects');
  let dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Add outline', exact: true }).click();
  await dialog.getByLabel('Outline color', { exact: true }).fill('#0000ff');
  await dialog.getByRole('spinbutton', { name: 'Outline alpha', exact: true }).fill('128');
  await dialog.getByRole('spinbutton', { name: 'Outline thickness', exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Outside', exact: true }).click();
  await page.getByText('Center', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Round', exact: true }).click();
  await page.getByText('Miter', { exact: true }).click();
  await expect.poll(() => canvasFingerprint(page)).not.toEqual(original);
  const miter = await canvasFingerprint(page);
  await dialog.getByRole('button', { name: 'Miter', exact: true }).click();
  await page.getByText('Bevel', { exact: true }).click();
  await expect.poll(() => canvasFingerprint(page)).not.toEqual(miter);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).uncheck();
  await expect.poll(() => canvasFingerprint(page)).toEqual(original);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).check();
  await dialog.getByRole('button', { name: 'Bevel', exact: true }).click();
  await page.getByText('Round', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].effects?.[0]).toMatchObject({
    type: 'outline', enabled: true, color: 0x80ff0000, thickness: 3, position: 'center', join: 'round',
  });
  const committed = await documentNamed(page, fixture.name) as any;
  expect(committed.images).toEqual(fixture.images);
  const sourcePixels = async (doc: any) => documentPixels(page, { ...doc, layers: doc.layers.map((layer: any) => ({ ...layer, effects: [] })) });
  const expected = outlinedPixels(await sourcePixels(committed), 3, 'center', 'round');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);

  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  const paint = async (key: string) => {
    await page.keyboard.press(key);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 4, box.y + 4);
    await command(page, 'file.save');
  };
  const appliedVisual = await canvasFingerprint(page);
  await paint('b');
  await expect.poll(() => canvasFingerprint(page)).not.toEqual(appliedVisual);
  await expect.poll(async () => (await sourcePixels(await documentNamed(page, fixture.name))).data).not.toEqual((await sourcePixels(committed)).data);
  const drawn = await documentNamed(page, fixture.name) as any;
  expect(drawn.layers[0].effects).toEqual(committed.layers[0].effects);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(outlinedPixels(await sourcePixels(drawn), 3, 'center', 'round'));
  const drawnVisual = await canvasFingerprint(page);
  await paint('e');
  await expect.poll(() => canvasFingerprint(page)).not.toEqual(drawnVisual);
  const solidCount = (pixels: { data: number[] }) => pixels.data.filter((v, i) => i % 4 === 3 && v > 0).length;
  await expect.poll(async () => solidCount(await sourcePixels(await documentNamed(page, fixture.name)))).toBeLessThan(solidCount(await sourcePixels(drawn)));
  const erased = await documentNamed(page, fixture.name) as any;
  const erasedPixels = outlinedPixels(await sourcePixels(erased), 3, 'center', 'round');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(erasedPixels);
  await command(page, 'edit.undo');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await command(page, 'edit.redo');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(erased);
  await command(page, 'layer.effects');
  dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Bake effects', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].effects).toEqual([]);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(erasedPixels);
  await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(erased);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(erasedPixels);
});

test('native canvas retains off-canvas nested group outlines through PNG, partial bake, undo and reload', async ({ page }) => {
  const effect = (id: string) => ({ id, type: 'outline', enabled: true, color: 0xffff0000, thickness: 1, position: 'outside', join: 'round' });
  const fixture = {
    format: 'pixprite', version: 6, name: 'Off-canvas outline', width: 5, height: 3,
    frames: [{ duration: 100 }, { duration: 100 }], images: [{ id: 'red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') }],
    layers: [
      { name: 'Child', depth: 2, effects: [effect('child')], cels: [{ x: -2, y: 1, image: { kind: 'image', id: 'red' } }, { link: 0 }] },
      { name: 'Nested', depth: 1, group: true, effects: [effect('nested')], cels: [null, null] },
      { name: 'Outer', depth: 0, group: true, effects: [effect('outer')], cels: [null, null] },
    ],
  };
  await openFixture(page, fixture);
  const expected = { width: 5, height: 3, data: Array.from({ length: 15 }, (_, i) => [0, 0, i === 0 || i === 5 || i === 6 || i === 10 ? 255 : 0, i === 0 || i === 5 || i === 6 || i === 10 ? 255 : 0]).flat() };
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await page.locator('[data-hit=layer][data-l="2"]').click();
  await command(page, 'layer.effects');
  const dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Entire layer', exact: true }).click();
  await page.getByText('Current frame (1)', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Bake effects', exact: true }).click(); await expect(dialog).toBeHidden();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await command(page, 'edit.undo');
  await expect.poll(async () => (await documentNamed(page, fixture.name))?.layers.length).toBe(3);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
});

test('growing outlined geometry shows a localized pause, reloads safely, and resumes after shrinking with FX still enabled', async ({ page }) => {
  const source = Buffer.from(Array.from({ length: 4094 }, () => [255, 0, 0, 255]).flat()).toString('base64');
  const effect = { id: 'outline', type: 'outline', enabled: true, color: 0xffff0000, thickness: 1, position: 'outside', join: 'round' };
  const fixture = {
    format: 'pixprite', version: 6, name: 'Outline limits', width: 4094, height: 3,
    frames: [{ duration: 100 }], images: [{ id: 'wide-red', w: 4094, h: 1, d: source }],
    layers: [{ name: 'Wide', effects: [effect], cels: [{ x: 0, y: 1, image: { kind: 'image', id: 'wide-red' } }] }],
  };
  await openFixture(page, fixture);
  const original = await pngPixels(page, await download(page, 'file.exportPng'));
  const scale = async (width: number) => {
    await command(page, 'image.spriteSize');
    const dialog = page.getByRole('dialog', { name: 'Scale image', exact: true });
    await dialog.getByRole('spinbutton').nth(0).fill(String(width));
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await scale(4096);
  await expect(page.getByRole('alert').filter({ hasText: 'Layer FX paused' })).toBeVisible();
  await expect.poll(async () => (await documentNamed(page, fixture.name))?.width).toBe(4096);
  const grown = await documentNamed(page, fixture.name) as any;
  expect(grown.layers[0].effects).toEqual([effect]); expect(grown.images[0].w).toBe(4096);
  const paused = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(paused.data.slice(0, 4096 * 4).every(v => v === 0)).toBe(true);
  expect(paused.data.slice(4096 * 4, 4096 * 8)).toEqual(Array.from({ length: 4096 }, () => [255, 0, 0, 255]).flat());
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Layer FX paused' })).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(paused);
  await scale(4094);
  await expect(page.getByRole('alert').filter({ hasText: 'Layer FX paused' })).toHaveCount(0);
  await expect.poll(async () => (await documentNamed(page, fixture.name))?.width).toBe(4094);
  expect((await documentNamed(page, fixture.name) as any).layers[0].effects).toEqual([effect]);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(original);
});

test('native 4096-wide canvas previews a tiny outlined brush stroke and fully erases it without bounds errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = {
    format: 'pixprite', version: 6, name: 'Outline wide preview', width: 4096, height: 3,
    frames: [{ duration: 100 }], images: [{ id: 'red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') }],
    layers: [{ name: 'Tiny', effects: [{ id: 'outline', type: 'outline', enabled: true, color: 0xffff0000, thickness: 1, position: 'outside', join: 'round' }],
      cels: [{ x: 2048, y: 1, image: { kind: 'image', id: 'red' } }] }],
  };
  await openFixture(page, fixture);
  const point = await page.getByTestId('sprite-canvas').locator('canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement, box = c.getBoundingClientRect();
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 0 && pixels[i + 3] === 255)
      return { x: box.x + ((i / 4) % c.width + .5) * box.width / c.width, y: box.y + (Math.floor(i / 4 / c.width) + .5) * box.height / c.height };
    throw new Error('Missing native red source pixel');
  });
  await page.keyboard.press('b'); await page.mouse.click(point.x, point.y); await page.mouse.move(10, 10);
  await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.images[0]?.d).not.toBe(fixture.images[0].d);
  const drawn = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(drawn.data.slice((4096 + 2048) * 4, (4096 + 2048) * 4 + 4)).not.toEqual([255, 0, 0, 255]);
  expect(drawn.data[(4096 + 2048) * 4 + 3]).toBe(255);
  await page.keyboard.press('e'); await page.mouse.click(point.x, point.y); await page.mouse.move(10, 10);
  await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name))?.layers[0].cels[0]).toBeNull();
  const erased = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(erased.data.every(value => value === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('grayscale Outline baking retains custom color by promoting to RGB, and undo restores editable grayscale sources', async ({ page }) => {
  const effect = { id: 'outline', type: 'outline', enabled: true, color: 0xffff0000, thickness: 1, position: 'outside', join: 'round' };
  const fixture = {
    format: 'pixprite', version: 6, name: 'Grayscale outline', width: 5, height: 5, colorMode: 'gray',
    frames: [{ duration: 100 }], images: [{ id: 'gray', w: 1, h: 1, d: Buffer.from([120, 120, 120, 255]).toString('base64') }],
    layers: [{ name: 'Gray', effects: [effect], cels: [{ x: 2, y: 2, image: { kind: 'image', id: 'gray' } }] }],
  };
  await openFixture(page, fixture);
  const before = await documentNamed(page, fixture.name);
  const expected = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(expected.data.slice((2 * 5 + 1) * 4, (2 * 5 + 1) * 4 + 4)).toEqual([0, 0, 255, 255]);
  await command(page, 'layer.effects');
  const dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await expect(dialog.getByText('Baking color effects converts a grayscale document to RGB to preserve their color.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Bake effects', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.colorMode).toBe('rgb');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
});

test('other live FX controls render exact shadow pixels, follow real paint/erase, and bake the ordered editable stack', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = { format: 'pixprite', version: 6, name: 'Other live effects', width: 9, height: 9,
    frames: [{ duration: 100 }], images: [{ id: 'red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') }],
    layers: [{ name: 'Paint', cels: [{ x: 4, y: 4, image: { kind: 'image', id: 'red' } }] }] };
  await openFixture(page, fixture);
  const initial = await canvasFingerprint(page);
  await command(page, 'layer.effects');
  let dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Add drop shadow', exact: true }).click();
  await dialog.getByLabel('Effect color', { exact: true }).fill('#0000ff');
  await dialog.getByRole('spinbutton', { name: 'Effect alpha', exact: true }).fill('255');
  await dialog.getByRole('spinbutton', { name: 'Effect size', exact: true }).fill('1');
  await dialog.getByRole('spinbutton', { name: 'Shadow X', exact: true }).fill('2');
  await dialog.getByRole('spinbutton', { name: 'Shadow Y', exact: true }).fill('1');
  await expect.poll(() => canvasFingerprint(page)).not.toEqual(initial);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).uncheck();
  await expect.poll(() => canvasFingerprint(page)).toEqual(initial);
  await dialog.getByRole('checkbox', { name: 'Preview', exact: true }).check();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toBeHidden();
  const expected = { width: 9, height: 9, data: Array<number>(9 * 9 * 4).fill(0) };
  expected.data.splice((4 * 9 + 4) * 4, 4, 255, 0, 0, 255);
  for (let y = 4; y <= 6; y++) for (let x = 5; x <= 7; x++) expected.data.splice((y * 9 + x) * 4, 4, 0, 0, 255, 28);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(expected);
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].effects?.[0]?.type).toBe('shadow');
  const applied = await documentNamed(page, fixture.name) as any; expect(applied.images).toEqual(fixture.images);
  const box = await page.getByTestId('sprite-canvas').boundingBox(); if (!box) throw new Error('Missing canvas');
  const paint = async (key: string) => {
    await page.keyboard.press(key); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 2, box.y + 2); await command(page, 'file.save');
  };
  await paint('b');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.images).not.toEqual(applied.images);
  const paintedDocument = await documentNamed(page, fixture.name) as any;
  const source = await documentPixels(page, { ...paintedDocument, layers: paintedDocument.layers.map((layer: any) => ({ ...layer, effects: [] })) });
  const drawn = structuredClone(expected); drawn.data.splice((4 * 9 + 4) * 4, 4, ...source.data.slice((4 * 9 + 4) * 4, (4 * 9 + 4) * 4 + 4));
  expect(drawn).not.toEqual(expected);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(drawn);
  await paint('e'); expect((await pngPixels(page, await download(page, 'file.exportPng'))).data.every(v => v === 0)).toBe(true);
  await command(page, 'edit.undo'); expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(drawn);
  await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(applied);
  await command(page, 'layer.effects'); dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Add glow', exact: true }).click();
  let row = dialog.getByTestId('layer-effect').nth(1);
  await row.getByLabel('Effect color', { exact: true }).fill('#00ff00');
  await row.getByRole('spinbutton', { name: 'Effect size', exact: true }).fill('2');
  await row.getByRole('button', { name: 'Outside', exact: true }).click(); await page.getByText('Inside', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Add color overlay', exact: true }).click();
  row = dialog.getByTestId('layer-effect').nth(2); await row.getByLabel('Effect color', { exact: true }).fill('#ffff00');
  await row.getByRole('spinbutton', { name: 'Effect alpha', exact: true }).fill('128');
  await row.getByRole('checkbox', { name: 'Effect enabled', exact: true }).uncheck();
  await row.getByRole('checkbox', { name: 'Effect enabled', exact: true }).check();
  await row.getByRole('button', { name: 'Move effect up', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add inner outline', exact: true }).click();
  await expect(dialog.getByTestId('layer-effect').nth(3).getByRole('button', { name: 'Inside', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].effects?.map((effect: any) => effect.type)).toEqual(['shadow', 'overlay', 'glow', 'outline']);
  const committed = await documentNamed(page, fixture.name) as any;
  expect(committed.layers[0].effects.map((effect: any) => effect.type)).toEqual(['shadow', 'overlay', 'glow', 'outline']);
  const rendered = await pngPixels(page, await download(page, 'file.exportPng'));
  await command(page, 'layer.effects'); dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByTestId('layer-effect').nth(0).getByRole('spinbutton', { name: 'Shadow X', exact: true }).fill('-2');
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(rendered);
  await command(page, 'layer.effects'); dialog = page.getByRole('dialog', { name: 'Layer FX', exact: true });
  await dialog.getByRole('button', { name: 'Bake effects', exact: true }).click(); await expect(dialog).toBeHidden();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(rendered);
  await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(committed);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(rendered);
});

test('persistent Lock Alpha UI protects real pencil, eraser, fill, gradient and custom-brush strokes with undo and reload', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = { format: 'pixprite', version: 6, name: 'Persistent alpha lock', width: 9, height: 9,
    frames: [{ duration: 100 }], images: [{ id: 'soft-red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 128]).toString('base64') }],
    layers: [{ name: 'Paint', cels: [{ x: 4, y: 4, image: { kind: 'image', id: 'soft-red' } }] }] };
  await openFixture(page, fixture);
  await command(page, 'layer.properties');
  const properties = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  await properties.getByRole('checkbox', { name: 'Lock Alpha', exact: true }).check();
  await properties.getByRole('button', { name: 'OK', exact: true }).click(); await expect(properties).toBeHidden();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].lockAlpha).toBe(true);
  await command(page, 'edit.undo'); await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].lockAlpha).toBeUndefined();
  await command(page, 'edit.redo'); await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].lockAlpha).toBe(true);
  const original = await documentPixels(page, await documentNamed(page, fixture.name) as any);
  const box = await page.getByTestId('sprite-canvas').boundingBox(); if (!box) throw new Error('Missing canvas');
  const point = (x: number, y: number) => ({ x: box.x + (x + .5) * box.width / 9, y: box.y + (y + .5) * box.height / 9 });
  const stroke = async (key: string, x: number, y: number) => {
    await page.keyboard.press(key); const p = point(x, y); await page.mouse.click(p.x, p.y); await page.mouse.move(box.x + 2, box.y + 2);
    await command(page, 'file.save');
  };
  await stroke('b', 4, 4);
  await expect.poll(async () => (await documentPixels(page, await documentNamed(page, fixture.name) as any)).data).not.toEqual(original.data);
  const drawn = await documentNamed(page, fixture.name) as any, painted = await documentPixels(page, drawn);
  expect(painted.data.filter((_, i) => i % 4 === 3)).toEqual(original.data.filter((_, i) => i % 4 === 3));
  await stroke('e', 4, 4); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await stroke('b', 1, 1); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await stroke('f', 1, 1); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await page.keyboard.press('g'); const start = point(1, 1), end = point(7, 1);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  await page.mouse.move(box.x + 2, box.y + 2); await command(page, 'file.save');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await command(page, 'select.all'); await command(page, 'edit.brushFromSelection');
  await stroke('b', 1, 1); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(drawn);
  await command(page, 'edit.discardBrush'); await command(page, 'edit.invert');
  await expect.poll(async () => (await documentPixels(page, await documentNamed(page, fixture.name) as any)).data).not.toEqual(painted.data);
  const filtered = await documentPixels(page, await documentNamed(page, fixture.name) as any);
  expect(filtered.data.filter((_, i) => i % 4 === 3)).toEqual(painted.data.filter((_, i) => i % 4 === 3));
  expect(filtered.data[(4 * 9 + 4) * 4]).not.toBe(painted.data[(4 * 9 + 4) * 4]);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(filtered);
});

/** Coordinates of a fitted sprite; all browser mask workflows use actual pointer tools. */
async function maskPoint(page: Page, x: number, y: number, size = 9) {
  const box = await page.getByTestId('sprite-canvas').boundingBox(); if (!box) throw new Error('Missing mask canvas');
  const zoom = Math.max(1, Math.floor(Math.min(box.width / size, box.height / size) * .85));
  return { x: box.x + Math.round(box.width / 2 - size / 2 * zoom) + (x + .5) * zoom,
    y: box.y + Math.round(box.height / 2 - size / 2 * zoom) + (y + .5) * zoom };
}
async function maskStroke(page: Page, key: string, x = 4, y = 4) {
  await page.keyboard.press(key); const p = await maskPoint(page, x, y); await page.mouse.click(p.x, p.y);
  const box = await page.getByTestId('sprite-canvas').boundingBox(); await page.mouse.move(box!.x + 2, box!.y + 2); await command(page, 'file.save');
}
async function maskDialog(page: Page) {
  await command(page, 'layer.mask'); return page.getByRole('dialog', { name: 'Layer mask', exact: true });
}
async function savedMaskAlpha(page: Page, name: string, layer = 0): Promise<number[]> {
  const document: any = await documentNamed(page, name), mask = document?.layers[layer]?.mask;
  if (!mask) return [];
  const image = document.images.find((image: any) => image.id === mask.image.id);
  return Array.from(Buffer.from(image.d, 'base64')).filter((_, i) => i % 4 === 3);
}

test('layer mask UI paints a separate channel with real pencil/eraser/fill/gradient, cancel/undo, invert/disable/view and baked exports after reload', async ({ page }) => {
  test.setTimeout(120_000);
  const source = Buffer.from(Array.from({ length: 81 }, () => [255, 0, 0, 255]).flat()).toString('base64');
  const fixture = { format: 'pixprite', version: 6, name: 'Mask channel workflow', width: 9, height: 9,
    frames: [{ duration: 100 }, { duration: 120 }], images: [{ id: 'red-mask-source', w: 9, h: 9, d: source }],
    layers: [{ name: 'Linked red', lockAlpha: true, cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red-mask-source' } }, { link: 0 }] }] };
  await openFixture(page, fixture);
  const original = await pngPixels(page, await download(page, 'file.exportPng'));
  let dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Reveal all', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  await expect(page.getByTestId('mask-channel')).toHaveAttribute('data-active', 'true');
  await maskStroke(page, 'e');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(0);
  const hole = await pngPixels(page, await download(page, 'file.exportPng')); expect(hole.data[40 * 4 + 3]).toBe(0);
  await command(page, 'edit.undo'); await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(255);
  await command(page, 'edit.redo'); await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(0);
  const visual = await canvasFingerprint(page); await page.getByTestId('mask-view').click();
  await expect.poll(() => canvasFingerprint(page)).not.toBe(visual);
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(hole);
  // Pick effective mask white, restore the erased pixel, then cancel an eraser stroke.
  await maskStroke(page, 'i', 2, 2); await maskStroke(page, 'b');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(255);
  const beforeCancel = await documentNamed(page, fixture.name);
  const center = await maskPoint(page, 4, 4); await page.keyboard.press('e'); await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.keyboard.press('Escape'); await page.mouse.up(); await command(page, 'file.save');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(beforeCancel);
  // Fill the uniform mask with black, then paint a native white-to-black gradient.
  await page.locator('[data-i="0"]').click(); await page.getByTitle(/^Bucket \(G\)/).click();
  await page.mouse.click(center.x, center.y); await command(page, 'file.save');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).every(alpha => alpha === 0)).toBe(true);
  await page.locator('[data-i="7"]').click(); await page.locator('[data-i="0"]').click({ button: 'right' });
  await page.getByTitle(/^Bucket \(G\)/).click({ button: 'right' }); await page.getByText('Gradient', { exact: true }).click();
  const start = await maskPoint(page, 1, 4), end = await maskPoint(page, 7, 4);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
  await page.mouse.move(2, 2); await command(page, 'file.save');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).some(alpha => alpha > 0 && alpha < 255)).toBe(true);
  const gradientMask = await savedMaskAlpha(page, fixture.name), gradientExport = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(gradientExport.data.filter((_, i) => i % 4 === 3)).toEqual(gradientMask);
  dialog = await maskDialog(page); await dialog.getByRole('checkbox', { name: 'Invert mask', exact: true }).check();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  const inverted = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(inverted.data.filter((_, i) => i % 4 === 3)).toEqual(gradientMask.map(alpha => 255 - alpha));
  const committed: any = await documentNamed(page, fixture.name), resource = committed.layers[0].mask.image.id;
  dialog = await maskDialog(page); await dialog.getByRole('checkbox', { name: 'Enable mask', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(original);
  expect((await documentNamed(page, fixture.name) as any).layers[0].mask.image.id).toBe(resource);
  await command(page, 'edit.undo'); expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(inverted);
  const saved: any = await documentNamed(page, fixture.name);
  expect(saved.version).toBe(7); expect(saved.images.find((image: any) => image.id === 'red-mask-source').d).toBe(source);
  expect(saved.layers[0].cels).toEqual(fixture.layers[0].cels);
  await command(page, 'anim.next'); expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(inverted);
  // Reload only after the undo's debounced autosave commits the restored mask flags.
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.layers[0].mask).toMatchObject({ enabled: true, inverted: true });
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(inverted);
});

test('layer mask UI creates from selection, another layer alpha and chosen color, edits groups without touching children and backgrounds bake masks once', async ({ page }) => {
  test.setTimeout(120_000);
  const red = Buffer.from(Array.from({ length: 81 }, () => [255, 0, 0, 255]).flat()).toString('base64');
  const alpha = Buffer.from(Array.from({ length: 81 }, (_, i) => [0, 0, 255, i === 40 ? 128 : 0]).flat()).toString('base64');
  const fixture = { format: 'pixprite', version: 6, name: 'Mask factories and group', width: 9, height: 9,
    frames: [{ duration: 100 }], images: [{ id: 'red', w: 9, h: 9, d: red }, { id: 'alpha', w: 9, h: 9, d: alpha }],
    layers: [{ name: 'Red', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red' } }] },
      { name: 'Alpha source', visible: false, cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'alpha' } }] }] };
  await openFixture(page, fixture);
  await page.locator('[data-hit="layer"][data-l="0"]').click(); await command(page, 'select.all');
  let dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'From selection', exact: true }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click(); await command(page, 'select.none');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).every(alpha => alpha === 255)).toBe(true);
  dialog = await maskDialog(page); await dialog.getByTitle('Alpha source layer', { exact: true }).click(); await page.locator('div[data-disabled]').filter({ hasText: /^Alpha source$/ }).click();
  await dialog.getByRole('button', { name: 'From layer alpha', exact: true }).click(); await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(128);
  const alphaExport = await pngPixels(page, await download(page, 'file.exportPng')); expect(alphaExport.data.filter((_, i) => i % 4 === 3).filter(Boolean)).toEqual([128]);
  // Background conversion consumes the semitransparent mask exactly once.
  const before: any = await documentNamed(page, fixture.name);
  await command(page, 'layer.toBackground');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any).layers[0].mask).toBeUndefined();
  const background = await pngPixels(page, await download(page, 'file.exportPng'));
  expect(background.data.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
  await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
  // Color factory snapshots exact source RGB; choosing black matches none of the red layer.
  await page.locator('[data-i="0"]').click(); dialog = await maskDialog(page);
  await dialog.getByRole('button', { name: 'From primary color', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Invert mask', exact: true }).check(); await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).every(alpha => alpha === 0)).toBe(true);
  expect((await pngPixels(page, await download(page, 'file.exportPng'))).data.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
  // Build a group by selecting Red's row, so the existing child remains untouched by group painting.
  await page.locator('[data-hit="layer"][data-l="0"]').click(); await command(page, 'layer.newGroup');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any).layers.some((l: any) => l.group)).toBe(true);
  const groupDoc: any = await documentNamed(page, fixture.name); const group = groupDoc.layers.findIndex((l: any) => l.group);
  expect(groupDoc.layers[0].depth).toBe(1);
  dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Reveal all', exact: true }).click(); await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  const childPixels = (await documentNamed(page, fixture.name) as any).images.filter((image: any) => ['red', 'alpha'].includes(image.id));
  await maskStroke(page, 'e'); await expect.poll(async () => (await savedMaskAlpha(page, fixture.name, group))[40]).toBe(0);
  expect((await documentNamed(page, fixture.name) as any).images.filter((image: any) => ['red', 'alpha'].includes(image.id))).toEqual(childPixels);
  expect((await pngPixels(page, await download(page, 'file.exportPng'))).data[40 * 4 + 3]).toBe(0);

});

test('mask channel generic Delete/Cut/Copy/Paste ignores timeline ranges and never changes color cels or structure', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = { format: 'pixprite', version: 6, name: 'Mask command isolation', width: 9, height: 9,
    frames: [{ duration: 100 }, { duration: 120 }], images: [{ id: 'red', w: 9, h: 9, d: Buffer.from(Array.from({ length: 81 }, () => [255, 0, 0, 255]).flat()).toString('base64') }],
    layers: [{ name: 'Red', cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red' } }, { link: 0 }] }] };
  await openFixture(page, fixture);
  const cell = page.locator('[data-hit="cel"][data-l="0"][data-f="0"]');
  await cell.click(); await command(page, 'edit.copy'); // Store a color timeline clipboard first.
  const dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Reveal all', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  await cell.click(); await command(page, 'file.save');
  await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).length).toBe(81);
  const before: any = await documentNamed(page, fixture.name);
  await command(page, 'edit.paste'); await page.evaluate(() => document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })));
  await command(page, 'file.save'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
  for (const action of ['edit.clear', 'edit.cut']) {
    await cell.click(); await command(page, action);
    await expect.poll(async () => (await savedMaskAlpha(page, fixture.name)).every(alpha => alpha === 0)).toBe(true);
    const after: any = await documentNamed(page, fixture.name);
    expect(after.frames).toEqual(before.frames); expect(after.layers[0].cels).toEqual(before.layers[0].cels);
    expect(after.layers).toHaveLength(1); expect(after.images.find((image: any) => image.id === 'red')).toEqual(before.images.find((image: any) => image.id === 'red'));
    await command(page, 'edit.undo'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
  }
  await command(page, 'edit.copy'); await command(page, 'edit.paste'); await command(page, 'file.save');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before);
});

test('distant valid mask shows a painting-bounds notice without freezing hover, source/history or exports and replacement resumes painting', async ({ page }) => {
  const fixture = { format: 'pixprite', version: 7, name: 'Mask painting bounds', width: 9, height: 9,
    frames: [{ duration: 100 }], images: [
      { id: 'red', w: 9, h: 9, d: Buffer.from(Array.from({ length: 81 }, () => [255, 0, 0, 255]).flat()).toString('base64') },
      { id: 'distant-mask', w: 4096, h: 1, d: Buffer.from(Array.from({ length: 4096 }, () => [0, 0, 0, 255]).flat()).toString('base64') }],
    layers: [{ name: 'Red', mask: { image: { kind: 'image', id: 'distant-mask' }, x: 4096, y: 0, outside: 255, enabled: true, inverted: false },
      cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red' } }] }] };
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  await openFixture(page, fixture); const before = await documentNamed(page, fixture.name);
  let dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Mask painting unavailable' })).toBeVisible();
  const p = await maskPoint(page, 4, 4); await page.mouse.move(p.x, p.y); await maskStroke(page, 'b'); await maskStroke(page, 'e');
  await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before); expect(errors).toEqual([]);
  expect((await pngPixels(page, await download(page, 'file.exportPng'))).data.filter((_, i) => i % 4 === 3).every(a => a === 255)).toBe(true);
  await page.getByTestId('mask-view').click(); expect(errors).toEqual([]);
  dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Reveal all', exact: true }).click(); await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Mask painting unavailable' })).toHaveCount(0);
  await maskStroke(page, 'e'); await expect.poll(async () => (await savedMaskAlpha(page, fixture.name))[40]).toBe(0); expect(errors).toEqual([]);
});

test('mask resize preflight refuses oversized resource allocation atomically and channel controls allow leaving a layer without a mask', async ({ page }) => {
  const fixture = { format: 'pixprite', version: 7, name: 'Mask scaling preflight', width: 1, height: 1,
    frames: [{ duration: 100 }], images: [
      { id: 'red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') },
      { id: 'large-mask', w: 4096, h: 1, d: Buffer.from(Array.from({ length: 4096 }, () => [0, 0, 0, 255]).flat()).toString('base64') }],
    layers: [{ name: 'Red', mask: { image: { kind: 'image', id: 'large-mask' }, x: 0, y: 0, outside: 255, enabled: true, inverted: false },
      cels: [{ x: 0, y: 0, image: { kind: 'image', id: 'red' } }] }] };
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  await openFixture(page, fixture); const before = await documentNamed(page, fixture.name);
  await command(page, 'image.spriteSize');
  const resize = page.getByRole('dialog', { name: 'Scale image', exact: true });
  await resize.getByRole('checkbox', { name: 'Keep proportions', exact: true }).uncheck();
  await resize.getByRole('spinbutton').nth(0).fill('4096'); await resize.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(resize.getByRole('alert')).toHaveText('Resize would exceed mask limits (4096 pixels per side). Reduce the scale or replace the mask.');
  await resize.getByRole('button', { name: 'Cancel', exact: true }).click();
  await command(page, 'file.save'); await expect.poll(() => documentNamed(page, fixture.name)).toEqual(before); expect(errors).toEqual([]);
  let dialog = await maskDialog(page); await dialog.getByRole('button', { name: 'Edit mask', exact: true }).click();
  await command(page, 'layer.new');
  await expect(page.getByTestId('mask-channel')).toHaveText('Color channel'); await page.getByTestId('mask-channel').click();
  await page.keyboard.press('b'); const box = await page.getByTestId('sprite-canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2); await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any).layers[1]?.cels[0] ?? null).not.toBeNull(); expect(errors).toEqual([]);
});

test('timeline folding unions overlapping tags and independent manual ranges, reveals hidden goto/keyboard destinations and persists hidden current frames with source pixels intact', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = { format: 'pixprite', version: 7, name: 'Timeline folding overlap', width: 1, height: 1,
    frames: Array.from({ length: 12 }, (_, i) => ({ duration: 100 + i })),
    images: [{ id: 'fold-red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') },
      { id: 'fold-mask', w: 1, h: 1, d: Buffer.from([0, 0, 0, 128]).toString('base64') }],
    tags: [{ name: 'A', from: 1, to: 4, color: '#ff0000', direction: 'forward', collapsed: true },
      { name: 'B', from: 3, to: 6, color: '#00ff00', direction: 'forward', collapsed: true }],
    hiddenFrameRanges: [[5, 7], [10, 10]],
    layers: [{ name: 'Linked masked red', mask: { image: { kind: 'image', id: 'fold-mask' }, x: 0, y: 0, outside: 255, enabled: true, inverted: false },
      cels: Array.from({ length: 12 }, (_, i) => i ? { link: 0 } : { x: 0, y: 0, image: { kind: 'image', id: 'fold-red' } }) }] };
  await openFixture(page, fixture);
  await expect.poll(() => documentNamed(page, fixture.name)).not.toBeNull();
  const original: any = await documentNamed(page, fixture.name);
  const folds = () => page.locator('[data-fold-from]');
  await expect(folds()).toHaveCount(2); await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯7');
  const exported = await pngPixels(page, await download(page, 'file.exportPng'));
  await command(page, 'anim.play');
  await expect(page.locator('[data-fold-from="1"][data-current=true]')).toBeVisible();
  await command(page, 'anim.play');
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯7');
  await page.locator('[data-hit="frame"][data-f="0"]').click();
  await page.getByTitle(/^A: frames/).click({ button: 'right' });
  await page.getByText('Expand tag', { exact: true }).click();
  await expect(page.locator('[data-fold-from="3"]')).toHaveText('⋯5'); // B and manual range still hide their own frames.
  await page.getByRole('button', { name: 'Collapse tag: A', exact: true }).click();
  await page.locator('[data-hit="frame"][data-f="8"]').click();
  await page.locator('[data-hit="frame"][data-f="9"]').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Collapse frames', exact: true }).click();
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯10');
  await command(page, 'anim.goto');
  let go = page.getByRole('dialog', { name: 'Go to frame', exact: true });
  await go.getByRole('spinbutton').fill('6'); await go.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('[data-hit="frame"][data-f="5"]')).toHaveAttribute('data-current', 'true');
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯4');
  await expect(page.locator('[data-fold-from="8"]')).toHaveText('⋯3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-hit="frame"][data-f="4"]')).toHaveAttribute('data-current', 'true');
  await expect(page.locator('[data-fold-from="1"]')).toHaveCount(0);
  // A real cel click still selects original frame 7 after the removed columns.
  await page.locator('[data-hit="cel"][data-l="0"][data-f="7"]').click();
  await expect(page.locator('[data-hit="frame"][data-f="7"]')).toHaveAttribute('data-current', 'true');
  await page.locator('[data-hit="frame"][data-f="7"]').click({ button: 'right' });
  await page.getByText('Frame timing…', { exact: true }).click();
  const timing = page.getByRole('dialog', { name: 'Frame timing', exact: true });
  await expect(timing.getByRole('spinbutton').first()).toHaveValue('107');
  await timing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('ArrowRight'); // Reveals manual range 8..9, leaving independent frame 10 folded.
  await expect(page.locator('[data-hit="frame"][data-f="8"]')).toHaveAttribute('data-current', 'true');
  await expect(page.locator('[data-fold-from="10"]')).toHaveText('⋯1');
  await page.getByRole('button', { name: 'Collapse frames', exact: true }).click();
  await expect(page.locator('[data-fold-from="8"][data-current=true]')).toHaveText('⋯1');
  await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.hiddenFrameRanges).toEqual([[10, 10], [8, 8]]);
  const saved: any = await documentNamed(page, fixture.name);
  expect(saved.images).toEqual(original.images); expect(saved.layers[0].cels).toEqual(fixture.layers[0].cels);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-fold-from="8"][data-current=true]')).toHaveText('⋯1');
  expect(await pngPixels(page, await download(page, 'file.exportPng'))).toEqual(exported);
  // Same-frame reveal must persist even though the frame signal itself does not change.
  await command(page, 'anim.goto');
  go = page.getByRole('dialog', { name: 'Go to frame', exact: true });
  await go.getByRole('spinbutton').fill('9'); await go.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('[data-hit="frame"][data-f="8"]')).toHaveAttribute('data-current', 'true');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.hiddenFrameRanges).toEqual([[10, 10]]);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-hit="frame"][data-f="8"]')).toHaveAttribute('data-current', 'true');
  await page.locator('[data-fold-from="10"]').focus(); await page.keyboard.press('Enter');
  await expect(folds()).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯6');
  await page.getByRole('button', { name: 'Expand all', exact: true }).click(); await expect(folds()).toHaveCount(0);
  await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.hiddenFrameRanges).toEqual([]);
  const final: any = await documentNamed(page, fixture.name);
  expect(final.images).toEqual(original.images); expect(final.layers[0]).toEqual(saved.layers[0]); expect(final.frames).toEqual(fixture.frames);
  // Resize after collapse has fully saved: tag metadata must independently dirty the document.
  await page.getByRole('button', { name: 'Collapse tag: A', exact: true }).click();
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.tags[0]).toMatchObject({ from: 1, to: 4, collapsed: true });
  const tagBox = await page.getByTitle(/^A: frames/).boundingBox();
  const cellBox = await page.locator('[data-hit="frame"][data-f="0"]').boundingBox();
  await page.mouse.move(tagBox!.x + tagBox!.width - 1, tagBox!.y + tagBox!.height / 2); await page.mouse.down();
  await page.mouse.move(tagBox!.x + tagBox!.width - 1 + cellBox!.width, tagBox!.y + tagBox!.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯5');
  await expect.poll(async () => (await documentNamed(page, fixture.name) as any)?.tags[0].to).toBe(5);
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-fold-from="1"]')).toHaveText('⋯5');
});

test('large folded timeline keeps bounded cells, reaches the original last frame and pointer moves/selects across compressed columns by original indices', async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = { format: 'pixprite', version: 7, name: 'Large timeline folding', width: 1, height: 1,
    frames: Array.from({ length: 1000 }, (_, i) => ({ duration: 100 + i })),
    images: [{ id: 'large-fold-red', w: 1, h: 1, d: Buffer.from([255, 0, 0, 255]).toString('base64') }],
    hiddenFrameRanges: [[2, 500], [700, 900]],
    layers: Array.from({ length: 100 }, (_, l) => ({ name: 'Layer ' + l,
      cels: Array.from({ length: 1000 }, (_, i) => i ? { link: 0 } : { x: 0, y: 0, image: { kind: 'image', id: 'large-fold-red' } }) })) };
  await openFixture(page, fixture);
  await expect(page.locator('[data-fold-from="2"]')).toHaveText('⋯499');
  const count = await page.locator('[data-hit="cel"], [data-folded-frames]').count(); expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(1200);
  const h1 = page.locator('[data-hit="frame"][data-f="1"]'), h502 = page.locator('[data-hit="frame"][data-f="502"]');
  const a = await h1.boundingBox(), b = await h502.boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(b!.x - a!.x).toBeCloseTo(a!.width * 3, 0);
  // Shift-click a distant original frame that is only two visible columns away.
  await h1.click(); await h502.click({ modifiers: ['Shift'] }); await command(page, 'file.save');
  // Header styling asserts the original contiguous selection covers both visible sides of the fold.
  await expect(page.locator('[data-hit="frame"][data-f="501"]')).toHaveAttribute('data-selected', 'true');
  await h1.click(); // Reduces the selected range to the single source frame.
  const before = await h1.boundingBox(), destination = await h502.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2); await page.mouse.down();
  await page.mouse.move(destination!.x + destination!.width / 4, destination!.y + destination!.height / 2, { steps: 8 }); await page.mouse.up();
  await command(page, 'file.save');
  await expect.poll(async () => (await documentNamed(page, fixture.name))?.frames.slice(498, 504).map(f => f.duration)).toEqual([599, 600, 601, 101, 602, 603]);
  const moved: any = await documentNamed(page, fixture.name);
  expect(moved.hiddenFrameRanges).toEqual([[1, 499], [700, 900]]);
  expect(moved.images).toEqual(fixture.images); expect(moved.layers[0].cels).toEqual(fixture.layers[0].cels);
  await page.keyboard.press('End');
  await expect(page.locator('[data-hit="frame"][data-f="999"]')).toBeVisible();
  await expect(page.locator('[data-hit="frame"][data-f="999"]')).toHaveAttribute('data-current', 'true');
  expect(await page.locator('[data-hit="cel"], [data-folded-frames]').count()).toBeLessThan(1200);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('[data-hit="frame"][data-f="999"]')).toBeVisible();
  expect(await page.locator('[data-hit="cel"], [data-folded-frames]').count()).toBeLessThan(1200);
  await page.keyboard.press('Home'); await expect(page.locator('[data-hit="frame"][data-f="0"]')).toBeVisible();
});
