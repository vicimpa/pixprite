import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })));
  await page.goto('/'); await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
}
async function create(page: Page) {
  await setup(page); await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

test('@smoke dialog drag keeps its final position when fields rerender', async ({ page }) => {
  await setup(page);
  const dialog = page.getByRole('dialog'), title = dialog.locator(':scope > div').first();
  const before = (await dialog.boundingBox())!, head = (await title.boundingBox())!;
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(head.x + head.width / 2 + 80, head.y + head.height / 2 + 40, { steps: 16 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.x - before.x)).toBe(80);
  expect(Math.round((await dialog.boundingBox())!.y - before.y)).toBe(40);
  await dialog.getByRole('spinbutton').first().fill('64');
  expect(Math.round((await dialog.boundingBox())!.x - before.x)).toBe(80);
  expect(await dialog.evaluate(el => el.style.transform)).toBe('');
});

test('@smoke splitter resizes live without persisting every move, then survives reload', async ({ page }) => {
  await create(page);
  const splitter = page.locator('[data-splitter=columns]').first();
  const width = () => splitter.evaluate(el => el.previousElementSibling!.getBoundingClientRect().width);
  const before = await width(), box = (await splitter.boundingBox())!;
  // Let the initial settings write finish before observing the actual interaction.
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem('pixprite:layout'));
  await page.mouse.move(box.x + 2, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x + 92, box.y + 80, { steps: 24 });
  expect(Math.round(await width() - before)).toBe(90);
  expect(await page.evaluate(() => localStorage.getItem('pixprite:layout'))).toBe(stored);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:layout')!).colorsSize)).toBe(before + 90);
  await page.reload();
  // Autosave is disabled in this fixture; open a fresh document to check the restored layout.
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  expect(await width()).toBe(before + 90);
});

test('@smoke pointer cancellation commits the last splitter size and releases capture', async ({ page }) => {
  await create(page);
  const splitter = page.locator('[data-splitter=columns]').first();
  await splitter.evaluate(el => el.addEventListener('pointerdown', e => { (el as HTMLElement).dataset.pointerId = String((e as PointerEvent).pointerId); }, { once: true }));
  const box = (await splitter.boundingBox())!;
  const before = await splitter.evaluate(el => el.previousElementSibling!.getBoundingClientRect().width);
  await page.mouse.move(box.x + 2, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 42, box.y + 80);
  const pointerId = Number(await splitter.getAttribute('data-pointer-id'));
  await splitter.dispatchEvent('pointercancel', { pointerId }); await page.mouse.up();
  await expect(splitter).toHaveAttribute('data-drag', 'false');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:layout')!).colorsSize)).toBe(before + 40);
});

test('@smoke preview drag commits its position and retains it when reopened', async ({ page }) => {
  await create(page); await page.keyboard.press('Control+Alt+p');
  const title = page.getByText('Preview', { exact: true }).locator('xpath=..');
  const preview = title.locator('xpath=..');
  const before = (await preview.boundingBox())!, head = (await title.boundingBox())!;
  await page.mouse.move(head.x + 55, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(head.x - 25, head.y + head.height / 2 + 40, { steps: 12 }); await page.mouse.up();
  expect(Math.round((await preview.boundingBox())!.x - before.x)).toBe(-80);
  expect(Math.round((await preview.boundingBox())!.y - before.y)).toBe(40);
  await page.keyboard.press('Control+Alt+p'); await page.keyboard.press('Control+Alt+p');
  expect(Math.round((await preview.boundingBox())!.x - before.x)).toBe(-80);
  expect(await preview.evaluate(el => (el as HTMLElement).style.transform)).toBe('');
});

test('@smoke floating extension drag and resize commit geometry without losing the iframe', async ({ page }) => {
  await page.addInitScript(() => {
    const request = indexedDB.open('pixprite-extensions', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const installed = db.createObjectStore('installed', { keyPath: 'id' }); db.createObjectStore('storage');
      installed.put({ id: 'floating-probe', source: 'file', enabled: true, installedAt: 1,
        manifest: { id: 'floating-probe', name: 'Probe', version: '1.0.0', apiVersion: 1, permissions: ['ui:panel'], contributes: {
          panels: [{ id: 'panel', label: 'Floating probe', page: 'panel.html', dock: 'float', width: 260, height: 220 }],
        } }, files: { 'panel.html': { bytes: new TextEncoder().encode('<body><script>document.body.dataset.nonce=String(Math.random())</script><p>Persistent panel content</p></body>').buffer, type: 'text/html' } } });
    };
    request.onsuccess = () => request.result.close();
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' }));
  });
  await page.goto('/');
  const title = page.getByText('Floating probe', { exact: true }).locator('xpath=..');
  await expect(title).toBeVisible();
  const panel = title.locator('xpath=..');
  const frameBody = page.frameLocator('iframe[title="Floating probe"]').locator('body');
  const originalFrame = await frameBody.getAttribute('data-nonce');
  expect(originalFrame).toBeTruthy();
  const before = (await panel.boundingBox())!, head = (await title.boundingBox())!;
  await page.mouse.move(head.x + 100, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(head.x - 20, head.y + head.height / 2 + 40, { steps: 12 }); await page.mouse.up();
  expect(Math.round((await panel.boundingBox())!.x - before.x)).toBe(-120);
  expect(Math.round((await panel.boundingBox())!.y - before.y)).toBe(40);
  const grip = (await panel.locator('[data-edge=se]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 50, grip.y + grip.height / 2 + 30, { steps: 12 }); await page.mouse.up();
  expect(Math.round((await panel.boundingBox())!.width - before.width)).toBe(50);
  expect(Math.round((await panel.boundingBox())!.height - before.height)).toBe(30);
  expect(await frameBody.getAttribute('data-nonce')).toBe(originalFrame);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pixprite:extPanels') ?? 'null')?.panels['floating-probe/panel']?.w)).toBe(before.width + 50);
});
