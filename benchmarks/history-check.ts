/** Optimized browser checks for history controls, cancellation and ownership release. */
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
await build({ configFile: resolve(import.meta.dir, 'vite.config.ts'), logLevel: 'warn' });
const root = resolve(import.meta.dir, '../dist/benchmarks');
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = resolve(root, '.' + new URL(request.url).pathname);
  if (!path.startsWith(root + sep)) return new Response('', { status: 403 });
  const file = Bun.file(path);
  return file.exists().then(exists => exists ? new Response(file) : new Response('Not found', { status: 404 }));
} });
const browser = await chromium.launch();
const results: unknown[] = [];
try {
  for (const budget of ['operation', 'bytes']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', autosave: false })));
    await page.goto(`http://127.0.0.1:${server.port}/benchmarks/history.html`);
    await page.getByRole('button', { name: 'Custom size…', exact: true }).waitFor();
    const api = (method: string, ...args: unknown[]) => page.evaluate(([method, args]) => (window as any).historyCheck[method](...args), [method, args] as const);
    expect(await api('onionOwnership')).toBe(true);
    const original = await api('install', budget);
    const box = await page.getByTestId('sprite-canvas').boundingBox();
    if (!box) throw new Error('Missing canvas');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 3 });
    await expect.poll(() => api('status')).toMatchObject({ guards: 1, undo: 1 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect.poll(() => api('status')).toMatchObject({ pixels: original, guards: 0, undo: 0, redo: 0 });
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 20); await page.mouse.up();
    await expect.poll(() => api('status')).toMatchObject({ guards: 0, undo: 0, redo: 0, notice: budget === 'bytes' ? 'memory' : 'operation' });
    expect((await api('status')).pixels).not.toBe(original);
    await expect(page.getByRole('status').filter({ hasText: budget === 'bytes' ? 'shortened' : 'exceeded' })).toBeVisible();
    await api('history');
    const dialog = page.getByRole('dialog', { name: 'History', exact: true });
    await expect(dialog.getByText('Retained history starts here', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Per-operation limit', { exact: true })).toBeVisible();
    await dialog.getByRole('spinbutton').nth(2).fill('2');
    await expect(dialog.getByRole('spinbutton').nth(2)).toHaveValue('2');
    await dialog.getByRole('spinbutton').nth(2).fill(budget === 'operation' ? '.000001' : '0');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await api('transactionFailure')).toBe(true);
    const closed = await api('close');
    expect(closed).toEqual({ home: true, docs: 0, cache: 0, transactions: 0 });
    const cdp = await page.context().newCDPSession(page);
    // Each dereference is a separate task from the next GC; no live CDP handles retain the target.
    try {
      await expect.poll(async () => { await cdp.send('HeapProfiler.collectGarbage'); return api('collected'); }, { timeout: 10000 }).toEqual({ document: true, snapshot: true });
    } catch (error) {
      await mkdir('dist/reports/benchmarks/history', { recursive: true });
      const chunks: string[] = [];
      cdp.on('HeapProfiler.addHeapSnapshotChunk', event => chunks.push(event.chunk));
      await cdp.send('HeapProfiler.takeHeapSnapshot');
      await writeFile('dist/reports/benchmarks/history/retained.heapsnapshot', chunks.join(''));
      throw error;
    }
    expect(errors).toEqual([]);
    results.push({ budget, strokeEscape: true, committedBarrier: true, controls: true, onionOwnership: true, failedExtensionTransaction: true, extensionDeactivation: true, closed, gc: await api('collected') });
    await page.close();
  }
  await mkdir('dist/reports/benchmarks/history', { recursive: true });
  await writeFile('dist/reports/benchmarks/history/checks.json', JSON.stringify({ results }, null, 2) + '\n');
  console.log('History memory browser checks passed:', JSON.stringify(results));
} finally { await browser.close(); server.stop(true); }
