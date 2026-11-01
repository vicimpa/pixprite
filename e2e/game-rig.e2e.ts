import { expect, test, type Page } from '@playwright/test';

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Type a command… (= calculates)');
  // Reopening clears the previous query in an effect before accepting new input.
  await expect(input).toHaveValue('');
  await input.fill(id);
  await page.locator(`[data-command="${id}"]`).click();
}

async function installRig(page: Page, animation = false) {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/game-rig/registry.json'] }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  if (animation) {
    const fixture = { format: 'pixprite', version: 5, name: 'Platformer rig', width: 32, height: 32,
      frames: Array.from({ length: 5 }, () => ({ duration: 100 })), images: [],
      layers: [{ name: 'Hero', cels: Array(5).fill(null) }],
      tags: ['idle', 'walk', 'run', 'jump', 'fall'].map((name, f) => ({ name, from: f, to: f, direction: 'forward', color: '#ff0000' })) };
    const chooser = page.waitForEvent('filechooser'); await command(page, 'file.open');
    await (await chooser).setFiles({ name: fixture.name + '.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await expect(page.getByTitle(fixture.name + ' · 32×32', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  }
  await command(page, 'extensions.openStore');
  const store = page.getByRole('dialog');
  await store.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await store.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(store.getByText('Running', { exact: true })).toBeVisible();
  await store.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'game-rig:settings');
  return page.frameLocator('iframe[title="Game rig"]');
}

test('game rig dropdowns open and select without scrolling the panel', async ({ page }) => {
  const rig = await installRig(page);
  const movement = rig.getByRole('button', { name: 'Movement', exact: true });
  await expect(movement).toBeVisible();
  await expect(movement).toHaveText('Top-down');
  await expect(rig.locator('px-select')).not.toHaveCount(0);
  await expect(rig.locator('px-input')).not.toHaveCount(0);
  await expect(rig.locator('px-button')).not.toHaveCount(0);
  const scroll = () => rig.locator('body').evaluate(() => [scrollY, document.body.scrollTop]);
  const before = await scroll();
  await movement.click();
  const popup = rig.getByRole('listbox');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS('position', 'fixed');
  expect(await scroll()).toEqual(before);
  await popup.getByRole('option', { name: 'Platformer', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(movement).toHaveText('Platformer');
  expect(await scroll()).toEqual(before);

  await rig.getByText('Preview: background and camera', { exact: true }).click();
  const background = rig.getByRole('button', { name: 'Background', exact: true });
  // Keep the target clear of the sticky Play button before measuring popup-induced scrolling.
  await background.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const scrolled = await scroll();
  await background.click();
  await expect(popup).toBeVisible();
  expect(await scroll()).toEqual(scrolled);
  await background.press('ArrowDown');
  await background.press('Enter');
  await expect(popup).toBeHidden();
  await expect(background).toHaveText('Grid lines');
  expect(await scroll()).toEqual(scrolled);

  // Shared React controls retain their layout after docking resize.
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
  await expect(movement).toHaveText('Platformer');
  await expect(background).toHaveText('Grid lines');
});

test('TSX rig settings keep input focus, persist edits and mount the shared preview controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const rig = await installRig(page);
  const speed = rig.getByRole('spinbutton', { name: 'Animation speed', exact: true });
  await expect(speed).toHaveValue('100');
  await speed.fill('175');
  await speed.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const fieldBox = (await speed.boundingBox())!;
  await page.mouse.move(fieldBox.x + 6, fieldBox.y + fieldBox.height / 2); await page.mouse.down();
  await page.mouse.move(fieldBox.x + fieldBox.width - 16, fieldBox.y + fieldBox.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(speed).toHaveValue('175');
  await speed.dblclick({ position: { x: 12, y: fieldBox.height / 2 } });
  await page.keyboard.type('165'); await expect(speed).toHaveValue('165');
  // React synchronisation must preserve the caret after every typed digit.
  await speed.press('Shift+ArrowLeft'); await page.keyboard.type('7'); await expect(speed).toHaveValue('167');
  await speed.fill('175');
  await expect(speed).toBeFocused();
  await expect(speed).toHaveValue('175');
  const loop = rig.getByRole('checkbox', { name: 'Loop', exact: true });
  await loop.uncheck();
  await expect(page.locator('iframe[title="Game rig"]')).toHaveCount(1);
  // Play flushes the pending debounce before the preview reads the model.
  await rig.getByRole('button', { name: '▶ Play', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Game preview"]');
  await expect(preview.getByRole('checkbox', { name: 'Collider', exact: true })).toBeChecked();
  await preview.getByRole('checkbox', { name: 'Collider', exact: true }).uncheck();
  await preview.getByRole('checkbox', { name: 'Slices', exact: true }).check();
  await expect(preview.locator('.info')).toContainText('idle');
  await preview.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(preview.locator('#view')).toBeFocused();
  await page.locator('iframe[title="Game preview"]').locator('xpath=..').locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('iframe[title="Game rig"]').locator('xpath=..').locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'game-rig:settings');
  await expect(speed).toHaveValue('175');
  await expect(loop).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('catalog explains and blocks an extension requiring a newer editor', async ({ page }) => {
  await page.route('**/__e2e__/game-rig/registry.json', async route => {
    const response = await route.fetch(), catalog = await response.json();
    catalog.extensions[0].minEditorVersion = '99.0.0';
    await route.fulfill({ json: catalog });
  });
  await page.addInitScript(() => {
    if (window === top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', extensionCatalogs: ['/__e2e__/game-rig/registry.json'] }));
  });
  await page.goto('/');
  await command(page, 'extensions.openStore');
  const store = page.getByRole('dialog');
  await expect(store.getByText('Requires Pixprite 99.0.0 or newer. Update the editor.', { exact: true })).toBeVisible();
  await expect(store.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
});

test('collider stays draggable after React updates and restores its drawing when reopened', async ({ page }) => {
  const rig = await installRig(page);
  await rig.getByText('Collider and shadow', { exact: true }).click();
  const canvas = rig.locator('canvas.collider');
  await canvas.scrollIntoViewIfNeeded();
  const picture = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  const before = await picture();
  const box = (await canvas.boundingBox())!;
  // Draw a fresh box in the empty upper part, then resize it in a second gesture.
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  };
  await drag(box.x + box.width / 8, box.y + box.height / 8, box.width / 4, box.height / 4);
  await expect.poll(picture).not.toBe(before);
  const first = await picture();
  await drag(box.x + box.width * 3 / 8, box.y + box.height * 3 / 8, box.width / 8, box.height / 8);
  await expect.poll(picture).not.toBe(first);
  const final = await picture();
  const panel = page.locator('iframe[title="Game rig"]').locator('xpath=..');
  await panel.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'game-rig:settings');
  await rig.getByText('Collider and shadow', { exact: true }).click();
  await expect.poll(picture).toBe(final);
});

test('platformer prepares side states, jumps with zero coyote time, falls, lands and changes facing', async ({ page }) => {
  const rig = await installRig(page, true);
  await rig.getByRole('button', { name: 'Movement', exact: true }).click();
  await rig.getByRole('option', { name: 'Platformer', exact: true }).click();
  await expect(rig.locator('.chip').filter({ hasText: 'Jump' })).toHaveCount(1);
  await expect(rig.locator('.chip').filter({ hasText: 'Fall' })).toHaveCount(1);
  await rig.locator('summary').filter({ hasText: /^Movement$/ }).click();
  const grace = rig.getByRole('spinbutton', { name: 'Coyote time', exact: true });
  await grace.fill('0'); await grace.press('Tab');
  await rig.getByRole('button', { name: '▶ Play', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Game preview"]');
  const canvas = preview.locator('#view'), info = preview.locator('.info');
  await expect(info).toContainText('idle/e');
  // Fall can last less than Playwright's retry interval. Observe transitions in
  // the page so a short but correctly rendered state cannot be missed by polling.
  await info.evaluate(el => {
    const states = new Set<string>();
    new MutationObserver(() => {
      states.add(el.textContent!.split('/')[0]);
      el.setAttribute('data-states', [...states].join(','));
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await canvas.focus(); await page.keyboard.down('Space');
  await expect(info).toHaveAttribute('data-states', /jump/);
  await expect(info).toHaveAttribute('data-states', /fall/);
  await page.keyboard.up('Space');
  await expect(info).toContainText('idle/e');
  // Holding the key does not auto-jump; a new press after landing does.
  await page.keyboard.down('Space'); await expect(info).toContainText('jump/e'); await page.keyboard.up('Space');
  await expect(info).toContainText('idle/e');
  await page.keyboard.down('KeyA'); await expect(info).toContainText('walk/w'); await page.keyboard.up('KeyA');
  await preview.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(info).toContainText('idle/e'); await expect(canvas).toBeFocused();
});

test('a one-direction platformer mirrors the character when walking left', async ({ page }) => {
  const rig = await installRig(page, true);
  await rig.getByRole('button', { name: 'Movement', exact: true }).click();
  await rig.getByRole('option', { name: 'Platformer', exact: true }).click();
  await rig.getByRole('button', { name: '1', exact: true }).click();
  await rig.getByRole('button', { name: '▶ Play', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Game preview"]'), canvas = preview.locator('#view');
  await expect(preview.locator('.info')).toContainText('idle/any');
  await canvas.evaluate(el => {
    const context = (el as HTMLCanvasElement).getContext('2d')!, scale = context.scale.bind(context);
    context.scale = (x, y) => { (el as HTMLElement).dataset.mirror = String(x); scale(x, y); };
  });
  await canvas.focus(); await page.keyboard.down('KeyA');
  await expect(canvas).toHaveAttribute('data-mirror', '-1'); await page.keyboard.up('KeyA');
});
