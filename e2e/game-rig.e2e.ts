import { expect, test, type Page } from '@playwright/test';

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a command… (= calculates)').fill(id);
  await page.locator(`[data-command="${id}"]`).click();
}

test('game rig dropdowns open and select without scrolling the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/game-rig/registry.json'] }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await command(page, 'extensions.openStore');
  const store = page.getByRole('dialog');
  await store.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await store.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(store.getByText('Running', { exact: true })).toBeVisible();
  await store.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'game-rig:settings');
  const rig = page.frameLocator('iframe[title="Game rig"]');
  const movement = rig.getByRole('button', { name: 'Top-down', exact: true });
  await expect(movement).toBeVisible();
  const scroll = () => rig.locator('body').evaluate(() => [scrollY, document.body.scrollTop]);
  const before = await scroll();
  await movement.click();
  const popup = rig.getByRole('listbox');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS('position', 'fixed');
  expect(await scroll()).toEqual(before);
  await popup.getByRole('option', { name: 'Platformer', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(rig.getByRole('button', { name: 'Platformer', exact: true })).toBeVisible();
  expect(await scroll()).toEqual(before);

  await rig.getByText('Preview: background and camera', { exact: true }).click();
  const background = rig.getByRole('button', { name: 'Checker', exact: true });
  await background.scrollIntoViewIfNeeded();
  const scrolled = await scroll();
  await background.click();
  await expect(popup).toBeVisible();
  expect(await scroll()).toEqual(scrolled);
  await background.press('ArrowDown');
  await background.press('Enter');
  await expect(popup).toBeHidden();
  await expect(rig.getByRole('button', { name: 'Grid lines', exact: true })).toBeVisible();
  expect(await scroll()).toEqual(scrolled);

  // Legacy direct-child width/flex rules must survive enhancement and docking resize.
  const iframe = page.locator('iframe[title="Game rig"]');
  const panel = iframe.locator('xpath=..');
  const splitter = panel.locator('xpath=preceding-sibling::px-splitter[1]');
  const beforeWidth = (await iframe.boundingBox())!.width;
  const grip = (await splitter.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 40);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + 40, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await iframe.boundingBox())!.width - beforeWidth)).toBe(100);
  await expect.poll(() => rig.locator('body').evaluate(() => [...document.querySelectorAll<HTMLElement>('button,input,select')].filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).map(el => el.outerHTML))).toEqual([]);
  await expect(rig.getByRole('button', { name: 'Platformer', exact: true })).toBeVisible();
  await expect(rig.getByRole('button', { name: 'Grid lines', exact: true })).toBeVisible();
});
