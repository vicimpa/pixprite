import { expect, test, type Page } from '@playwright/test';
async function command(page: Page, id: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toHaveValue(''); await field.fill(id);
  await page.locator(`[data-command="${id}"]`).click();
}
test('category/tag search and version history install a compatible version, downgrade and restore offline', async ({ page }) => {
  await page.addInitScript(() => { if (window === top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/versioned/registry.json'] })); });
  await page.goto('/'); await command(page, 'extensions.openStore');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'Tools', exact: true }).click();
  await dialog.getByPlaceholder('Search extensions').fill('drawing');
  await expect(dialog.getByText('Data theme', { exact: true })).toHaveCount(0);
  const version = dialog.getByRole('button', { name: 'Version of Versioned tool', exact: true });
  await expect(version).toHaveText('2.0.0');
  await version.click(); await page.getByRole('option', { name: '3.0.0', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
  await version.click(); await page.getByRole('option', { name: '2.0.0', exact: true }).click();
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await version.click(); await page.getByRole('option', { name: '1.0.0', exact: true }).click();
  await dialog.getByRole('button', { name: 'Install 1.0.0', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await dialog.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(dialog.getByText('Running', { exact: true })).toBeVisible();
  await page.route('**/__e2e__/versioned/**', route => route.abort());
  await dialog.getByRole('button', { name: 'Restore 2.0.0', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Restore 1.0.0', exact: true })).toBeVisible();
  await expect(dialog.getByText('Running', { exact: true })).toBeVisible();
});
