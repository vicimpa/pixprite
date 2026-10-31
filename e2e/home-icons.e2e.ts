import { expect, test, type Page } from '@playwright/test';

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(input).toBeFocused();
  await input.fill(id);
  await page.locator(`[data-command="${id}"]`).click();
  await expect(input).toBeHidden();
}

async function setup(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript(prefs => {
    const registry = '/__e2e__/icon-packs/registry.json';
    localStorage.setItem('pixprite:extensionRegistry', registry);
    if (!localStorage.getItem('pixprite:prefs')) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: [registry], ...prefs }));
  }, prefs);
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
}

for (const language of ['en', 'ru']) for (const uiFont of ['system', 'pixelify', 'tiny5']) {
  test(`Home wraps ${language} labels and large ${uiFont} text without horizontal overflow`, async ({ page }) => {
    await setup(page, { language, uiSize: 'large', uiFont });
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1024, 800, 360]) {
      await page.setViewportSize({ width, height: 800 });
      const home = page.getByTestId('home-page');
      await expect.poll(() => home.evaluate(root => {
        const bad = [...root.querySelectorAll('section, button, p, h1, h2')].filter(e => e.clientWidth && e.scrollWidth > e.clientWidth + 1);
        return { pageOverflows: root.scrollWidth > root.clientWidth + 1, bad: bad.map(e => e.textContent) };
      })).toEqual({ pageOverflows: false, bad: [] });
      // Include the storage section below the fold, where captions used to remain nowrap.
      await home.locator('section[aria-label]').scrollIntoViewIfNeeded();
      await expect.poll(() => home.locator('section[aria-label] > span').evaluateAll(spans => spans.filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.textContent))).toEqual([]);
    }
  });
}

test('both built-ins work offline, switch live in Preferences and retain their dimensions and choice', async ({ page, context }) => {
  await setup(page);
  await expect(page.locator('[data-icon=home][data-icon-pack=outline]').first()).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-icon=home][data-icon-pack=outline]').first()).toBeVisible();
  await command(page, 'edit.prefs');
  const prefs = page.getByRole('dialog', { name: 'Preferences', exact: true });
  const choice = prefs.getByTitle('Icon pack', { exact: true });
  const preview = prefs.getByLabel('Icon preview');
  await expect(preview.locator('[data-icon-style=vector]')).toHaveCount(8);
  const dimensions = await preview.locator('svg').evaluateAll(icons => icons.map(i => [i.getBoundingClientRect().width, i.getBoundingClientRect().height]));
  await choice.click(); await page.locator('[data-select-popup]').getByText('Pixel', { exact: true }).click();
  await expect(preview.locator('[data-icon-style=pixel]')).toHaveCount(8);
  expect(await preview.locator('svg').evaluateAll(icons => icons.map(i => [i.getBoundingClientRect().width, i.getBoundingClientRect().height]))).toEqual(dimensions);
  await prefs.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-icon=home][data-icon-style=pixel]').first()).toBeVisible();
  await command(page, 'window.icons.outline');
  await page.reload();
  await expect(page.locator('[data-icon=home][data-icon-style=vector]').first()).toBeVisible();
});

test('Duotone extension switches live, survives reload and falls back to built-in Outline on disable/removal', async ({ page }) => {
  await setup(page);
  await command(page, 'extensions.openStore');
  const store = page.getByRole('dialog');
  const row = store.locator('div').filter({ has: page.locator('span').filter({ hasText: /^Duotone icons / }) })
    .filter({ has: page.getByRole('button', { name: 'Install', exact: true }) }).last();
  await row.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await store.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'edit.prefs');
  const prefs = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await prefs.getByTitle('Icon pack', { exact: true }).click();
  await page.locator('[data-select-popup]').getByText('Duotone', { exact: true }).click();
  await expect(prefs.getByLabel('Icon preview').locator('[data-icon-pack="icons-duotone:duotone"]')).toHaveCount(8);
  await prefs.getByRole('button', { name: 'Done', exact: true }).click();
  const home = page.locator('[data-icon=home]').first();
  await expect(home.locator('path[fill="var(--accent)"]')).toHaveCount(1);
  await page.reload();
  await expect(home).toHaveAttribute('data-icon-pack', 'icons-duotone:duotone');
  await command(page, 'extensions.openInstalled');
  const installed = page.getByRole('dialog');
  const duotone = installed.locator('div').filter({ has: page.locator('span').filter({ hasText: /^Duotone icons / }) }).filter({ has: page.getByRole('checkbox') }).last();
  await duotone.getByRole('checkbox').click();
  await expect(duotone.getByRole('checkbox')).not.toBeChecked();
  await expect(home).toHaveAttribute('data-icon-pack', 'outline');
  await duotone.getByRole('checkbox').click();
  await expect(duotone.getByRole('checkbox')).toBeChecked();
  await expect(home).toHaveAttribute('data-icon-pack', 'icons-duotone:duotone');
  await duotone.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(home).toHaveAttribute('data-icon-pack', 'outline');
  await installed.getByRole('button', { name: 'Close', exact: true }).click();
});

test('Window menu exposes both built-ins on Home and in the editor with a current-selection mark', async ({ page }) => {
  await setup(page);
  const openIcons = async () => {
    await page.getByText('Window', { exact: true }).click();
    await page.getByText('Icon pack', { exact: true }).hover();
  };
  const entry = (label: string) => page.getByText(label, { exact: true }).locator('..');
  await openIcons();
  await expect(entry('Outline').locator('[data-icon=check]')).toHaveCount(1);
  await expect(entry('Pixel').locator('[data-icon=check]')).toHaveCount(0);
  await expect(page.getByText('Install icon packs…', { exact: true })).toHaveCount(0);
  await page.getByText('Pixel', { exact: true }).click();
  await expect(page.locator('[data-icon=home][data-icon-style=pixel]').first()).toBeVisible();
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await openIcons();
  await expect(entry('Pixel').locator('[data-icon=check]')).toHaveCount(1);
  await page.getByText('Outline', { exact: true }).click();
  await expect(page.locator('[data-icon=home][data-icon-style=vector]').first()).toBeVisible();
  await page.locator('[data-home]').click();
  await command(page, 'window.icons.builtin');
  await page.reload();
  await openIcons();
  await expect(entry('Pixel').locator('[data-icon=check]')).toHaveCount(1);
});

for (const [saved, resolved] of [['builtin', 'builtin'], ['icons-pixel:pixel', 'builtin'], ['icons-outline:outline', 'outline']]) {
  test(`existing icon preference ${saved} resolves to built-in ${resolved} without an extension`, async ({ page }) => {
    await setup(page, { iconPack: saved });
    await expect(page.locator('[data-icon=home]').first()).toHaveAttribute('data-icon-pack', resolved);
    await page.reload();
    await expect(page.locator('[data-icon=home]').first()).toHaveAttribute('data-icon-pack', resolved);
  });
}
