import { expect, test, type Page } from '@playwright/test';
import { createDrawing } from './drawing-helper';

const more = 'More brush settings: pen pressure, smoothing, pattern, library';
async function openPen(page: Page, name = more, overflow = 'More tool options') {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: overflow, exact: true }).click();
  await button.click();
  return page.getByRole('dialog', { name, exact: true });
}

test('pen mapping and stabilizer restore existing settings and legacy presets', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    if (!localStorage.getItem('pixprite:pressure')) localStorage.setItem('pixprite:pressure', JSON.stringify({ size: true, opacity: false, density: false, min: 10 }));
    if (!localStorage.getItem('pixprite:toolPresets')) localStorage.setItem('pixprite:toolPresets', JSON.stringify({ items: [{ name: 'Old pen', tool: 'pencil', values: { brushSize: 6, stabilizer: 16, pixelPerfect: true } }] }));
  });
  await createDrawing(page);
  let panel = await openPen(page);
  await expect(panel.getByRole('checkbox', { name: 'Pressure → size', exact: true })).toBeChecked();
  await panel.getByRole('checkbox', { name: 'Pressure → opacity', exact: true }).check();
  await panel.getByRole('spinbutton', { name: 'Minimum, %', exact: true }).fill('25');
  await panel.getByRole('spinbutton', { name: 'Stabilizer', exact: true }).fill('32');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:editor') ?? '{}').stabilizer)).toBe(32);
  await createDrawing(page);
  panel = await openPen(page);
  await expect(panel.getByRole('checkbox', { name: 'Pressure → size', exact: true })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Pressure → opacity', exact: true })).toBeChecked();
  await expect(panel.getByRole('spinbutton', { name: 'Minimum, %', exact: true })).toHaveValue('25');
  await expect(panel.getByRole('spinbutton', { name: 'Stabilizer', exact: true })).toHaveValue('32');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Preset', exact: true }).click();
  await page.getByRole('option', { name: 'Old pen', exact: true }).click();
  panel = await openPen(page);
  await expect(panel.getByRole('spinbutton', { name: 'Stabilizer', exact: true })).toHaveValue('16');
  await expect(panel.getByRole('checkbox', { name: 'Pressure → opacity', exact: true })).toBeChecked();
  await panel.getByRole('spinbutton', { name: 'Stabilizer', exact: true }).fill('0');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:editor') ?? '{}').stabilizer)).toBe(0);
});

for (const language of ['en', 'ru']) for (const width of [1280, 800]) test(`pen settings fit ${language} large text at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 600 });
  await page.addInitScript(language => localStorage.setItem('pixprite:prefs', JSON.stringify({ language, keyStyle: 'pc', uiSize: 'large', autosave: false })), language);
  await page.goto('/');
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  const name = language === 'ru' ? 'Другие настройки кисти: нажим пера, сглаживание, узор, библиотека' : more;
  const panel = await openPen(page, name, language === 'ru' ? 'Другие параметры инструмента' : 'More tool options');
  await panel.getByRole('checkbox', { name: language === 'ru' ? 'Нажим → прозрачность' : 'Pressure → opacity', exact: true }).check();
  await panel.getByRole('checkbox', { name: language === 'ru' ? 'Нажим → размер' : 'Pressure → size', exact: true }).check();
  await expect(panel.getByRole('spinbutton', { name: language === 'ru' ? 'Минимум, %' : 'Minimum, %', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: language === 'ru' ? 'Штамп' : 'Stamp', exact: true }).click();
  await page.getByRole('option', { name: language === 'ru' ? 'Сердце' : 'Heart', exact: true }).click();
  await expect(panel.getByRole('spinbutton', { name: language === 'ru' ? 'Масштаб кисти, %' : 'Brush scale, %', exact: true })).toBeVisible();
  const bounds = await panel.evaluate(el => {
    const r = el.getBoundingClientRect();
    const controls = [...el.querySelectorAll('input,button')].map(control => control.getBoundingClientRect());
    return { fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      overflow: el.scrollWidth > el.clientWidth + 1, controlsFit: controls.every(c => c.x >= r.x && c.right <= r.right + 1) };
  });
  expect(bounds).toEqual({ fits: true, overflow: false, controlsFit: true });
  await page.screenshot({ path: info.outputPath('pen-settings.png') });
});
