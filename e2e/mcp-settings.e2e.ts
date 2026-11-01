import { expect, test, type Page } from '@playwright/test';

async function openPanel(page: Page) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder(/^(Type a command|Введите команду)/);
  await field.fill('edit.mcp');
  await page.locator('[data-command="edit.mcp"]').click();
}

for (const language of ['en', 'ru']) test(`MCP settings configure a desktop client and toggle the server (${language})`, async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(language => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language, keyStyle: 'pc' }));
    const info = {
      enabled: true, forced: false, blocked: false, running: true, url: 'http://127.0.0.1:12345/mcp' as string | null, token: 'test-token',
      port: 3356, activePort: 12345, serverPid: 9876, error: null,
      connectionFile: '/Users/test/Custom "profile"/connection.json',
    };
    (window as any).__mcpCalls = [];
    (window as any).__mcpFail = false;
    (window as any).__forceMcp = () => { info.forced = true; info.blocked = false; };
    (window as any).__blockMcp = () => { info.forced = false; info.blocked = true; info.running = false; info.url = null; };
    (window as any).pixpriteDesktop = {
      runtime: 'tauri', platform: 'darwin', windowId: 'main', recoveryWindows: [],
      readSessions: async () => ({}), reportSession: async () => {}, recoveredWindows() {},
      windowState: async () => ({ focused: true, maximized: false, fullscreen: false }), onWindowState: () => () => {}, controlWindow: async () => {},
      ready() {}, onRequest() {}, onFiles() {}, setLanguage() {},
      getUpdate: async () => ({ currentVersion: '0.0.4' }), onUpdate: () => () => {}, update: async () => {},
      copyText: language === 'ru' ? async (text: string) => { (window as any).__mcpCopied = text; } : undefined,
      async mcp(enabled?: boolean, port?: number) {
        (window as any).__mcpCalls.push(enabled ?? null);
        if ((window as any).__mcpFail) throw new Error('Cannot save MCP settings');
        if (enabled !== undefined) { info.enabled = enabled; info.running = !info.blocked && (enabled || info.forced); info.url = info.running ? 'http://127.0.0.1:12345/mcp' : null; }
        if (port !== undefined) info.port = port;
        return { ...info };
      },
    };
  }, language);
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await openPanel(page);
  const ru = language === 'ru';
  const dialog = page.getByRole('dialog', { name: ru ? 'Настройки MCP' : 'MCP settings', exact: true });
  const checkbox = dialog.getByRole('checkbox');
  const config = dialog.getByRole('textbox', { name: ru ? 'Конфигурация MCP-клиента' : 'MCP client configuration', exact: true });
  await expect(checkbox).toBeChecked();
  await expect(dialog.getByRole('status')).toHaveText(ru ? 'Сервер работает' : 'Server is running');
  expect(JSON.parse(await config.inputValue())).toEqual({ mcpServers: { pixprite: {
    url: 'http://127.0.0.1:12345/mcp', headers: { Authorization: 'Bearer test-token' },
  } } });
  const port = dialog.getByRole('spinbutton', { name: ru ? 'Порт MCP' : 'MCP port' });
  await port.fill('4567');
  await dialog.getByRole('button', { name: ru ? 'Сохранить порт' : 'Save port', exact: true }).click();
  await dialog.getByRole('button', { name: ru ? 'Копировать конфигурацию' : 'Copy configuration', exact: true }).click();
  await expect(dialog.getByText(ru ? 'Скопировано' : 'Copied', { exact: true })).toBeVisible();
  const copied = ru ? await page.evaluate(() => (window as any).__mcpCopied) : await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await config.inputValue());
  expect(JSON.parse(await config.inputValue()).mcpServers.pixprite).not.toHaveProperty('command');
  await checkbox.uncheck();
  await expect(dialog.getByRole('status').first()).toHaveText(ru ? 'Сервер отключён' : 'Server is disabled');
  await page.evaluate(() => { (window as any).__mcpFail = true; });
  await checkbox.click();
  await expect(dialog.getByRole('alert')).toContainText('Cannot save MCP settings');
  await expect(checkbox).not.toBeChecked();
  await page.evaluate(() => { (window as any).__mcpFail = false; });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: ru ? 'Готово' : 'Done', exact: true }).click();
  await openPanel(page);
  await expect(port).toHaveValue('4567');
  await page.evaluate(() => (window as any).__forceMcp());
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(dialog).toContainText('--mcp');
  await expect(dialog.getByRole('status').first()).toHaveText(ru ? 'Сервер работает' : 'Server is running');
  await page.evaluate(() => (window as any).__blockMcp());
  await dialog.getByRole('button', { name: ru ? 'Обновить / повторить' : 'Refresh / retry', exact: true }).click();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(dialog).toContainText('--no-mcp');
  await expect(dialog.getByRole('status').first()).toHaveText(ru ? 'Сервер отключён' : 'Server is disabled');
  await expect(config).toHaveCount(0);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (ru) await page.screenshot({ path: test.info().outputPath('mcp-settings-ru.png') });
});

test('web preferences explain that MCP requires desktop', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' })));
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.keyboard.press('Control+,');
  await page.getByRole('dialog', { name: 'Preferences', exact: true }).getByRole('button', { name: 'MCP settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'MCP settings', exact: true });
  await expect(panel).toContainText('MCP is available in the desktop app');
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
});
