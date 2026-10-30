import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inspectBundle } from '../scripts/bundle-graph';

// Observe every request directly, without a SW cache hiding eager imports.
test.use({ serviceWorkers: 'block' });
let report: Awaited<ReturnType<typeof inspectBundle>>;
test.beforeAll(async () => { report = await inspectBundle(); });
const chunk = (source: string) => '/' + report.boundaries[source];

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused();
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toBeHidden();
}

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] }));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
}

async function create(page: Page) {
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await page.getByRole('dialog', { name: 'New sprite', exact: true }).getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

test('Home, editor, dialogs, store and individual formats request only their demand chunks', async ({ page }) => {
  const requests = new Set<string>();
  page.on('request', request => requests.add(new URL(request.url()).pathname));
  await boot(page);
  // Manifest assertions also inspect the full module membership of the static closures.
  for (const file of Object.values(report.boundaries)) expect(requests.has('/' + file), file).toBe(false);
  expect(requests.has('/' + report.home.find(f => f.includes('UiHost'))!)).toBe(true);

  await create(page);
  expect(requests.has(chunk('modules/Editor/EditorWorkspace.tsx'))).toBe(true);
  expect(requests.has(chunk('modules/Dialogs/NewSprite.tsx'))).toBe(true);
  for (const source of ['modules/Dialogs/Common.tsx', 'modules/Dialogs/Filters.tsx', 'modules/Extensions/Extensions.tsx'])
    expect(requests.has(chunk(source)), source).toBe(false);

  await command(page, 'image.colorMode');
  await expect(page.getByRole('dialog', { name: 'Color mode (now rgb)' })).toBeVisible();
  expect(requests.has(chunk('modules/Dialogs/ColorMode.tsx'))).toBe(true);
  expect(requests.has(chunk('modules/Dialogs/Filters.tsx'))).toBe(false);
  await page.keyboard.press('Escape');

  await command(page, 'extensions.openStore');
  const store = page.getByRole('dialog', { name: 'Extensions', exact: true });
  await expect(store).toBeVisible();
  await expect(store.getByText('E2E permissions', { exact: false })).toBeVisible();
  expect(requests.has(chunk('modules/Extensions/Extensions.tsx'))).toBe(true);
  await page.keyboard.press('Escape');

  const png = page.waitForEvent('download');
  await command(page, 'file.exportPng');
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  const workerGraph = JSON.parse(await readFile('dist/.vite/worker-graph.json', 'utf8')) as { chunks: { file: string; modules: string[] }[] };
  const workerExport = workerGraph.chunks.find(c => c.modules.includes('src/core/ExportPreparation.ts'))!;
  await expect.poll(() => requests.has('/' + workerExport.file)).toBe(true);
  for (const source of ['core/formats/Aseprite.ts', 'core/formats/Apng.ts', 'core/Gif.ts', 'core/formats/Ico.ts', 'core/formats/Webm.ts', 'core/formats/GifDecode.ts'])
    expect(requests.has(chunk(source)), source).toBe(false);

  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: 'Demand.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') });
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Demand · 1×1');
  expect(requests.has(chunk('core/formats/GifDecode.ts'))).toBe(true);
  for (const source of ['core/formats/Aseprite.ts', 'core/formats/Apng.ts', 'core/Gif.ts', 'core/formats/Webm.ts'])
    expect(requests.has(chunk(source)), source).toBe(false);
});

test('a pending dialog is modal, stays responsive and Escape cancels it before the chunk resolves', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**' + chunk('modules/Dialogs/NewSprite.tsx'), async route => { await gate; await route.continue(); });
  await boot(page);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Loading…', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Type a command… (= calculates)')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('/assets/NewSprite-')))).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await create(page);
});

test('an uncached dialog failing offline reports an error and retries after reconnect', async ({ page, context }) => {
  await boot(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  const error = page.getByRole('dialog', { name: 'Could not open', exact: true });
  await expect(error).toBeVisible();
  await expect(error.getByRole('alert')).toBeVisible();
  await context.setOffline(false);
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New sprite', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'New sprite', exact: true }).getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
});


test('a failed editor chunk keeps the shell responsive and can retry without losing the new document', async ({ page }) => {
  let failed = false;
  await page.route('**' + chunk('modules/Editor/EditorWorkspace.tsx'), async route => {
    if (!failed) { failed = true; await route.abort(); }
    else await route.continue();
  });
  await boot(page);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('textbox').fill('Chunk retry');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: 'Could not open' });
  await expect(error).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Chunk retry · 32×32');
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Chunk retry · 32×32');
});

test('WebM export loads its own recorder only when selected and downloads a valid container', async ({ page }) => {
  const requests = new Set<string>();
  page.on('request', request => requests.add(new URL(request.url()).pathname));
  await boot(page);
  await create(page);
  await command(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog).toBeVisible();
  expect(requests.has(chunk('core/formats/Webm.ts'))).toBe(false);
  await dialog.getByRole('button', { name: 'PNG, current frame', exact: true }).click();
  await page.getByText('WebM video', { exact: true }).click();
  expect(requests.has(chunk('core/formats/Webm.ts'))).toBe(false);
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toMatch(/\.webm$/);
  const bytes = await readFile((await result.path())!);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  expect(bytes.length).toBeGreaterThan(100);
  expect(requests.has(chunk('core/formats/Webm.ts'))).toBe(true);
  for (const source of ['core/Gif.ts', 'core/formats/Apng.ts', 'core/formats/Ico.ts'])
    expect(requests.has(chunk(source)), source).toBe(false);
});
