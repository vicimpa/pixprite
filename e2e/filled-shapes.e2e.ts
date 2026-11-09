import { expect, test, type Page } from '@playwright/test';
import { createDrawing, exportPixels, pointer, viewPixel } from './drawing-helper';

async function tool(page: Page, name: 'Rectangle' | 'Ellipse' | 'Polygon') {
  if (name === 'Rectangle') await page.getByRole('button', { name, exact: true }).click();
  else {
    await page.getByRole('button', { name: name === 'Ellipse' ? 'Rectangle' : 'Shape fill', exact: true }).click({ button: 'right' });
    await page.getByRole('dialog').getByRole('button', { name: `${name} ${name === 'Ellipse' ? 'U' : 'P'}`, exact: true }).click();
  }
}

for (const name of ['Rectangle', 'Ellipse', 'Polygon'] as const) for (const filled of [false, true]) test(`${name} ${filled ? 'filled' : 'outline'} previews and exports with undo/redo`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
  await createDrawing(page); await tool(page, name);
  await page.getByRole('button', { name: filled ? 'Filled' : 'Outline', exact: true }).click();
  const blank = await viewPixel(page, 12, 12);
  await pointer(page, 'pointerdown', 4, 4, 1, 'mouse');
  if (name === 'Polygon') {
    await pointer(page, 'pointermove', 20, 4, 1, 'mouse'); await pointer(page, 'pointerup', 20, 4, 0, 'mouse');
    await pointer(page, 'pointerdown', 20, 4, 1, 'mouse'); await pointer(page, 'pointermove', 20, 20, 1, 'mouse'); await pointer(page, 'pointerup', 20, 20, 0, 'mouse');
    await pointer(page, 'pointerdown', 20, 20, 1, 'mouse'); await pointer(page, 'pointermove', 4, 20, 1, 'mouse'); await pointer(page, 'pointerup', 4, 20, 0, 'mouse');
  } else await pointer(page, 'pointermove', 20, 20, 1, 'mouse');
  if (filled) expect(await viewPixel(page, 12, 12)).not.toEqual(blank);
  else expect(await viewPixel(page, 12, 12)).toEqual(blank);
  if (name === 'Polygon') await page.keyboard.press('Enter');
  else await pointer(page, 'pointerup', 20, 20, 0, 'mouse');
  const result = await exportPixels(page), alpha = (x: number, y: number) => result.pixels[(y * result.width + x) * 4 + 3];
  expect(alpha(12, 12)).toBe(filled ? 255 : 0);
  expect(alpha(3, 12)).toBe(0); expect(alpha(21, 12)).toBe(0);
  expect(result.pixels.some(v => v !== 0)).toBe(true);
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z'); expect(await exportPixels(page)).toEqual(result);
});

for (const language of ['en', 'ru']) test(`fill controls stay accessible at 800px with large ${language} text`, async ({ page }) => {
  const ru = language === 'ru';
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(language => localStorage.setItem('pixprite:prefs', JSON.stringify({ language, uiSize: 'large', keyStyle: 'pc', autosave: false })), language);
  await page.goto('/'); await page.getByRole('button', { name: '32×32', exact: true }).click();
  await page.getByRole('button', { name: ru ? 'Прямоугольник' : 'Rectangle', exact: true }).click();
  const fill = page.getByRole('button', { name: ru ? 'С заливкой' : 'Filled', exact: true });
  await expect(fill).toBeVisible(); await fill.click(); await expect(fill).toHaveAttribute('aria-pressed', 'true');
  const rect = (await fill.boundingBox())!; expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(800);
});

test('filled shape respects selection and alpha without expanding by the custom brush', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [{ id: 'solid', name: 'Solid mask', kind: 'brush', w: 3, h: 3,
      data: btoa(String.fromCharCode(...Array.from({ length: 9 }, () => [0, 0, 0, 255]).flat())), align: 'dab', tint: true }] }));
  });
  await createDrawing(page);
  const more = page.getByRole('button', { name: 'More brush settings: pen pressure, smoothing, pattern, library', exact: true });
  await more.click(); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('option', { name: 'Solid mask (3×3)', exact: true }).click(); await more.click();
  await page.getByRole('button', { name: 'Edit primary color', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Edit primary color', exact: true });
  await popup.getByRole('textbox', { name: 'HEX', exact: true }).fill('12345680');
  await popup.getByRole('button', { name: 'Close', exact: true }).click();
  await tool(page, 'Rectangle'); await page.getByRole('button', { name: 'Filled', exact: true }).click();
  const draw = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await pointer(page, 'pointerdown', 2, 2, 1, 'mouse'); await pointer(page, 'pointermove', 20, 20, 1, 'mouse'); await pointer(page, 'pointerup', 20, 20, 0, 'mouse');
    return exportPixels(page);
  };
  const first = await draw();
  const alpha = (pixels: number[], x: number, y: number) => pixels[(y * 32 + x) * 4 + 3];
  expect(alpha(first.pixels, 2, 2)).toBe(128); expect(alpha(first.pixels, 12, 12)).toBe(128);
  expect(alpha(first.pixels, 1, 10)).toBe(0); expect(alpha(first.pixels, 21, 10)).toBe(0);
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Box select', exact: true }).click();
  await pointer(page, 'pointerdown', 4, 4, 1, 'mouse'); await pointer(page, 'pointermove', 12, 12, 1, 'mouse'); await pointer(page, 'pointerup', 12, 12, 0, 'mouse');
  await tool(page, 'Rectangle');
  const clipped = await draw();
  expect(alpha(clipped.pixels, 5, 5)).toBe(128); expect(alpha(clipped.pixels, 2, 2)).toBe(0); expect(alpha(clipped.pixels, 13, 13)).toBe(0);
});
