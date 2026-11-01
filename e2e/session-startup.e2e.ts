import { expect, test } from '@playwright/test';

test('startup visibility and unload events cannot overwrite a window session before restoration', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' }));
    const monitor = window as any;
    monitor.__sessionReports = [];
    const libraryReady = new Promise(resolve => { monitor.__releaseLibrary = () => resolve({ path: '/profile', migrated: true }); });
    monitor.pixpriteDesktop = {
      runtime: 'tauri', platform: 'darwin', windowId: 'main', recoveryWindows: [],
      library: async (bytes: Uint8Array) => {
        const request = JSON.parse(new TextDecoder().decode(bytes));
        if (request.action === 'info') { monitor.__waitingLibrary = true; return libraryReady; }
        return request.action === 'list' ? [] : null;
      },
      readSessions: async () => ({ main: { tabs: [], active: 'home' } }),
      reportSession: async (value: unknown) => { monitor.__sessionReports.push(value); }, recoveredWindows() {},
      windowState: async () => ({ focused: true, maximized: false, fullscreen: false }), onWindowState: () => () => {}, controlWindow: async () => {},
      ready() {}, onRequest() {}, onFiles() {}, setLanguage() {},
      getUpdate: async () => ({ currentVersion: '0.0.4' }), onUpdate: () => () => {}, update: async () => {},
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).__waitingLibrary)).toBe(true);
  const writes = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('beforeunload'));
    delete (document as any).hidden;
    return (window as any).__sessionReports.length;
  });
  expect(writes).toBe(0);
  await page.evaluate(() => (window as any).__releaseLibrary());
  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__sessionReports.length)).toBeGreaterThan(0);
});
