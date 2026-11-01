import { expect, test } from '@playwright/test';

test('installed TSX widget uses the editor-provided React kit and disappears on removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/react-widget/registry.json'] }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  async function command(id: string) {
    // Keyboard events in an opaque iframe stay in that frame.
    await page.getByRole('menuitem', { name: 'File', exact: true }).focus();
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('Type a command… (= calculates)').fill(id);
    await page.locator(`[data-command="${id}"]`).click();
  }
  await command('extensions.openStore');
  const store = page.getByRole('dialog');
  await store.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await store.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(store.getByText('Running', { exact: true })).toBeVisible();
  await store.getByRole('button', { name: 'Close', exact: true }).click();
  const widget = page.frameLocator('iframe[title="template/counter"]');
  await widget.getByRole('button', { name: 'Clicks: 0', exact: true }).click();
  await expect(widget.getByRole('button', { name: 'Clicks: 1', exact: true })).toBeVisible();
  // Toolbar widgets live in the narrow vertical tool strip.
  await expect.poll(() => widget.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('iframe[title="template/counter"]').getAttribute('sandbox')).toBe('allow-scripts');
  await command('extensions.openInstalled');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('iframe[title="template/counter"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
