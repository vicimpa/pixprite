import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inspectBundle } from '../scripts/bundle-graph';

test.use({ serviceWorkers: 'block' });
let report: Awaited<ReturnType<typeof inspectBundle>>;
test.beforeAll(async () => { report = await inspectBundle(); });

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused();
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toBeHidden();
}
async function preferences(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] })));
}
async function boot(page: Page) {
  await preferences(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
}
async function create(page: Page) {
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await page.getByRole('dialog', { name: 'New sprite', exact: true }).getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

test('the HTML startup animation remains visible while the single browser bundle loads', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/' + report.initial[0], async route => { await gate; await route.continue(); });
  await preferences(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#startup-screen')).toBeVisible();
  await expect(page.locator('#root')).toBeEmpty();
  await expect(page.locator('.startup-track')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
});

test('a failed initial bundle offers a working reload button', async ({ page }) => {
  let failed = false;
  await page.route('**/' + report.initial[0], async route => {
    if (!failed) { failed = true; await route.abort(); } else await route.continue();
  });
  await preferences(page);
  await page.goto('/');
  await expect(page.getByRole('alert', { name: 'Could not start Pixprite' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
});

test('all UI and format modules are in one bundle and work offline without loading placeholders', async ({ page, context }) => {
  // Exercise the bundled computation fallback as well; workers are separate by design.
  await page.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined }));
  const requests = new Set<string>();
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.endsWith('.js')) requests.add(path); });
  await boot(page);
  expect([...requests]).toEqual(['/' + report.initial[0]]);
  const loading = await page.evaluateHandle(() => {
    const seen: string[] = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const element of [node, ...node.querySelectorAll('[role="status"], [role="dialog"]')])
          if (element.matches('[role="dialog"][aria-label="Loading…"]') || element.matches('[role="status"]') && element.textContent === 'Loading…') seen.push(element.outerHTML);
      }
    }).observe(document.body, { childList: true, subtree: true });
    return seen;
  });
  await context.setOffline(true);
  await create(page);
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-home]').click();
    await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
    await page.locator('[draggable=true][data-active]').click();
    await expect(page.getByTestId('sprite-canvas')).toBeVisible();
    for (const [id, title] of [['edit.prefs', 'Preferences'], ['help.about', 'About Pixprite'], ['extensions.openInstalled', 'Extensions'], ['image.colorMode', 'Color mode (now rgb)']]) {
      await command(page, id);
      await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
  const png = page.waitForEvent('download');
  await command(page, 'file.exportPng');
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: 'Bundled.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') });
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Bundled · 1×1');
  expect(await loading.jsonValue()).toEqual([]);
  await loading.dispose();
  expect([...requests]).toEqual(['/' + report.initial[0]]);
});

test('bundled WebM recorder downloads a valid container', async ({ page }) => {
  await boot(page);
  await create(page);
  await command(page, 'file.export');
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'PNG, current frame', exact: true }).click();
  await page.getByText('WebM video', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toMatch(/\.webm$/);
  const bytes = await readFile((await result.path())!);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  expect(bytes.length).toBeGreaterThan(100);
});
