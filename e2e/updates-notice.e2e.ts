import { expect, test } from '@playwright/test';

for (const language of ['en', 'ru']) test(`release notice floats above the workspace and can be dismissed (${language})`, async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.addInitScript(language => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language, uiSize: 'large', keyStyle: 'pc' }));
    const callbacks = new Set<(state: any) => void>();
    (window as any).__updateActions = [];
    (window as any).__release = (version: string) => callbacks.forEach(fn => fn({ currentVersion: '0.0.2', version, url: `https://github.com/vicimpa/pixprite/releases/tag/v${version}` }));
    (window as any).pixpriteDesktop = {
      runtime: 'tauri', platform: 'darwin', windowId: 'main', recoveryWindows: [],
      readSessions: async () => ({}), reportSession: async () => {}, recoveredWindows() {},
      windowState: async () => ({ focused: true, maximized: false, fullscreen: false }), onWindowState: () => () => {}, controlWindow: async () => {},
      ready() {}, onRequest() {}, onFiles() {}, setLanguage() {},
      getUpdate: async () => ({ currentVersion: '0.0.2' }),
      onUpdate(callback: (state: any) => void) { callbacks.add(callback); return () => callbacks.delete(callback); },
      update: async (action: string) => { (window as any).__updateActions.push(action); },
    };
  }, language);
  await page.goto('/');
  const home = page.getByTestId('home-page'), notice = page.getByTestId('desktop-update');
  await expect(home).toBeVisible(); await expect(notice).toHaveCount(0);
  const before = await home.boundingBox();
  await page.evaluate(() => (window as any).__release('0.0.3'));
  await expect(notice.getByRole('status')).toContainText('0.0.3');
  expect(await home.boundingBox()).toEqual(before);
  expect(await notice.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
  await notice.getByRole('button').first().click();
  expect(await page.evaluate(() => (window as any).__updateActions)).toEqual(['open']);
  // Large Russian text still fits a narrow window and keeps both actions accessible.
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await notice.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const box = await notice.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  if (language === 'ru') await page.screenshot({ path: test.info().outputPath('update-notice.png') });
  await notice.getByRole('button').last().click(); await expect(notice).toHaveCount(0);
  await page.evaluate(() => (window as any).__release('0.0.3')); await expect(notice).toHaveCount(0);
  await page.evaluate(() => (window as any).__release('0.0.4')); await expect(notice).toContainText('0.0.4');
});
