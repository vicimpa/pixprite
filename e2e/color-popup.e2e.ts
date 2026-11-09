import { expect, test, type Page } from '@playwright/test';

async function create(page: Page, language = 'en', large = false) {
  await page.addInitScript(({ language, large }) => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language, uiSize: large ? 'large' : 'medium', keyStyle: 'pc', autosave: false }));
  }, { language, large });
  await page.goto('/');
  await page.getByRole('button', { name: language === 'ru' ? 'Свой размер…' : 'Custom size…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: language === 'ru' ? 'Создать' : 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

for (const language of ['en', 'ru']) test(`color popup edits local HEX/RGB/alpha without switching picker tabs (${language})`, async ({ page }) => {
  const ru = language === 'ru';
  await page.setViewportSize({ width: ru ? 800 : 1280, height: ru ? 600 : 900 });
  await create(page, language, ru);
  const samples = page.locator('[data-color-samples]');
  const primary = samples.getByRole('button', { name: ru ? 'Редактировать основной цвет' : 'Edit primary color', exact: true });
  const secondary = samples.getByRole('button', { name: ru ? 'Редактировать фоновый цвет' : 'Edit secondary color', exact: true });
  const secondaryBefore = await secondary.textContent();
  const hsl = page.getByRole('button', { name: 'HSL', exact: true });
  await hsl.click();
  await primary.click();
  const popup = page.getByRole('dialog', { name: ru ? 'Редактировать основной цвет' : 'Edit primary color', exact: true });
  const hex = popup.getByRole('textbox', { name: 'HEX', exact: true });
  await hex.fill('  #12345680  ');
  await expect(primary).toHaveText('#12345680');
  await expect(popup.getByRole('spinbutton', { name: 'R', exact: true })).toHaveValue('18');
  await expect(popup.getByRole('spinbutton', { name: 'G', exact: true })).toHaveValue('52');
  await expect(popup.getByRole('spinbutton', { name: 'B', exact: true })).toHaveValue('86');
  await expect(popup.getByRole('spinbutton', { name: 'A', exact: true })).toHaveValue('128');
  await hex.fill('#12345');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  await expect(primary).toHaveText('#12345680');
  await hex.fill('abcdef');
  await expect(primary).toHaveText('#abcdef80');
  await hex.fill('#abc');
  await expect(primary).toHaveText('#aabbcc80');
  await hex.fill('#abcd');
  await expect(primary).toHaveText('#aabbccdd');
  await popup.getByRole('spinbutton', { name: 'R', exact: true }).fill('10');
  await expect(hex).toHaveValue('#0abbccdd');
  await expect(secondary).toHaveText(secondaryBefore!);
  await expect(hsl).toHaveAttribute('data-px-active', 'true');
  await page.screenshot({ path: test.info().outputPath(`color-popup-${language}.png`) });
  const rect = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  expect(await popup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Escape must close from inside a text field and return keyboard focus.
  await hex.focus(); await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible(); await expect(primary).toBeFocused();
  await page.keyboard.press('Enter'); await expect(popup).toBeVisible();
  await secondary.click();
  await expect(popup).not.toBeVisible();
  const other = page.getByRole('dialog', { name: ru ? 'Редактировать фоновый цвет' : 'Edit secondary color', exact: true });
  await other.getByRole('textbox', { name: 'HEX', exact: true }).fill('#102030');
  await expect(secondary).toHaveText('#102030');
  await expect(primary).toHaveText('#0abbccdd');
  await hsl.click(); await expect(other).not.toBeVisible();
  await primary.click(); await expect(hex).toHaveValue('#0abbccdd');
});

test('color popup handles system selection, screen picking, cancellation and disposal', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value() {
      document.body.dataset.systemPickerOpened = 'true';
      if (document.body.dataset.pickMode === 'cancel') return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(this, '#13579b');
      this.dispatchEvent(new Event('change', { bubbles: true }));
    } });
    Object.defineProperty(window, 'EyeDropper', { configurable: true, value: class {
      async open({ signal }: { signal: AbortSignal }) {
        const mode = document.body.dataset.pickMode;
        if (mode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
        if (mode === 'fail') throw new Error('Unavailable');
        if (mode === 'pending') return new Promise<{ sRGBHex: string }>((_, reject) => {
          signal.addEventListener('abort', () => { document.body.dataset.pickAborted = 'true'; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
        });
        return { sRGBHex: '#2468ac' };
      }
    } });
  });
  await create(page);
  const primary = page.locator('[data-color-samples]').getByRole('button', { name: 'Edit primary color', exact: true });
  await primary.click();
  const popup = page.getByRole('dialog', { name: 'Edit primary color', exact: true });
  await popup.getByRole('textbox', { name: 'HEX', exact: true }).fill('#11223380');
  await popup.getByRole('button', { name: 'System color picker…', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-system-picker-opened', 'true');
  await expect(primary).toHaveText('#13579b80');
  const screen = popup.getByRole('button', { name: 'Pick color from screen…', exact: true });
  await screen.click(); await expect(primary).toHaveText('#2468ac80');
  await page.evaluate(() => { document.body.dataset.pickMode = 'cancel'; });
  await screen.click();
  await popup.getByRole('button', { name: 'System color picker…', exact: true }).click();
  await expect(primary).toHaveText('#2468ac80');
  await expect(popup.getByRole('status')).toHaveCount(0);
  await page.evaluate(() => { document.body.dataset.pickMode = 'fail'; });
  await screen.click(); await expect(popup.getByRole('status')).toBeVisible();
  await page.evaluate(() => { document.body.dataset.pickMode = 'pending'; });
  await screen.click(); await expect(screen).toBeDisabled();
  await popup.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pick-aborted', 'true');
  await expect(primary).toHaveText('#2468ac80');
});

for (const language of ['en', 'ru']) test(`color popup wraps unsupported screen picking message (${language})`, async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(() => Object.defineProperty(window, 'EyeDropper', { value: undefined, configurable: true }));
  await create(page, language, true);
  const ru = language === 'ru';
  const label = ru ? 'Редактировать основной цвет' : 'Edit primary color';
  await page.locator('[data-color-samples]').getByRole('button', { name: label, exact: true }).click();
  const popup = page.getByRole('dialog', { name: label, exact: true });
  await expect(popup.getByRole('button', { name: ru ? 'Выбрать цвет с экрана…' : 'Pick color from screen…', exact: true })).toBeDisabled();
  const message = popup.getByText(ru ? 'Выбор цвета с экрана недоступен в этом браузере или системном WebView.' : 'Screen color picking is unavailable in this browser or system WebView.', { exact: true });
  await expect(message).toBeVisible();
  const layout = await message.evaluate(el => {
    const rect = el.getBoundingClientRect(), popup = el.closest('[role=dialog]')!.getBoundingClientRect();
    return { height: rect.height, font: parseFloat(getComputedStyle(el).fontSize), right: rect.right, popupRight: popup.right };
  });
  expect(layout.height).toBeGreaterThan(layout.font * 1.5);
  expect(layout.right).toBeLessThanOrEqual(layout.popupRight);
  expect(await popup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`screen-picker-unavailable-${language}.png`) });
  await expect(popup.getByRole('button', { name: ru ? 'Системный выбор цвета…' : 'System color picker…', exact: true })).toBeEnabled();
});

