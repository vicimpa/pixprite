import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const en: Record<string, string> = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const ru: Record<string, string> = JSON.parse(readFileSync(new URL('../src/locales/ru.json', import.meta.url), 'utf8'));

async function command(page: Page, id: string, strings = en) {
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(strings['commandPalette.typeACommandCalculates']);
  await expect(input).toBeFocused();
  await input.fill(id);
  await page.locator(`[data-command="${id}"]`).click();
  await expect(input).toBeHidden();
}

async function openEditor(page: Page, strings = en, large = false) {
  await page.addInitScript(({ language, large }) => {
    localStorage.setItem('pixprite:extensionRegistry', '/__e2e__/registry.json');
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language, uiSize: large ? 'large' : 'medium', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/registry.json'] }));
  }, { language: strings === ru ? 'ru' : 'en', large });
  await page.goto('/');
  await page.getByRole('button', { name: strings['home.customSize'], exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: strings['common.create'], exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

/** Detect clipping as well as scrollbars: overflow:hidden alone must not pass this check. */
async function expectBarsFit(page: Page) {
  // Let ResizeObserver move controls after a viewport change before inspecting/clicking More.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => page.locator('[data-adaptive-bar], [data-tool-palette]').evaluateAll(bars => bars.flatMap(bar => {
    const r = bar.getBoundingClientRect();
    const lane = bar.hasAttribute('data-adaptive-bar') ? bar.querySelector(':scope > div')! : bar;
    const bounds = lane.getBoundingClientRect();
    const failures: string[] = [];
    if (bar.scrollWidth > bar.clientWidth + 1 || bar.scrollHeight > bar.clientHeight + 1) failures.push('scroll: ' + bar.getAttribute('data-adaptive-bar'));
    for (const child of lane.children) {
      const c = child.getBoundingClientRect();
      if (!c.width || !c.height) continue;
      if (c.left < bounds.left - 1 || c.right > bounds.right + 1 || c.top < r.top - 1 || c.bottom > r.bottom + 1)
        failures.push('clipped: ' + child.textContent);
    }
    return failures;
  }))).toEqual([]);
}

for (const [language, strings] of [['en', en], ['ru', ru]] as const) {
  test(`control strips fit without scrolling with ${language} labels and large UI`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await openEditor(page, strings, true);
    await command(page, 'view.snap', strings);
    await command(page, 'anim.newFrame', strings);
    await page.keyboard.press('g');
    for (const width of [1280, 1024, 800]) {
      await page.setViewportSize({ width, height: 700 });
      await expectBarsFit(page);
      await expect(page.getByTitle(strings['status.zoom'], { exact: true })).toBeVisible();
      await expect(page.getByTitle(strings['status.playEnter'], { exact: true })).toBeVisible();
      const more = page.getByRole('button', { name: strings['options.moreControls'], exact: true });
      if (await more.isVisible()) {
        await more.click();
        const panel = page.getByRole('dialog', { name: strings['options.moreControls'], exact: true });
        await expect(panel).toBeVisible();
        const box = (await panel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(700);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(more).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 800, height: 480 });
    await expectBarsFit(page);
    const tools = page.getByRole('button', { name: strings['toolbar.moreTools'], exact: true });
    await tools.click();
    const palette = page.getByRole('dialog', { name: strings['toolbar.moreTools'], exact: true });
    const paletteBox = (await palette.boundingBox())!;
    expect(paletteBox.y).toBeGreaterThanOrEqual(0);
    expect(paletteBox.y + paletteBox.height).toBeLessThanOrEqual(480);
    await palette.getByRole('button', { name: strings['tool.slice'], exact: false }).click();
    await expect(palette).toBeHidden();
    await expect(page.locator('[data-tool-palette] > button[data-active=true]')).toHaveAttribute('aria-label', strings['tool.slice']);
    await expectBarsFit(page);
  });
}

