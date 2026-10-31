/** Capture the real production editor with the original documentation example. */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dir, '../dist/web');
if (!await Bun.file(resolve(root, 'index.html')).exists()) throw new Error('Run bun run build first');
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
  },
});
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() => {
      localStorage.setItem('pixprite:prefs', JSON.stringify({
        language: 'en', keyStyle: 'pc', theme: 'dusk', uiSize: 'medium', uiFont: 'system',
        extensionCatalogs: [], autosave: false, pixelGridColor: '#00000000',
      }));
      localStorage.setItem('pixprite:editor', JSON.stringify({ layout: { timelineSize: 240 } }));
    });
    const origin = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin + '/');
    await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Open file…/ }).click();
    await (await chooser).setFiles(resolve(import.meta.dir, '../docs/assets/beacon.pixprite'));
    await page.getByText('Midnight beacon', { exact: true }).dblclick();
    await expect(page.getByTestId('sprite-canvas')).toBeVisible();
    await page.keyboard.press('Control+0');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByText('1 projects added', { exact: true })).toBeHidden();
    await page.mouse.move(0, 0);
    // fitSmooth animates the camera; let it finish before the documentation capture.
    await page.waitForTimeout(700);
    await mkdir(resolve(import.meta.dir, '../docs/assets'), { recursive: true });
    await page.screenshot({ path: resolve(import.meta.dir, '../docs/assets/editor.png'), animations: 'disabled' });
    console.log('Saved docs/assets/editor.png');
  } finally { await browser.close(); }
} finally { server.stop(true); }
