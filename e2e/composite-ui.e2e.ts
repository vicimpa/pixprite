import { expect, test } from '@playwright/test';
import type { PxColorInputElement, PxDialogElement, PxFormElement, PxMenuBarElement, PxMenuElement, PxSliderElement, PxSplitterElement } from '../packages/ui/src/elements';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' })); });
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
});

test('React dialog supplies exactly one form to its Web Component controller', async ({ page }) => {
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  const dialog = page.locator('px-dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator('form')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog').getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('standalone dialog focuses the visible shared select instead of its hidden control', async ({ page }) => {
  await page.evaluate(() => {
    const dialog = document.createElement('px-dialog') as PxDialogElement;
    dialog.open = true; dialog.setAttribute('heading', 'Select-only dialog');
    dialog.innerHTML = '<px-select><select aria-label="Probe choice"><option value="first">First choice</option><option value="second">Second choice</option></select></px-select>';
    document.body.append(dialog);
  });
  const dialog = page.getByRole('dialog', { name: 'Select-only dialog' });
  const select = dialog.getByRole('button', { name: 'Probe choice' });
  await expect(select).toBeFocused();
  await select.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('px-dialog').evaluate(element => element.remove());
});

test('standalone menus expose keyboard semantics and dismiss without a consumer listener', async ({ page }) => {
  await page.locator('#root').evaluate(root => { (root as HTMLElement).style.display = 'none'; });
  await page.evaluate(() => {
    const trigger = document.createElement('button'); trigger.id = 'menu-invoker'; trigger.textContent = 'Probe menu invoker';
    document.body.append(trigger); trigger.focus();
    const menu = document.createElement('px-menu') as PxMenuElement;
    menu.items = [
      { label: 'Disabled item', disabled: true },
      { label: 'Checked item', checked: true },
      { label: 'Nested item', items: [{ label: 'Disabled child', disabled: true }, { label: 'Enabled child', run: () => document.body.dataset.menuPicked = 'child' }] },
      { label: 'Last item', run: () => document.body.dataset.menuPicked = 'last' },
    ];
    menu.x = 50; menu.y = 50; menu.invoker = trigger;
    document.body.append(menu); menu.focusFirst();
  });
  await expect(page.getByRole('menuitem', { name: 'Disabled item', exact: true })).toHaveAttribute('aria-disabled', 'true');
  const checked = page.getByRole('menuitemcheckbox', { name: 'Checked item', exact: true });
  await expect(checked).toHaveAttribute('aria-checked', 'true'); await expect(checked).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('menuitem', { name: 'Last item', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await expect(checked).toBeFocused();
  await page.keyboard.press('ArrowDown'); const nested = page.getByRole('menuitem', { name: 'Nested item', exact: true }); await expect(nested).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('menuitem', { name: 'Enabled child', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(nested).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape'); await expect(nested).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-menu-picked', 'child');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // The consumer keeps the host mounted; its global listener must now be idle.
  await expect(page.locator('px-menu')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Probe menu invoker', exact: true })).toBeFocused();
  await page.evaluate(() => window.addEventListener('keydown', event => { if (event.key === 'Escape') document.body.dataset.escapePrevented = String(event.defaultPrevented); }, { once: true, capture: true }));
  await page.keyboard.press('Escape'); await expect(page.locator('body')).toHaveAttribute('data-escape-prevented', 'false');
  await page.locator('px-menu').evaluate(element => element.remove());

  await page.evaluate(() => {
    const holder = document.createElement('div'); holder.id = 'menubar-probe'; holder.style.cssText = 'position:relative;width:400px;height:24px';
    const bar = document.createElement('px-menu-bar') as PxMenuBarElement;
    bar.menus = [{ label: 'First probe menu', items: () => [{ label: 'First action' }, { label: 'Last action' }] }, { label: 'Second probe menu', items: () => [{ label: 'Second action' }] }];
    holder.append(bar); document.body.append(holder);
  });
  const first = page.getByRole('menubar').getByRole('menuitem', { name: 'First probe menu', exact: true });
  const second = page.getByRole('menubar').getByRole('menuitem', { name: 'Second probe menu', exact: true });
  await first.focus(); await first.press('ArrowRight'); await expect(second).toBeFocused();
  await second.press('ArrowLeft'); await expect(first).toBeFocused();
  await first.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'First action', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(first).toBeFocused();
  await first.press('ArrowUp'); await expect(page.getByRole('menuitem', { name: 'Last action', exact: true })).toBeFocused();
  await page.keyboard.press('Space'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(first).toBeFocused();
  await page.locator('#menubar-probe').evaluate(element => element.remove());

  await page.evaluate(() => {
    const dialog = document.createElement('px-dialog') as PxDialogElement;
    dialog.open = true; dialog.setAttribute('heading', 'Menu-owning dialog'); dialog.innerHTML = '<button id="nested-menu-invoker">Nested menu invoker</button>'; document.body.append(dialog);
  });
  await expect(page.getByRole('button', { name: 'Nested menu invoker', exact: true })).toBeFocused();
  await page.evaluate(() => {
    const menu = document.createElement('px-menu') as PxMenuElement; menu.items = [{ label: 'Dialog menu item' }]; menu.invoker = document.getElementById('nested-menu-invoker')!;
    document.querySelector('px-dialog')!.append(menu); menu.focusFirst();
  });
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(page.getByRole('dialog', { name: 'Menu-owning dialog' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Menu-owning dialog' })).toBeHidden();
  await page.locator('px-dialog').evaluate(element => element.remove()); await page.locator('#menu-invoker').evaluate(element => element.remove());
});

test('shared form reset restores initial native defaults and emits one aggregate change', async ({ page }) => {
  await page.locator('#root').evaluate(root => { (root as HTMLElement).style.display = 'none'; });
  await page.evaluate(() => {
    const native = document.createElement('form'); native.id = 'reset-native-form';
    const form = document.createElement('px-form') as PxFormElement; form.id = 'reset-probe';
    form.values = { name: 'Initial override', size: 10, mode: 2, enabled: true };
    form.schema = [
      { key: 'name', type: 'text', label: 'Reset name', default: 'Schema name' },
      { key: 'size', type: 'number', label: 'Reset size', min: 1, max: 64, default: 8 },
      { key: 'mode', type: 'select', label: 'Reset mode', options: [{ value: 1, label: 'First reset mode' }, { value: 2, label: 'Second reset mode' }] },
      { key: 'enabled', type: 'checkbox', label: 'Reset enabled', default: true },
    ];
    form.addEventListener('valuechange', () => document.body.dataset.resetChanges = String(Number(document.body.dataset.resetChanges ?? 0) + 1));
    native.append(form); document.body.append(native);
  });
  const form = page.locator('#reset-probe');
  await form.getByRole('textbox', { name: 'Reset name' }).fill('Changed');
  await form.getByRole('spinbutton', { name: 'Reset size' }).fill('12');
  await form.getByRole('button', { name: 'Reset mode' }).click(); await page.getByRole('option', { name: 'First reset mode', exact: true }).click();
  await form.getByRole('checkbox', { name: 'Reset enabled' }).uncheck();
  await page.evaluate(async () => { document.body.dataset.resetChanges = '0'; (document.getElementById('reset-native-form') as HTMLFormElement).reset(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(await form.evaluate(element => (element as PxFormElement).values)).toEqual({ name: 'Initial override', size: 10, mode: 2, enabled: true });
  await expect(form.getByRole('textbox', { name: 'Reset name' })).toHaveValue('Initial override');
  await expect(form.getByRole('spinbutton', { name: 'Reset size' })).toHaveValue('10');
  await expect(form.getByRole('button', { name: 'Reset mode' })).toHaveText('Second reset mode');
  await expect(form.getByRole('checkbox', { name: 'Reset enabled' })).toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-reset-changes', '1');
  await form.getByRole('textbox', { name: 'Reset name' }).fill('Keep after canceled reset');
  await page.evaluate(async () => {
    const form = document.getElementById('reset-native-form') as HTMLFormElement;
    form.addEventListener('reset', event => event.preventDefault(), { once: true }); document.body.dataset.resetChanges = '0';
    form.reset(); await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(form.getByRole('textbox', { name: 'Reset name' })).toHaveValue('Keep after canceled reset');
  await expect(page.locator('body')).toHaveAttribute('data-reset-changes', '0');
  await page.locator('#reset-native-form').evaluate(element => element.remove());
});

test('shared declarative form preserves drafts and native controls while values change', async ({ page }) => {
  await page.locator('#root').evaluate(root => { (root as HTMLElement).style.display = 'none'; });
  await page.evaluate(() => {
    const native = document.createElement('form'); native.dataset.testid = 'native-probe-form';
    const form = document.createElement('px-form') as PxFormElement;
    form.id = 'probe-form';
    form.schema = [
      { key: 'name', type: 'text', label: 'Probe name', default: 'Initial' },
      { key: 'size', type: 'number', label: 'Probe size', min: 1, max: 64, default: 8 },
      { key: 'mode', type: 'select', label: 'Probe mode', options: [{ value: 1, label: 'First mode' }, { value: 2, label: 'Second mode' }] },
      { key: 'enabled', type: 'checkbox', label: 'Probe enabled', default: true },
    ];
    native.append(form); document.body.append(native);
    const input = form.querySelector<HTMLInputElement>('input[name=size]')!;
    input.dataset.identity = 'original';
    form.addEventListener('valuechange', () => document.body.dataset.formChanged = 'yes');
  });
  const form = page.locator('#probe-form');
  const size = form.getByRole('spinbutton', { name: 'Probe size' });
  await size.fill('');
  await form.evaluate(element => { (element as PxFormElement).values = { name: 'External', size: 8, mode: 1, enabled: true }; });
  await expect(size).toHaveValue('');
  await expect(size).toHaveAttribute('data-identity', 'original');
  await expect(form.getByRole('textbox', { name: 'Probe name' })).toHaveValue('External');
  await size.fill('12'); await size.press('Tab');
  await expect(page.locator('body')).toHaveAttribute('data-form-changed', 'yes');
  expect(await form.evaluate(element => (element as PxFormElement).values.size)).toBe(12);
  await form.getByRole('button', { name: 'Probe mode' }).click();
  await page.getByRole('option', { name: 'Second mode', exact: true }).click();
  expect(await form.evaluate(element => (element as PxFormElement).values.mode)).toBe(2);
  await form.getByRole('checkbox', { name: 'Probe enabled' }).uncheck();
  expect(await form.evaluate(element => (element as PxFormElement).values.enabled)).toBe(false);
  expect(await page.getByTestId('native-probe-form').evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toEqual({ name: 'External', size: '12', mode: '2' });
  await form.evaluate(element => { const form = element as PxFormElement; form.schema = form.schema.map(field => ({ ...field })); });
  await expect(size).toHaveAttribute('data-identity', 'original');
  expect(await form.evaluate(element => {
    const form = element as PxFormElement, parent = form.parentElement!, input = form.querySelector<HTMLInputElement>('input[name=size]')!;
    form.remove(); input.value = '33'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const detached = form.values.size;
    parent.append(form); input.value = '15'; input.dispatchEvent(new Event('input', { bubbles: true }));
    return { detached, reconnected: form.values.size };
  })).toEqual({ detached: 12, reconnected: 15 });
  await expect(size).toHaveAttribute('data-identity', 'original');
  await page.getByTestId('native-probe-form').evaluate(element => element.remove());
});

test('shared composite elements keep native events, resize commits and reconnect cleanup', async ({ page }) => {
  // A detached consumer of the same registered kit, independent of editor state.
  await page.locator('#root').evaluate(root => { (root as HTMLElement).style.display = 'none'; });
  await page.evaluate(() => {
    const menu = document.createElement('px-menu') as PxMenuElement;
    menu.items = [{ label: 'Nested probe menu', items: [{ label: 'Pick probe entry', run: () => document.body.dataset.picked = 'yes' }] }];
    menu.x = 50; menu.y = 50;
    menu.addEventListener('px-dismiss', () => menu.remove()); document.body.append(menu);
  });
  await page.getByText('Nested probe menu', { exact: true }).hover();
  await page.getByText('Pick probe entry', { exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-picked', 'yes');
  await expect(page.locator('.px-menu-list')).toHaveCount(0);

  await page.evaluate(() => {
    const dialog = document.createElement('px-dialog') as PxDialogElement;
    dialog.open = true; dialog.setAttribute('heading', 'Probe dialog');
    dialog.innerHTML = '<input aria-label="Probe name"><button type="submit">Save probe</button>';
    dialog.addEventListener('px-submit', event => { document.body.dataset.saved = 'yes'; event.preventDefault(); });
    document.body.append(dialog);
  });
  await page.getByRole('textbox', { name: 'Probe name' }).fill('Draft');
  await page.getByRole('button', { name: 'Save probe' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-saved', 'yes');
  await expect(page.getByRole('dialog', { name: 'Probe dialog' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Probe dialog' })).toBeHidden();
  await page.locator('px-dialog').evaluate(element => element.remove());

  await page.evaluate(() => {
    const area = document.createElement('div'); area.dataset.testid = 'composite-probe';
    area.innerHTML = '<div style="position:relative;width:200px;height:100px"><px-slider id="probe-slider" freeze-y></px-slider></div>'
      + '<div style="display:flex;width:500px;height:100px"><div style="width:200px;flex-shrink:0"></div><px-splitter value="200" min="100" max="300" growth="1" vertical></px-splitter><div></div></div>'
      + '<px-color-input value="#abcdef"></px-color-input>';
    document.body.append(area);
  });
  const slider = page.locator('#probe-slider'), sliderBox = (await slider.boundingBox())!;
  await page.mouse.click(sliderBox.x + 150, sliderBox.y + 50);
  expect(await slider.evaluate(element => (element as PxSliderElement).x)).toBe(.75);
  expect(await slider.evaluate(element => (element as PxSliderElement).drag)).toBe(false);
  await slider.hover(); await page.mouse.wheel(0, -100);
  await expect.poll(() => slider.evaluate(element => (element as PxSliderElement).x)).toBe(.76);
  await page.mouse.move(sliderBox.x + 150, sliderBox.y + 50); await page.mouse.down();
  await page.mouse.move(sliderBox.x + 160, sliderBox.y + 50);
  await slider.evaluate(element => { const parent = element.parentElement!; element.remove(); parent.append(element); });
  expect(await slider.evaluate(element => (element as PxSliderElement).drag)).toBe(false);
  const stopped = await slider.evaluate(element => (element as PxSliderElement).x);
  await page.mouse.move(sliderBox.x + 180, sliderBox.y + 50); await page.mouse.up();
  expect(await slider.evaluate(element => (element as PxSliderElement).x)).toBe(stopped);

  const splitter = page.locator('px-splitter'), splitBox = (await splitter.boundingBox())!;
  await page.mouse.move(splitBox.x + 2, splitBox.y + 20); await page.mouse.down();
  await page.mouse.move(splitBox.x + 52, splitBox.y + 20);
  expect(await splitter.evaluate(element => (element.previousElementSibling as HTMLElement).style.width)).toBe('250px');
  expect(await splitter.evaluate(element => (element as PxSplitterElement).value)).toBe(200);
  await page.mouse.up();
  expect(await splitter.evaluate(element => (element as PxSplitterElement).value)).toBe(250);

  const color = page.locator('px-color-input');
  await color.getByRole('button').click();
  await page.getByRole('textbox', { name: 'Hex color' }).fill('#123456');
  expect(await color.evaluate(element => (element as PxColorInputElement).value)).toBe('#123456');
  await page.keyboard.press('Escape'); await expect(page.locator('.px-color-popup')).toHaveCount(0);
  await color.evaluate(element => { const parent = element.parentElement!; element.remove(); parent.append(element); });
  await expect(color.getByRole('button')).toHaveCount(1);
  await color.getByRole('button').click(); await expect(page.locator('.px-color-popup')).toHaveCount(1);
  await color.evaluate(element => element.remove()); await expect(page.locator('.px-color-popup')).toHaveCount(0);
  await page.getByTestId('composite-probe').evaluate(element => element.remove());
});