test('drafts survive moving into More and nested dropdowns keep the palette open', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openEditor(page);
  await page.keyboard.press('b');
  await page.getByTitle(en['options.saveTheCurrentTool'], { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en['common.enterAValue'], exact: true });
  await dialog.getByRole('textbox').fill('My brush preset');
  await dialog.getByRole('button', { name: en['common.ok'], exact: true }).click();
  const preset = page.getByRole('button', { name: en['options.preset'], exact: true });
  await expect(preset).toHaveText('My brush preset');
  const size = page.getByTitle(en['options.brushSizeAnd']).getByRole('spinbutton');
  await size.fill('');
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(size).toHaveValue('');
  await size.fill('17');
  await size.press('Tab');
  await expect(size).toHaveValue('17');
  await page.keyboard.press('g');
  await page.getByRole('button', { name: en['options.moreControls'], exact: true }).click();
  const palette = page.getByRole('dialog', { name: en['options.moreControls'], exact: true });
  // The local preset selection survives moving between the row and its palette.
  await expect(preset).toHaveText('My brush preset');
  await palette.getByRole('button', { name: en['options.preset'], exact: true }).click();
  await expect(page.locator('[data-select-popup]')).toBeVisible();
  await page.locator('[data-select-popup]').getByRole('option', { name: '—', exact: true }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('transform fields keep drafts across overflow and Escape dismisses options without canceling the transform', async ({ page }) => {
  // Exercise the reparenting fallback even in browsers with atomic DOM moves.
  await page.addInitScript(() => Object.defineProperty(Element.prototype, 'moveBefore', { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 800, height: 700 });
  await openEditor(page);
  await command(page, 'select.all');
  await command(page, 'edit.copy');
  await command(page, 'edit.paste');
  const apply = page.getByTitle(en['options.applyEnter'], { exact: true });
  await expect(apply).toBeVisible();
  const more = page.getByRole('button', { name: en['options.moreControls'], exact: true });
  await more.click();
  const x = page.getByLabel('X', { exact: true });
  await x.fill('7+2');
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(x).toBeVisible();
  await expect(x).toHaveValue('7+2');
  await x.press('Enter');
  await expect(x).toHaveValue('9');
  await page.setViewportSize({ width: 800, height: 700 });
  await more.click();
  const panel = page.getByRole('dialog', { name: en['options.moreControls'], exact: true });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(apply).toBeVisible();
  await expectBarsFit(page);
});

test('a locally changed preset label reflows the strip without a window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openEditor(page);
  const more = page.getByRole('button', { name: en['options.moreControls'], exact: true });
  await expect(more).toBeHidden();
  await page.getByTitle(en['options.saveTheCurrentTool'], { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en['common.enterAValue'], exact: true });
  const name = 'Long custom brush preset '.repeat(12);
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: en['common.ok'], exact: true }).click();
  await expect(more).toBeVisible();
  await expectBarsFit(page);
  await more.click();
  await expect(page.getByRole('button', { name: en['options.preset'], exact: true })).toHaveText(name.trim());
});

test('status controls stay pinned right while dynamic information clips and frame durations change', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openEditor(page);
  const fixture = { format: 'pixprite', version: 5, name: 'Status alignment', width: 8, height: 8,
    frames: [10, 65535].map(duration => ({ duration })), images: [],
    layers: [{ name: 'Long layer name '.repeat(12), cels: [null, null] }], tags: [] };
  const chooser = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await chooser).setFiles({ name: 'Status alignment.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByTestId('document-tabs').getByText(fixture.name, { exact: true })).toBeVisible();
  const status = page.getByTestId('status-bar');
  const play = status.getByTitle(en['status.playEnter'], { exact: true });
  const zoom = status.getByTitle(en['status.zoom'], { exact: true });
  const info = page.getByTestId('status-info');
  const first = page.locator('[data-hit=frame][data-f="0"]');
  const last = page.locator('[data-hit=frame][data-f="1"]');
  for (const width of [1280, 800, 1024]) {
    await page.setViewportSize({ width, height: 850 });
    await first.click();
    await expect(play).toBeVisible();
    const before = { play: (await play.boundingBox())!, zoom: (await zoom.boundingBox())! };
    await last.click();
    await last.hover();
    await expect(info).toContainText('Frame 2');
    await expect.poll(async () => ({ play: (await play.boundingBox())!.x, zoom: (await zoom.boundingBox())!.x }))
      .toEqual({ play: before.play.x, zoom: before.zoom.x });
    const plus = (await status.getByTitle(en['status.zoomIn'], { exact: true }).boundingBox())!;
    expect(Math.abs(width - plus.x - plus.width - 6)).toBeLessThanOrEqual(1);
    expect(await info.evaluate(el => getComputedStyle(el).overflowX)).toBe('hidden');
    if (width === 800) expect(await info.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expectBarsFit(page);
  }
});
