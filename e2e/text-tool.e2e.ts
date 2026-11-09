import { expect, test, type Page } from '@playwright/test';
import { command, createDrawing, exportPixels, pixelPosition } from './drawing-helper';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
  await createDrawing(page, 128, 64);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
});

async function startText(page: Page) {
  const at = await pixelPosition(page, 8, 16, 128, 64); await page.mouse.click(at.x, at.y);
  const field = page.getByTestId('text-entry'); await expect(field).toBeFocused();
  return field;
}

test('clearing all typed text leaves no old pixels or undo step', async ({ page }) => {
  const field = await startText(page);
  await field.fill('AB'); await field.fill(''); await field.press('Enter');
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
});

test('text preserves leading and trailing spaces instead of cropping their advance', async ({ page }) => {
  const field = await startText(page);
  await field.fill('A');
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(20);
  await page.evaluate(() => document.fonts.ready);
  const original = (await field.boundingBox())!.width;
  await field.fill(' A ');
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(original * 1.3);
  await field.press('Enter');
  const spaced = await exportPixels(page);
  const minX = (image: typeof spaced) => {
    let left = image.width;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
      if (image.pixels[(y * image.width + x) * 4 + 3]) left = Math.min(left, x);
    return left;
  };
  await page.keyboard.press('Control+z');
  const again = await startText(page); await again.fill('A'); await again.press('Enter');
  expect(minX(spaced)).toBeGreaterThan(minX(await exportPixels(page)));
});

test('multiline text accepts Shift+Enter and can be cancelled without painting', async ({ page }) => {
  const field = await startText(page);
  await field.fill('A'); await field.press('Shift+Enter'); await field.press('B');
  await expect(field).toHaveValue('A\nB');
  await field.press('Enter');
  const image = await exportPixels(page);
  const rows = Array.from({ length: image.height }, (_, y) => image.pixels.slice(y * image.width * 4, (y + 1) * image.width * 4).some((v, i) => i % 4 === 3 && v > 0));
  const runs = rows.filter((ink, y) => ink && !rows[y - 1]).length;
  expect(runs).toBe(2);
  await page.keyboard.press('Control+z');
  const again = await startText(page); await again.fill('discard this'); await again.press('Escape');
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
});

test('live font, size and color changes redraw text and leave toolbar fields editable', async ({ page }) => {
  const field = await startText(page); await field.fill('Wi');
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(20);
  const original = (await field.boundingBox())!;
  const size = page.getByRole('spinbutton', { name: 'Size', exact: true }); await size.fill('24');
  await expect(size).toBeFocused();
  await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(original.height);
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('option', { name: 'Monospace', exact: true }).click();
  await page.getByRole('button', { name: 'Edit primary color', exact: true }).click();
  await page.getByRole('textbox', { name: 'HEX', exact: true }).fill('#12ab34');
  await page.keyboard.press('Escape');
  await field.press('Enter');
  const image = await exportPixels(page);
  const colors = new Set<string>();
  for (let i = 0; i < image.pixels.length; i += 4) if (image.pixels[i + 3]) colors.add(image.pixels.slice(i, i + 4).join(','));
  expect([...colors]).toEqual(['18,171,52,255']);
});

test('dragging live text keeps it editable and applies as one undo step', async ({ page }, info) => {
  const field = await startText(page); await field.fill('A');
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(20);
  const from = await pixelPosition(page, 10, 22, 128, 64), to = await pixelPosition(page, 22, 26, 128, 64);
  const before = (await field.boundingBox())!;
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  await expect(field).toBeFocused();
  await expect.poll(async () => Math.round((await field.boundingBox())!.x - before.x)).toBe(Math.round(to.x - from.x));
  await field.press('B'); await expect(field).toHaveValue('AB');
  await page.screenshot({ path: info.outputPath('live-text.png') });
  await field.press('Enter');
  const image = await exportPixels(page); expect(image.pixels.some(v => v > 0)).toBe(true);
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.keyboard.press('Control+Shift+z'); expect(await exportPixels(page)).toEqual(image);
});

