import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { command, exportPixels, pixelPosition } from './drawing-helper';

async function reopen(page: Page, name: string, buffer: Buffer, home = false) {
  const chooser = page.waitForEvent('filechooser'); await command(page, 'file.open');
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
  if (home) await page.locator('[data-key^="p:"]', { hasText: 'Midnight beacon' }).dblclick();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[data-hit="frame"]')).toHaveCount(8);
  await expect(page.locator('[data-hit="layer"]')).toHaveCount(5);
}

test('release: existing v5 project edits, saves, restores and round-trips PNG/pixprite/aseprite', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
  await page.goto('/');
  await reopen(page, 'beacon.pixprite', await readFile(new URL('../docs/assets/beacon.pixprite', import.meta.url)), true);
  // The fixture's 0.45 layer opacity isn't representable in Aseprite's byte
  // channel. Edit it to 115/255 through the UI before taking exact PNG references.
  await page.locator('[data-hit="layer"]', { hasText: 'Beacon & reflections' }).click();
  await command(page, 'layer.properties');
  const properties = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  await expect(properties.getByRole('spinbutton')).toHaveValue('115');
  await properties.getByRole('spinbutton').fill('115');
  await properties.getByRole('button', { name: 'OK', exact: true }).click();
  const before = await exportPixels(page);
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const at = await pixelPosition(page, 2, 2, 128, 96); await page.mouse.click(at.x, at.y);
  const after = await exportPixels(page); expect(after).not.toEqual(before);
  await command(page, 'file.save');
  await expect(page.getByText(/^Saved: /)).toBeVisible();
  await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await exportPixels(page)).toEqual(after);

  for (const format of ['pixprite', 'aseprite']) {
    await command(page, 'file.download');
    const dialog = page.getByRole('dialog', { name: 'Download a copy', exact: true });
    if (format === 'aseprite') {
      await dialog.getByRole('button', { name: 'Pixprite project (.pixprite)', exact: true }).click();
      await page.getByRole('option', { name: 'Aseprite file (.aseprite)', exact: true }).click();
    }
    const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    const file = await download; expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    await expect(dialog).toBeHidden();
    const tabs = await page.locator('[draggable=true][data-active]').count();
    await reopen(page, `release-check.${format}`, await readFile((await file.path())!));
    await expect(page.locator('[draggable=true][data-active]')).toHaveCount(tabs + 1);
    expect(await exportPixels(page)).toEqual(after);
  }
});
