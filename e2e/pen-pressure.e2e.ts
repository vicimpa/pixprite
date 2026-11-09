import { expect, test } from '@playwright/test';
import { createDrawing, exportPixels, pointer, viewPixel } from './drawing-helper';

const cases = [
  { name: 'pixel perfect', perfect: true, size: 1 },
  { name: 'ordinary pencil', perfect: false, size: 1 },
  { name: 'wide brush with clean lines enabled', perfect: true, size: 6 },
  { name: 'wide brush', perfect: false, size: 6 },
  { name: 'eraser', perfect: true, size: 1, erase: true },
  { name: 'custom brush', perfect: true, size: 1, custom: true },
  { name: 'mouse ignores pressure', perfect: true, size: 1, mouse: true },
  { name: 'disabled opacity mapping', perfect: true, size: 1, disabled: true },
] as const;

for (const config of cases) test(`pen pressure preserves earlier pixels and undo/redo (${config.name})`, async ({ page }) => {
  const erase = 'erase' in config, custom = 'custom' in config;
  const noPressure = 'mouse' in config || 'disabled' in config;
  const pointerType = 'mouse' in config ? 'mouse' : 'pen';
  await page.addInitScript(({ disabled, custom }) => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    localStorage.setItem('pixprite:pressure', JSON.stringify({ size: false, opacity: !disabled, density: false, min: 0 }));
    if (custom) localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [{ id: 'probe', name: 'Pressure probe', kind: 'brush', w: 1, h: 1,
      data: btoa(String.fromCharCode(196, 59, 69, 255)), ox: 0, oy: 0, align: 'stroke' }] }));
  }, { disabled: 'disabled' in config, custom });
  await createDrawing(page);
  if (config.perfect) await page.getByRole('button', { name: 'Clean lines', exact: true }).click();
  if (config.size > 1) await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill(String(config.size));
  if (custom) {
    const more = page.getByRole('button', { name: 'More brush settings: pen pressure, smoothing, pattern, library', exact: true });
    await more.click(); await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('option', { name: 'Pressure probe (1×1)', exact: true }).click(); await more.click();
  }
  let before: Awaited<ReturnType<typeof exportPixels>> | undefined;
  if (erase) {
    await page.getByRole('button', { name: 'Bucket', exact: true }).click();
    await pointer(page, 'pointerdown', 1, 1, 1, 'mouse'); await pointer(page, 'pointerup', 1, 1, 0, 'mouse');
    before = await exportPixels(page);
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  }
  // Synthetic pen events don't perform the browser's normal focus change.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await pointer(page, 'pointerdown', 4, 10, .25, pointerType);
  await pointer(page, 'pointermove', 12, 10, .25, pointerType);
  const first = await viewPixel(page, 6, 10);
  await pointer(page, 'pointermove', 20, 10, 1, pointerType);
  expect(await viewPixel(page, 6, 10)).toEqual(first);
  const middle = await viewPixel(page, 16, 10);
  await pointer(page, 'pointermove', 28, 10, .5, pointerType);
  expect(await viewPixel(page, 6, 10)).toEqual(first);
  expect(await viewPixel(page, 16, 10)).toEqual(middle);
  await pointer(page, 'pointerup', 28, 10, 0, pointerType);
  const after = await exportPixels(page);
  const alpha = (x: number) => after.pixels[(10 * after.width + x) * 4 + 3];
  expect([alpha(6), alpha(16), alpha(25)]).toEqual(noPressure ? [255, 255, 255] : erase ? [191, 0, 128] : [64, 255, 128]);
  await page.keyboard.press('Control+z');
  const undone = await exportPixels(page);
  if (before) expect(undone).toEqual(before); else expect(undone.pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  expect(await exportPixels(page)).toEqual(after);
});

test('stabilizer finishes at release with the last contact pressure and size', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    localStorage.setItem('pixprite:pressure', JSON.stringify({ size: true, opacity: true, density: false, min: 0 }));
  });
  await createDrawing(page);
  await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('6');
  const more = page.getByRole('button', { name: 'More brush settings: pen pressure, smoothing, pattern, library', exact: true });
  await more.click(); await page.getByRole('spinbutton', { name: 'Stabilizer', exact: true }).fill('32'); await more.click();
  await pointer(page, 'pointerdown', 4, 10, .5);
  await pointer(page, 'pointermove', 28, 10, .5);
  await pointer(page, 'pointerup', 28, 10, 0);
  const result = await exportPixels(page);
  const alpha = (x: number, y: number) => result.pixels[(y * result.width + x) * 4 + 3];
  expect(alpha(28, 10)).toBe(128);
  expect(alpha(28, 14)).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z'); expect(await exportPixels(page)).toEqual(result);
});

test('pixel-perfect corner cleanup retains pressure on surviving and revisited pixels', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    localStorage.setItem('pixprite:pressure', JSON.stringify({ size: false, opacity: true, density: false, min: 0 }));
  });
  await createDrawing(page); await page.getByRole('button', { name: 'Clean lines', exact: true }).click();
  await pointer(page, 'pointerdown', 4, 10, .25);
  await pointer(page, 'pointermove', 5, 10, .5);
  await pointer(page, 'pointermove', 5, 11, 1);
  await pointer(page, 'pointermove', 4, 10, 1);
  await pointer(page, 'pointerup', 4, 10, 0);
  const result = await exportPixels(page);
  const alpha = (x: number, y: number) => result.pixels[(y * result.width + x) * 4 + 3];
  expect(alpha(4, 10)).toBe(64);
  expect(alpha(5, 10)).toBe(0);
  expect(alpha(5, 11)).toBe(255);
});
