import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { command, createDrawing, exportPixels, pointer } from './drawing-helper';

const more = 'More brush settings: pen pressure, smoothing, pattern, library';
const data = btoa(String.fromCharCode(255, 0, 0, 128, 0, 0, 255, 255));
const resource = { id: 'pair', name: 'Pair', kind: 'brush', w: 2, h: 1, data, align: 'dab' };

async function pen(page: Page) {
  await page.getByRole('button', { name: more, exact: true }).click();
  return page.getByRole('dialog', { name: more, exact: true });
}
async function closePen(page: Page) { await page.getByRole('button', { name: more, exact: true }).click(); }
async function choose(page: Page, label: string, value: string) {
  // A changed preset name can move this control into the adaptive palette on the next frame.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const button = page.getByRole('button', { name: label, exact: true });
  const overflow = !await button.isVisible();
  if (overflow) await page.getByRole('button', { name: 'More tool options', exact: true }).click();
  await button.click();
  await page.getByRole('option', { name: value, exact: true }).click();
  if (overflow && await page.getByRole('dialog', { name: 'More tool options', exact: true }).isVisible()) await page.keyboard.press('Escape');
}
async function savePreset(page: Page, name: string) {
  await page.getByTitle('Save the current tool settings as a preset', { exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
}
async function stroke(page: Page, moves: number, pressure = 1) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await pointer(page, 'pointerdown', 4, 10, pressure);
  for (let i = 1; i <= moves; i++) await pointer(page, 'pointermove', 4 + 24 * i / moves, 10, pressure);
  await pointer(page, 'pointerup', 28, 10, 0);
}
async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import brushes…', exact: true }).click();
  await (await chooser).setFiles(file);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
});

test('spacing is independent of pointer sample count and zoom and cancels as one stroke', async ({ page }) => {
  await createDrawing(page); await pen(page);
  await page.getByRole('spinbutton', { name: 'Spacing, %', exact: true }).fill('400'); await closePen(page);
  await stroke(page, 1, .5); const sparse = await exportPixels(page);
  const positions: number[] = [];
  for (let x = 0; x < 32; x++) if (sparse.pixels[(10 * 32 + x) * 4 + 3]) positions.push(x);
  expect(positions).toEqual([4, 8, 12, 16, 20, 24, 28]);
  await page.keyboard.press('Control+z');
  const zoom = page.getByRole('textbox', { name: 'Zoom, %', exact: true }); await zoom.fill('800'); await zoom.press('Enter');
  await page.waitForTimeout(500); // Let animated camera zoom reach the target used by pixelPosition.
  await stroke(page, 24, .5); expect(await exportPixels(page)).toEqual(sparse);
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await pointer(page, 'pointerdown', 4, 10, 1); await pointer(page, 'pointermove', 28, 10, 1);
  await page.keyboard.press('Escape'); await pointer(page, 'pointerup', 28, 10, 0);
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
});

test('single stamp ignores drag and pressure changes; scale and mirrors preserve pixels', async ({ page }) => {
  await page.addInitScript(resource => localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [resource] })), resource);
  await page.addInitScript(() => localStorage.setItem('pixprite:pressure', JSON.stringify({ size: false, opacity: true, density: false, min: 0 })));
  await createDrawing(page); await pen(page); await choose(page, 'Library', 'Pair (2×1)');
  await choose(page, 'Application', 'Single stamp');
  await page.getByRole('spinbutton', { name: 'Brush scale, %', exact: true }).fill('200');
  await page.getByRole('button', { name: 'Flip brush X', exact: true }).click(); await closePen(page);
  await pointer(page, 'pointerdown', 4, 10, .5); await pointer(page, 'pointermove', 28, 10, 1); await pointer(page, 'pointerup', 28, 10, 0);
  const result = await exportPixels(page);
  const colored: number[][] = [];
  for (let i = 0; i < result.pixels.length; i += 4) if (result.pixels[i + 3]) colored.push(result.pixels.slice(i, i + 4));
  expect(colored).toHaveLength(8); expect(colored.filter(c => c[0] === 255)).toHaveLength(4);
  expect(result.pixels.slice((9 * 32 + 2) * 4, (9 * 32 + 2) * 4 + 4)).toEqual([0, 0, 255, 128]);
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z'); expect(await exportPixels(page)).toEqual(result);
});

