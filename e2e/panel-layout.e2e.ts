import { expect, test, type Page } from '@playwright/test';

async function create(page: Page, layout: Record<string, unknown> = {}) {
  await page.addInitScript(layout => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false }));
    if (!localStorage.getItem('pixprite:layout')) localStorage.setItem('pixprite:layout', JSON.stringify(layout));
  }, layout);
  await page.goto('/');
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a command… (= calculates)').fill(id);
  await page.locator(`[data-command="${id}"]`).click();
}

test('nested Flex controls use their own layout defaults', async ({ page }) => {
  await create(page);
  const actual = await page.evaluate(() => {
    const outer = document.createElement('px-flex');
    for (const [name, value] of Object.entries({ direction: 'column', grow: '1', shrink: '0', basis: '240', gap: '17', padding: '12px' })) outer.setAttribute(name, value);
    const inner = document.createElement('px-flex'); outer.append(inner); document.body.append(outer);
    const style = getComputedStyle(inner);
    const result = { direction: style.flexDirection, grow: style.flexGrow, shrink: style.flexShrink, basis: style.flexBasis, padding: style.paddingTop, gap: style.gap,
      themeGap: getComputedStyle(document.documentElement).getPropertyValue('--gap').trim() };
    outer.remove(); return result;
  });
  expect(actual).toEqual({ direction: 'row', grow: '0', shrink: '1', basis: 'auto', padding: '0px', gap: actual.themeGap, themeGap: actual.themeGap });
  expect(actual.gap).not.toBe('17px');
});

test('color picker resizes while dragging, saves on release and responds to layout reset', async ({ page }) => {
  await create(page);
  const splitter = page.locator('[data-panel=colors] [data-splitter=rows]');
  const picker = splitter.locator('xpath=following-sibling::*[1]');
  const height = () => picker.evaluate(el => el.getBoundingClientRect().height);
  const before = await height(), grip = (await splitter.boundingBox())!;
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:layout')!).pickerSize)).toBe(240);
  const stored = await page.evaluate(() => localStorage.getItem('pixprite:layout'));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 2 - 60, { steps: 8 });
  expect(Math.round(await height() - before)).toBe(60);
  expect(await page.evaluate(() => localStorage.getItem('pixprite:layout'))).toBe(stored);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:layout')!).pickerSize)).toBe(before + 60);
  await command(page, 'window.reset');
  await expect.poll(height).toBe(240);
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 242, { steps: 8 });
  expect(await height()).toBe(0);
  await page.mouse.up();
  await expect(picker).toHaveAttribute('aria-hidden', 'true');
  await expect(splitter).toBeVisible();
  const collapsed = (await splitter.boundingBox())!;
  await page.mouse.move(collapsed.x + collapsed.width / 2, collapsed.y + 2); await page.mouse.down();
  await page.mouse.move(collapsed.x + collapsed.width / 2, collapsed.y + 2 - 120, { steps: 8 });
  expect(await height()).toBe(120);
  await page.mouse.up();
});

for (const [colors, timeline] of [['left', 'bottom'], ['right', 'top']] as const) {
  test(`color panel and timeline collapse fully and reopen by dragging (${colors}/${timeline})`, async ({ page }) => {
    await create(page, { colors, timeline });
    for (const kind of ['colors', 'timeline'] as const) {
      const panel = page.locator(`[data-panel=${kind}]`);
      // Use the panel's own adjacent grip, independent of docking order.
      const growth = kind === 'colors' ? colors === 'left' ? 1 : -1 : timeline === 'top' ? 1 : -1;
      const grip = panel.locator(growth === 1 ? 'xpath=following-sibling::px-splitter[1]' : 'xpath=preceding-sibling::px-splitter[1]');
      const dimension = () => panel.evaluate((el, kind) => kind === 'colors' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height, kind);
      const initial = await dimension();
      const move = async (delta: number) => {
        const box = (await grip.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + (kind === 'colors' ? delta * growth : 0), y + (kind === 'timeline' ? delta * growth : 0), { steps: 8 });
      };
      await move(-initial);
      expect(Math.round(await dimension())).toBe(0);
      await page.mouse.up();
      await expect(panel).toHaveAttribute('aria-hidden', 'true');
      await expect(grip).toBeVisible();
      const key = kind === 'colors' ? 'colorsSize' : 'timelineSize';
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem('pixprite:layout')!)[key], key)).toBe(0);
      await move(initial);
      expect(Math.round(await dimension())).toBe(initial);
      await page.mouse.up();
      await expect(panel).not.toHaveAttribute('aria-hidden', 'true');
      await move(-initial); await page.mouse.up();
      await command(page, `window.${kind}`);
      await expect.poll(dimension).toBeGreaterThan(0);
    }
  });
}

test('collapsed panels survive reload and the focus toggle restores usable sizes', async ({ page }) => {
  await create(page, { colorsSize: 0, timelineSize: 0 });
  for (const kind of ['colors', 'timeline']) await expect(page.locator(`[data-panel=${kind}]`)).toHaveAttribute('aria-hidden', 'true');
  await page.reload();
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  for (const kind of ['colors', 'timeline']) await expect(page.locator(`[data-panel=${kind}]`)).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-panel=colors]')).toHaveCount(0);
  await expect(page.locator('[data-panel=timeline]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  for (const kind of ['colors', 'timeline']) {
    const panel = page.locator(`[data-panel=${kind}]`);
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute('aria-hidden', 'true');
  }
});

for (const width of [220, 360]) test(`color samples wrap according to panel width (${width}px)`, async ({ page }) => {
  await create(page, { colorsSize: width });
  const samples = page.locator('[data-color-samples] > px-flex');
  await expect(samples).toHaveCount(2);
  const [a, b] = await samples.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  expect(Math.round(a.height)).toBe(32); expect(Math.round(b.height)).toBe(32);
  if (width === 220) {
    expect(b.y - a.y).toBe(36); expect(b.x).toBe(a.x);
    expect(a.width).toBe(width); expect(b.width).toBe(width);
  } else {
    expect(b.x - a.x).toBe(182); expect(b.y).toBe(a.y);
    expect(a.width).toBe(178); expect(b.width).toBe(178);
  }
});
