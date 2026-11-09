import { expect, test, type Page } from '@playwright/test';
import { command, createDrawing, exportPixels, pointer } from './drawing-helper';

const more = 'More brush settings: pen pressure, smoothing, pattern, library';
async function library(page: Page, name: string) {
  const button = page.getByRole('button', { name: more, exact: true });
  await button.click(); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).first().click(); await button.click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
});

test('rotated custom stamp preserves source colors, alpha and one undo step', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [{ id: 'probe', name: 'Color pair', kind: 'brush', w: 2, h: 1,
    data: btoa(String.fromCharCode(255, 0, 0, 128, 0, 0, 255, 255)), align: 'dab' }] })));
  await createDrawing(page); await library(page, 'Color pair (2×1)');
  await page.getByRole('spinbutton', { name: 'Angle', exact: true }).fill('90');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await pointer(page, 'pointerdown', 10, 10, 1, 'mouse'); await pointer(page, 'pointerup', 10, 10, 0, 'mouse');
  const result = await exportPixels(page), colors: number[][] = [];
  for (let i = 0; i < result.pixels.length; i += 4) if (result.pixels[i + 3]) colors.push(result.pixels.slice(i, i + 4));
  expect(colors.sort()).toEqual([[255, 0, 0, 128], [0, 0, 255, 255]].sort());
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z'); expect(await exportPixels(page)).toEqual(result);
});

test('custom stamp size and alpha follow pressure without changing the source image', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:pressure', JSON.stringify({ size: true, opacity: true, density: false, min: 0 }));
    localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [{ id: 'probe', name: 'Solid', kind: 'brush', w: 4, h: 4,
      data: btoa(String.fromCharCode(...Array.from({ length: 16 }, () => [255, 0, 0, 255]).flat())), align: 'dab' }] }));
  });
  await createDrawing(page); await library(page, 'Solid (4×4)');
  await pointer(page, 'pointerdown', 10, 10, .5); await pointer(page, 'pointerup', 10, 10, 0);
  const result = await exportPixels(page);
  const alpha = result.pixels.filter((_, i) => i % 4 === 3 && result.pixels[i] > 0);
  expect(alpha).toEqual([128, 128, 128, 128]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:brushes')!).items[0].w)).toBe(4);
});

test('built-in mask uses primary alpha and tint survives library and project saves', async ({ page }) => {
  await createDrawing(page);
  const button = page.getByRole('button', { name: more, exact: true });
  await button.click(); await page.getByRole('button', { name: 'Stamp', exact: true }).click();
  await page.getByRole('option', { name: 'Heart', exact: true }).click(); await button.click();
  await expect(page.getByRole('checkbox', { name: 'Use current color', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Edit primary color', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Edit primary color', exact: true });
  await popup.getByRole('textbox', { name: 'HEX', exact: true }).fill('12345680');
  await popup.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await pointer(page, 'pointerdown', 16, 16, 1, 'mouse'); await pointer(page, 'pointerup', 16, 16, 0, 'mouse');
  const result = await exportPixels(page);
  const alpha = result.pixels.filter((_, i) => i % 4 === 3 && result.pixels[i] > 0);
  expect(alpha.length).toBeGreaterThan(20); expect(new Set(alpha)).toEqual(new Set([128]));
  await button.click(); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'In project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:brushes') ?? '{}').items?.[0]?.tint)).toBe(true);
  await button.click(); await command(page, 'file.save');
  await page.getByRole('dialog', { name: 'Save', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved: untitled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Drop brush', exact: true }).click();
  await library(page, 'Brush 1 (9×8)');
  await expect(page.getByRole('checkbox', { name: 'Use current color', exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await button.click(); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Brush 1 (9×8)', exact: true })).toHaveCount(2);
});

test('angle mode is saved in editor state and tool presets', async ({ page }) => {
  await createDrawing(page);
  const button = page.getByRole('button', { name: more, exact: true });
  await button.click(); await page.getByRole('button', { name: 'Angle dynamics', exact: true }).click();
  await page.getByRole('option', { name: 'Stroke', exact: true }).click(); await button.click();
  await page.getByTitle('Save the current tool settings as a preset', { exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox').fill('Follow stroke');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:toolPresets') ?? '{}').items?.[0]?.values.brushAngleDynamics)).toBe('stroke');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:editor') ?? '{}').brushAngleDynamics)).toBe('stroke');
  await page.reload(); await page.getByRole('button', { name: '32×32', exact: true }).click();
  await page.getByRole('button', { name: 'Preset', exact: true }).click();
  await page.getByRole('option', { name: 'Follow stroke', exact: true }).click();
  await button.click(); await expect(page.getByRole('button', { name: 'Angle dynamics', exact: true })).toHaveText('Stroke');
});
