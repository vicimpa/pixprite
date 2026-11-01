import { expect, test } from '@playwright/test';

for (const language of ['en', 'ru']) test(`preferences keep wrapped rows separate and MCP accessible (${language})`, async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(language => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language, uiSize: 'large', keyStyle: 'pc' }));
  }, language);
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.keyboard.press('Control+,');
  const ru = language === 'ru';
  const dialog = page.getByRole('dialog', { name: ru ? 'Настройки' : 'Preferences', exact: true });
  const scope = dialog.getByRole('button', { name: ru ? 'Диапазон воспроизведения' : 'Playback range', exact: true });
  await scope.scrollIntoViewIfNeeded();
  const select = await scope.boundingBox();
  const next = await dialog.getByRole('checkbox', { name: ru ? 'Один раз' : 'Play once', exact: true })
    .evaluate(input => { const box = input.closest('label')!.getBoundingClientRect(); return { top: box.top, bottom: box.bottom }; });
  await page.screenshot({ path: test.info().outputPath(`preferences-${language}.png`) });
  expect(next.top, 'the next checkbox must start below the playback selector').toBeGreaterThanOrEqual(select!.y + select!.height);
  const row = await scope.evaluate(button => { const box = button.closest('.px-dialog-row')!.getBoundingClientRect(); return { bottom: box.bottom }; });
  expect(row.bottom, 'a wrapped row must contain the selector').toBeGreaterThanOrEqual(select!.y + select!.height);
  if (ru) await expect(dialog).not.toContainText('per frame');
  const mcp = dialog.locator('.px-dialog-footer').getByRole('button', { name: ru ? 'Настройки MCP' : 'MCP settings', exact: true });
  await expect(mcp).toBeInViewport();
  await mcp.click();
  await expect(page.getByRole('dialog', { name: ru ? 'Настройки MCP' : 'MCP settings', exact: true })).toBeVisible();
});
