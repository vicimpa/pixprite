import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const scopePath = () => `/__e2e__/pwa/${crypto.randomUUID()}/`;
const control = (request: APIRequestContext, path: string, deploy: 'a' | 'b', fault?: string) =>
  request.post(path.replace('/pwa/', '/pwa-control/').replace(/\/$/, ''), { data: { deploy, fault } });

async function boot(page: Page, path: string) {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] })));
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
}

async function installed(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
}

const build = (page: Page) => page.locator('meta[name=fixture-build]').getAttribute('content');
const cacheKeys = (page: Page) => page.evaluate(() => caches.keys());
const ownCaches = async (page: Page, path: string) => (await cacheKeys(page)).filter(key => key.startsWith(`pixprite:http://127.0.0.1:4173${path}:`));

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused();
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toBeHidden();
}

async function create(page: Page, name: string) {
  await command(page, 'file.new');
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

async function session(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pixprite');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['sessions', 'resources']);
      const all = (name: string) => new Promise<unknown[]>(resolve => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
      return await Promise.all([all('sessions'), all('resources')]);
    } finally { db.close(); }
  });
}

async function paint(page: Page) {
  await page.keyboard.press('b');
  const box = (await page.getByTestId('sprite-canvas').boundingBox())!;
  const before = JSON.stringify(await session(page));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await session(page))).not.toBe(before);
  // A complete autosave is observable via the regular PNG export, then a pagehide flush.
  const pending = page.waitForEvent('download');
  await command(page, 'file.exportPng');
  const pixels = await readFile((await (await pending).path())!);
  await page.evaluate(() => dispatchEvent(new Event('beforeunload')));
  return pixels.toString('base64');
}

