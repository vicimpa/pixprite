import { expect, test, type Page } from '@playwright/test';
async function command(page: Page, id: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Control+k'); const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toHaveValue(''); await field.fill(id); await page.locator(`[data-command="${id}"]`).click();
}
const sample = (page: Page, ms: number) => page.evaluate(ms => new Promise<number[]>(resolve => {
  const frames = new Set<number>(), end = performance.now() + ms;
  const read = () => { const el = document.querySelector<HTMLElement>('[data-hit=frame][data-current=true]'); if (el) frames.add(Number(el.dataset.f));
    if (performance.now() < end) requestAnimationFrame(read); else resolve([...frames]); };
  read();
}), ms);

async function openAnimation(page: Page) {
  await page.addInitScript(() => { if (window === top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false })); });
  await page.goto('/');
  const fixture = { format: 'pixprite', version: 5, name: 'Playback seeks', width: 8, height: 8,
    frames: Array.from({ length: 6 }, () => ({ duration: 160 })), images: [],
    layers: [{ name: 'First', cels: Array(6).fill(null) }, { name: 'Second', cels: Array(6).fill(null) }],
    tags: [{ name: 'A', from: 0, to: 2, direction: 'forward', color: '#ff0000' }, { name: 'B', from: 3, to: 5, direction: 'reverse', color: '#00ff00' }] };
  const chooser = page.waitForEvent('filechooser'); await command(page, 'file.open');
  await (await chooser).setFiles({ name: fixture.name + '.pixprite', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('[data-key^="p:"]', { hasText: fixture.name }).dblclick();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

test('frame/layer selection keeps playing, seeks to the other tag and switches to the whole animation live', async ({ page }) => {
  await openAnimation(page);
  await page.locator('[data-hit=frame][data-f="0"]').click();
  await command(page, 'anim.play');
  const play = page.getByTestId('timeline-play');
  await expect(play).toHaveAttribute('data-px-active', 'true');
  await page.locator('[data-hit=frame][data-f="4"]').click();
  await expect(play).toHaveAttribute('data-px-active', 'true');
  const reverse = await sample(page, 750);
  expect(reverse.length).toBeGreaterThan(1); expect(reverse.every(f => f >= 3 && f <= 5)).toBe(true);
  await page.locator('[data-hit=layer][data-l="1"]').click();
  await expect(play).toHaveAttribute('data-px-active', 'true');
  await command(page, 'anim.first');
  const first = await sample(page, 750);
  expect(first.length).toBeGreaterThan(1); expect(first.every(f => f <= 2)).toBe(true);
  await play.click({ button: 'right' });
  const options = page.locator('[data-timeline-popup=playback]');
  await options.getByRole('button', { name: 'Playback range', exact: true }).click();
  await page.getByRole('option', { name: 'Entire animation', exact: true }).click();
  await page.keyboard.press('Escape');
  const all = await sample(page, 1250);
  expect(all.some(f => f >= 3)).toBe(true); expect(all.some(f => f <= 2)).toBe(true);
  await expect(play).toHaveAttribute('data-px-active', 'true');
  await play.click(); await expect(play).toHaveAttribute('data-px-active', 'false');
});

test('play once stops at the last frame unless rewind on stop is enabled', async ({ page }) => {
  await openAnimation(page);
  const play = page.getByTestId('timeline-play');
  await page.locator('[data-hit=frame][data-f="4"]').click();
  await play.click({ button: 'right' });
  let options = page.locator('[data-timeline-popup=playback]');
  await options.getByRole('checkbox', { name: 'Play once', exact: true }).check();
  await options.getByRole('checkbox', { name: 'Return to the start frame on stop', exact: true }).uncheck();
  await page.keyboard.press('Escape'); await play.click();
  await expect(play).toHaveAttribute('data-px-active', 'false');
  await expect(page.locator('[data-hit=frame][data-current=true]')).toHaveAttribute('data-f', '3');
  await page.locator('[data-hit=frame][data-f="4"]').click();
  await play.click({ button: 'right' }); options = page.locator('[data-timeline-popup=playback]');
  await options.getByRole('checkbox', { name: 'Return to the start frame on stop', exact: true }).check();
  await page.keyboard.press('Escape'); await play.click();
  await expect(play).toHaveAttribute('data-px-active', 'false');
  await expect(page.locator('[data-hit=frame][data-current=true]')).toHaveAttribute('data-f', '4');
});
