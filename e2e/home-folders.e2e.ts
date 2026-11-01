import { expect, test, type Page, type Locator } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en' })));
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2, 2);
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()));
  });
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file…/ }).click();
  await (await picker).setFiles(['First', 'Second'].map(name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(png) })));
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(2);
}

const project = (page: Page, name: string) => page.locator('[data-key^="p:"]', { hasText: name });
const folder = (page: Page, name: string) => page.locator('[data-key^="f:"]').filter({ has: page.getByText(name, { exact: true }) });

async function newFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await dialog.locator('input').fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(folder(page, name)).toBeVisible();
}

async function drag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await expect(target).toHaveAttribute('data-drop', 'true');
  await page.mouse.up();
}

test('projects move into a folder and back through breadcrumbs without opening a preview', async ({ page }) => {
  // Internal movement must work even when the host intercepts HTML drag-and-drop.
  await page.addInitScript(() => addEventListener('dragstart', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true));
  await setup(page);
  await newFolder(page, 'OpenBomber');
  await drag(page, project(page, 'First'), folder(page, 'OpenBomber'));
  await expect(project(page, 'First')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await folder(page, 'OpenBomber').click();
  await expect(project(page, 'First')).toBeVisible();
  await drag(page, project(page, 'First'), page.locator('nav [data-folder-drop=""]'));
  await expect(project(page, 'First')).toHaveCount(0);
  await page.locator('nav [data-folder-drop=""]').click();
  await expect(project(page, 'First')).toBeVisible();
  await page.reload();
  await expect(project(page, 'First')).toBeVisible();
  await expect(project(page, 'Second')).toBeVisible();
});

test('folder dragging rejects descendants and Escape cancels a valid destination', async ({ page }) => {
  await setup(page);
  await newFolder(page, 'OpenBomber');
  await folder(page, 'OpenBomber').click();
  await newFolder(page, 'Bomber Characters');
  await page.locator('nav [data-folder-drop=""]').click();
  // Search shows both parent and descendant cards in the same grid.
  const search = page.getByPlaceholder('Search in all folders…');
  await search.fill('Bomber');
  const parent = folder(page, 'OpenBomber'), child = folder(page, 'Bomber Characters');
  const a = (await parent.boundingBox())!, b = (await child.boundingBox())!;
  await page.mouse.move(a.x + 20, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await expect(child).toHaveAttribute('data-drop', 'false');
  await page.mouse.up();
  await search.fill('');
  await expect(parent).toBeVisible();
  await expect(child).toHaveCount(0);
  const p = (await project(page, 'First').boundingBox())!, dest = (await parent.boundingBox())!;
  await page.mouse.move(p.x + 20, p.y + 20);
  await page.mouse.down();
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 12 });
  await expect(parent).toHaveAttribute('data-drop', 'true');
  await page.keyboard.press('Escape');
  await expect(parent).toHaveAttribute('data-drop', 'false');
  await page.mouse.up();
  await expect(project(page, 'First')).toBeVisible();
  await parent.click();
  await expect(child).toBeVisible();
  await expect(project(page, 'First')).toHaveCount(0);
});

test('a selected group moves together and a cancelled drag leaves projects in place', async ({ page }) => {
  await setup(page);
  await newFolder(page, 'OpenBomber');
  await page.keyboard.press('Escape');
  await project(page, 'First').click({ modifiers: ['ControlOrMeta'] });
  await project(page, 'Second').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-key^="p:"][data-selected=true]')).toHaveCount(2);
  const source = (await project(page, 'First').boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + 40, source.y + 20, { steps: 3 });
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(2);
  await expect(page.locator('[data-key^="p:"][data-selected=true]')).toHaveCount(2);
  await drag(page, project(page, 'First'), folder(page, 'OpenBomber'));
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(0);
  await folder(page, 'OpenBomber').click();
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(2);
});