test('existing selection capture creates a brush without replacing the drawing', async ({ page }) => {
  await createDrawing(page);
  await pointer(page, 'pointerdown', 4, 10, 1, 'mouse'); await pointer(page, 'pointermove', 5, 10, 1, 'mouse'); await pointer(page, 'pointerup', 5, 10, 0, 'mouse');
  const original = await exportPixels(page);
  await page.getByRole('button', { name: 'Box select', exact: true }).click();
  await pointer(page, 'pointerdown', 4, 10, 1, 'mouse'); await pointer(page, 'pointermove', 5, 10, 1, 'mouse'); await pointer(page, 'pointerup', 5, 10, 0, 'mouse');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await pen(page); await page.getByRole('button', { name: 'From selection', exact: true }).click();
  await closePen(page); await expect(page.getByText('Custom brush 2×1', { exact: true })).toBeVisible();
  expect(await exportPixels(page)).toEqual(original);
  await pointer(page, 'pointerdown', 16, 16, 1, 'mouse'); await pointer(page, 'pointerup', 16, 16, 0, 'mouse');
  const stamped = await exportPixels(page); expect(stamped.pixels).not.toEqual(original.pixels);
  await page.keyboard.press('Control+z'); expect(await exportPixels(page)).toEqual(original);
});

test('full preset and portable file restore the bitmap and every brush setting after reload', async ({ page }) => {
  await page.addInitScript(resource => {
    if (!localStorage.getItem('pixprite:brushes')) localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [resource] }));
  }, resource);
  await createDrawing(page); await savePreset(page, 'Plain');
  await pen(page); await choose(page, 'Library', 'Pair (2×1)');
  await page.getByRole('spinbutton', { name: 'Spacing, %', exact: true }).fill('200');
  await page.getByRole('spinbutton', { name: 'Brush scale, %', exact: true }).fill('200');
  await page.getByRole('button', { name: 'Flip brush X', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Pressure → size', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Pressure → opacity', exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Minimum, %', exact: true }).fill('25');
  await choose(page, 'Application', 'Single stamp'); await closePen(page);
  await savePreset(page, 'Complete pair');
  await choose(page, 'Preset', 'Plain'); await expect(page.getByRole('button', { name: 'Drop brush', exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '32×32', exact: true }).click();
  await choose(page, 'Preset', 'Complete pair'); await stroke(page, 1); const before = await exportPixels(page);
  await page.keyboard.press('Control+z'); await pen(page);
  await expect(page.getByRole('spinbutton', { name: 'Brush scale, %', exact: true })).toHaveValue('200');
  await expect(page.getByRole('button', { name: 'Flip brush X', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Spacing, %', exact: true })).toHaveValue('200');
  await expect(page.getByRole('spinbutton', { name: 'Minimum, %', exact: true })).toHaveValue('25');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export brush…', exact: true }).click();
  const exported = await pending, buffer = await readFile((await exported.path())!);
  expect(exported.suggestedFilename()).toMatch(/\.pixbrush$/);
  const file = JSON.parse(buffer.toString()); expect(file.items[0].data).toBe(data);
  expect(file.items[0].settings.brushMode).toBe('stamp'); expect(file.items[0].settings.pressure.min).toBe(25);
  await importFile(page, { name: 'Pair.pixbrush', mimeType: 'application/json', buffer });
  await expect(page.getByText('Imported brushes: 1', { exact: true })).toBeVisible();
  await closePen(page); await stroke(page, 1); expect(await exportPixels(page)).toEqual(before);
});

test('PNG import and brush-set export work, malformed sets never partially modify the library', async ({ page }) => {
  await page.addInitScript(resource => localStorage.setItem('pixprite:brushes', JSON.stringify({ items: [resource] })), resource);
  await createDrawing(page); await pen(page); await choose(page, 'Library', 'Pair (2×1)');
  const pngPending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Brush PNG…', exact: true }).click();
  const png = await readFile((await (await pngPending).path())!);
  await importFile(page, { name: 'Portable.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Imported brushes: 1', { exact: true })).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('pixprite:brushes'));
  const invalid = Buffer.from(JSON.stringify({ format: 'pixprite-brushes', version: 1, items: [resource, { ...resource, w: -1 }] }));
  await importFile(page, { name: 'Broken.pixbrush', mimeType: 'application/json', buffer: invalid });
  await expect(page.getByText('Could not import brushes. Check the file format, size and available storage.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pixprite:brushes'))).toBe(before);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export brush set…', exact: true }).click();
  const pack = JSON.parse((await readFile((await (await pending).path())!)).toString());
  expect(pack.items).toHaveLength(2); expect(pack.items.every((item: typeof resource) => item.data === data)).toBe(true);
});

test('cancelled picker and storage failure leave the brush library unchanged', async ({ page }) => {
  await createDrawing(page); await pen(page);
  await page.evaluate(() => {
    HTMLInputElement.prototype.click = function() { this.dispatchEvent(new Event('cancel')); };
  });
  const before = await page.evaluate(() => localStorage.getItem('pixprite:brushes'));
  await page.getByRole('button', { name: 'Import brushes…', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('pixprite:brushes'))).toBe(before);
  await page.evaluate(() => {
    delete (HTMLInputElement.prototype as unknown as Record<string, unknown>).click;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'pixprite:brushes') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await importFile(page, { name: 'Pair.pixbrush', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'pixprite-brushes', version: 1, items: [resource] })) });
  await expect(page.getByText('Could not import brushes. Check the file format, size and available storage.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pixprite:brushes'))).toBe(before);
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0);
});