test('desktop screen picker works without EyeDropper and preserves alpha on selection and cancellation', async ({ page }) => {
  await create(page);
  // Install only after startup: this fixture replaces the screen-color adapter, not native storage/session initialization.
  await page.evaluate(() => {
    Object.defineProperty(window, 'EyeDropper', { configurable: true, value: undefined });
    Object.defineProperty(window, 'pixpriteDesktop', { configurable: true, value: {
      reportSession: async () => {},
      async pickScreenColor({ signal }: { signal: AbortSignal }) {
        document.body.dataset.nativePickerOpened = 'true';
        const mode = document.body.dataset.nativePickMode;
        if (mode === 'cancel') return null;
        if (mode === 'fail') throw new Error('Native picker failed');
        if (mode === 'pending') return new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            document.body.dataset.nativePickAborted = 'true';
            reject(new DOMException('Cancelled', 'AbortError'));
          }, { once: true });
        });
        return '#3a7bc0';
      },
    } });
  });
  const primary = page.locator('[data-color-samples]').getByRole('button', { name: 'Edit primary color', exact: true });
  await primary.click();
  const popup = page.getByRole('dialog', { name: 'Edit primary color', exact: true });
  await popup.getByRole('textbox', { name: 'HEX', exact: true }).fill('#11223380');
  const screen = popup.getByRole('button', { name: 'Pick color from screen…', exact: true });
  await expect(screen).toBeEnabled();
  await expect(popup.getByText('Screen color picking is unavailable in this browser or system WebView.', { exact: true })).toHaveCount(0);
  await screen.click();
  await expect(page.locator('body')).toHaveAttribute('data-native-picker-opened', 'true');
  await expect(primary).toHaveText('#3a7bc080');
  await page.evaluate(() => { document.body.dataset.nativePickMode = 'cancel'; });
  await screen.click(); await expect(primary).toHaveText('#3a7bc080');
  await expect(popup.getByRole('status')).toHaveCount(0);
  await page.evaluate(() => { document.body.dataset.nativePickMode = 'fail'; });
  await screen.click(); await expect(popup.getByRole('status')).toBeVisible();
  await page.evaluate(() => { document.body.dataset.nativePickMode = 'pending'; });
  await screen.click(); await expect(screen).toBeDisabled();
  await expect(popup.getByRole('status')).toHaveText('Click a screen pixel to pick its color. Escape cancels.');
  await popup.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-native-pick-aborted', 'true');
  await expect(primary).toHaveText('#3a7bc080');
});