test('whitespace-only text does not create a painting history entry', async ({ page }) => {
  const field = await startText(page); await field.fill('   \n  '); await field.press('Enter');
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  // Undo remains disabled for a new, unchanged document.
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type a command… (= calculates)'); await expect(search).toHaveValue(''); await search.fill('edit.undo');
  await expect(page.locator('[data-command="edit.undo"]')).toHaveAttribute('data-disabled', 'true');
});

test('clearing moved text retains the box position for the next input', async ({ page }) => {
  const field = await startText(page); await field.fill('A');
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(20);
  const from = await pixelPosition(page, 10, 22, 128, 64), to = await pixelPosition(page, 22, 26, 128, 64);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  const moved = (await field.boundingBox())!;
  await field.fill(''); await field.fill('B');
  await expect.poll(async () => Math.round((await field.boundingBox())!.x)).toBe(Math.round(moved.x));
  await expect.poll(async () => Math.round((await field.boundingBox())!.y)).toBe(Math.round(moved.y));
  await field.press('Enter');
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
});

test('switching documents waits for the pending text font without losing the draft', async ({ page }) => {
  await command(page, 'file.new');
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('textbox').fill('Other');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[draggable=true][title="untitled · 128×64"]').click();
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*tiny5*woff2', async route => { requested(); await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('option', { name: 'Tiny5', exact: true }).click();
  const field = await startText(page); await field.fill('ABC'); await request;
  await page.locator('[draggable=true][title^="Other ·"]').click();
  release(); await expect(field).toBeHidden();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', /^Other ·/);
  expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
  await page.locator('[draggable=true][title="untitled · 128×64"]').click();
  expect((await exportPixels(page)).pixels.some(v => v > 0)).toBe(true);
});

test('another text box and switching tools apply each draft once', async ({ page }) => {
  let field = await startText(page); await field.fill('A');
  const next = await pixelPosition(page, 80, 16, 128, 64); await page.mouse.click(next.x, next.y);
  field = page.getByTestId('text-entry'); await expect(field).toHaveValue(''); await field.fill('B');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click(); await expect(field).toBeHidden();
  const image = await exportPixels(page);
  expect(image.pixels.some(v => v > 0)).toBe(true);
  await page.keyboard.press('Control+z'); const first = await exportPixels(page);
  expect(first.pixels.some(v => v > 0)).toBe(true); expect(first).not.toEqual(image);
  await page.keyboard.press('Control+z'); expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
});

for (const action of ['apply', 'cancel', 'tool', 'new-box-cancel', 'home', 'new', 'save'] as const) test(`pending font loading: ${action}`, async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*tiny5*woff2', async route => { requested(); await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('option', { name: 'Tiny5', exact: true }).click();
  const field = await startText(page); await field.fill('ABC');
  await request;
  if (action === 'tool') {
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const at = await pixelPosition(page, 1, 1, 128, 64); await page.mouse.click(at.x, at.y);
  } else if (action === 'home') {
    await page.locator('[data-home]').click();
  } else if (action === 'new' || action === 'save') {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: action === 'new' ? 'New sprite…' : 'Save', exact: true }).click();
    if (action === 'new') {
      const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
      await dialog.getByRole('textbox').fill('Fresh');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    } else {
      await page.getByRole('dialog', { name: 'Save', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    }
  } else if (action === 'new-box-cancel') {
    const at = await pixelPosition(page, 80, 16, 128, 64); await page.mouse.click(at.x, at.y);
    await field.press('Escape');
  } else await field.press(action === 'cancel' ? 'Escape' : 'Enter');
  const cancelled = action === 'cancel' || action === 'new-box-cancel';
  if (!cancelled) await expect(field).toBeVisible();
  release(); await expect(field).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  if (action === 'home') {
    await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
    await page.locator('[draggable=true][title="untitled · 128×64"]').click();
  }
  if (action === 'new') {
    await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', /^Fresh ·/);
    expect((await exportPixels(page)).pixels.every(v => v === 0)).toBe(true);
    await page.locator('[draggable=true][title="untitled · 128×64"]').click();
  }
  if (action === 'save') {
    await expect(page.getByText('Saved: untitled', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  }
  const image = await exportPixels(page);
  expect(image.pixels.some(v => v > 0)).toBe(!cancelled);
  expect(image.pixels[(image.width + 1) * 4 + 3]).toBe(0);
});