for (const fallback of [false, true]) {
  test(`first install after window load, controlled reopening and never-used features offline (${fallback ? 'fallback' : 'worker'})`, async ({ page, context, request }) => {
    const path = scopePath();
    if (fallback) await page.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined }));
    await boot(page, path);
    // Fixture starts the unmodified production entry from window.load: registration must still run.
    expect(await page.evaluate(() => document.readyState)).toBe('complete');
    await installed(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    const keys = await ownCaches(page, path);
    expect(keys).toHaveLength(1);
    const cached = await page.evaluate(async key => (await (await caches.open(key)).keys()).map(r => new URL(r.url).pathname), keys[0]);
    const revision = keys[0].split(':').at(-1);
    const manifest = await (await request.get(path + `precache-${revision}.json`)).json() as [string, string][];
    expect([...cached].sort()).toEqual(manifest.map(([file]) => path + file).sort());
    expect(cached.some(url => url.includes('compute.worker-'))).toBe(true);
    expect(cached.some(url => url.endsWith('.woff2'))).toBe(true);
    expect(cached.filter(url => url.endsWith('.js') && !url.endsWith('/sw.js'))).toHaveLength(2);
    // UI and codecs live in the browser entry; the self-contained worker is separate.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await create(page, 'First offline');
    await paint(page);
    await command(page, 'image.colorMode');
    await expect(page.getByRole('dialog', { name: 'Color mode (now rgb)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await command(page, 'file.export');
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await dialog.getByRole('button', { name: 'PNG, current frame', exact: true }).click();
    await page.getByText('GIF animation', { exact: true }).click();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const gif = await readFile((await (await download).path())!);
    expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
    const chooser = page.waitForEvent('filechooser');
    await command(page, 'file.open');
    await (await chooser).setFiles({ name: 'Offline import.gif', mimeType: 'image/gif', buffer: gif });
    await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Offline import · 32×32');
    await expect.poll(async () => JSON.stringify(await session(page))).toContain('Offline import');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:session') ?? '{}').tabs?.length)).toBe(2);
    await page.reload();
    await expect(page.locator('[draggable=true]')).toHaveCount(2);
  });
}

test('new deploy waits for every old tab, pins HTML/assets, preserves unsaved projects and cleans only this scope', async ({ page, context, request }) => {
  const path = scopePath();
  await boot(page, path);
  await installed(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
  await create(page, 'Unsaved A');
  const pixels = await paint(page);
  await create(page, 'Unsaved B');
  await paint(page);
  const original = await session(page);
  const oldKeys = await ownCaches(page, path);
  const siblingPath = scopePath();
  const sibling = await context.newPage();
  await sibling.goto(siblingPath);
  await expect(sibling.getByTestId('sprite-canvas')).toBeVisible();
  await installed(sibling);
  const sentinels = ['another-app-v1', ...await ownCaches(sibling, siblingPath)];
  await sibling.close();
  await page.evaluate(async names => { for (const name of names) await (await caches.open(name)).put('/sentinel', new Response(name)); }, sentinels);
  const other = await context.newPage();
  await other.goto(path);
  await expect(other.getByTestId('sprite-canvas')).toBeVisible();
  await expect.poll(() => session(page)).toEqual(original);
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await control(request, path, 'b');
  // Origin really serves a different HTML and different asset URLs; old URLs are gone.
  const html = await (await request.get(path)).text();
  expect(html).toContain('content="b"');
  expect(html).toContain('assets-b/');
  const oldAsset = await page.evaluate(async key => (await (await caches.open(key)).keys()).find(r => /\/assets-a\/index-.*\.js$/.test(r.url))!.url, oldKeys[0]);
  expect((await request.get(oldAsset)).status()).toBe(404);
  // A foreign cache with stale bytes at a new-release URL must never override B's own snapshot.
  const staleUrl = oldAsset.replace('/assets-a/', '/assets-b/');
  await page.evaluate(async ({ name, url }) => { await (await caches.open(name)).put(url, new Response('throw new Error("stale foreign cache")', { headers: { 'Content-Type': 'text/javascript' } })); }, { name: sentinels[0], url: staleUrl });
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  expect(navigations).toBe(0);
  expect(await build(page)).toBe('a');
  expect(await session(page)).toEqual(original);
  // Server B + cache A returns coherent A, including a not-yet-executed dialog.
  await command(page, 'image.colorMode');
  await expect(page.getByRole('dialog', { name: 'Color mode (now rgb)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await build(page)).toBe('a');
  expect(await session(page)).toEqual(original);
  await page.close();
  expect(await other.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
  // One remaining controlled client keeps A and its complete snapshot alive.
  expect(await ownCaches(other, path)).toContain(oldKeys[0]);
  await other.close();
  // Inspect from outside the scope without creating another old controlled client.
  const observer = await context.newPage();
  await observer.goto('/favicon.svg');
  await expect.poll(async () => (await ownCaches(observer, path)).length).toBe(1);
  expect(await ownCaches(observer, path)).not.toContain(oldKeys[0]);
  expect(await cacheKeys(observer)).toEqual(expect.arrayContaining(sentinels));
  expect(await observer.evaluate(async names => Promise.all(names.map(async name => (await (await caches.open(name)).match('/sentinel'))?.text())), sentinels)).toEqual(sentinels);
  const reopened = await context.newPage();
  await reopened.goto(path + 'index.html');
  await expect(reopened.getByTestId('sprite-canvas')).toBeVisible();
  expect(await build(reopened)).toBe('b');
  expect(await session(reopened)).toEqual(original);
  await command(reopened, 'file.new');
  await expect(reopened.getByRole('dialog', { name: 'New sprite', exact: true })).toBeVisible();
  await reopened.keyboard.press('Escape');
  await reopened.locator('[draggable=true][title="Unsaved A · 32×32"]').click();
  const download = reopened.waitForEvent('download');
  await command(reopened, 'file.exportPng');
  expect((await readFile((await (await download).path())!)).toString('base64')).toBe(pixels);
  await context.setOffline(true);
  await reopened.reload();
  await expect(reopened.getByTestId('sprite-canvas')).toBeVisible();
  expect(await build(reopened)).toBe('b');
  expect(await session(reopened)).toEqual(original);
});

for (const fault of ['missing', 'html', 'asset', 'manifest']) {
  test(`failed ${fault} precache rolls back completely and preserves the previous release`, async ({ page, context, request }) => {
    const path = scopePath();
    await boot(page, path);
    await installed(page);
    await page.reload();
    const oldKeys = await ownCaches(page, path);
    await control(request, path, 'b', fault);
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const result = new Promise<string>(resolve => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing!;
          worker.addEventListener('statechange', () => { if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state); });
        }, { once: true });
      });
      await registration.update();
      return result;
    });
    expect(state).toBe('redundant');
    expect(await ownCaches(page, path)).toEqual(oldKeys);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
    expect(await build(page)).toBe('a');
    await create(page, 'Still usable');
    await context.setOffline(false);
    await control(request, path, 'b');
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
    expect(await ownCaches(page, path)).toHaveLength(2);
  });
}
