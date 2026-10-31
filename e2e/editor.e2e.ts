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
  expect(saved).toMatchObject({ images: [{ id: 'shared-source', d: source }], layers: [{ effects: fixture.layers[0].effects }] });
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
