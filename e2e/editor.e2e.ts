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
  const writes = await page.evaluate(() => window.sessionWrites);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.sessionWrites)).toBeGreaterThan(writes);
}

async function documentNamed(page: Page, name: string): Promise<DocumentData | null> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pixprite');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<DocumentData | null>((resolve, reject) => {
        const r = db.transaction('sessions').objectStore('sessions').getAll();
        r.onsuccess = () => resolve(r.result.find(v => v?.format === 'pixprite' && v.name === name) ?? null);
        r.onerror = () => reject(r.error);
      });
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

test('offline reload and service worker deployment preserve unsaved work', async ({ page, context, request }) => {
  await create(page, 'Offline');
  await draw(page);
  await assertPainted(page, 'Offline');
  const before = await documentNamed(page, 'Offline');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  // A controlled reload caches all imported production chunks, fonts, and workers.
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
  const edited = await documentNamed(page, 'Offline');
  await request.post('/__e2e__/deploy');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const replaced = new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    await registration.update();
    await replaced;
  });
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await page.reload();
  await expect.poll(() => documentNamed(page, 'Offline')).toEqual(edited);
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
