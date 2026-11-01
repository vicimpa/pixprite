import { expect, test } from '@playwright/test';
import type { PxInput, PxSelect, PxVirtualList } from '../packages/ui/src/elements';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc' }));
  });
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'ui-fixture';
    fixture.style.cssText = 'position:fixed;inset:16px auto auto 16px;width:420px;max-height:calc(100vh - 32px);overflow:auto;z-index:2001;padding:12px;background:var(--bg)';
    document.body.append(fixture);
  });
});

test('standalone fields retain native labels and expose host accessibility attributes', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<label for="ui-host">Host label</label><px-input id="ui-host" aria-describedby="ui-help"><input type="number" min="1" max="20" name="count" value="5"></px-input><span id="ui-help">A quantity</span>'
      + '<px-label for="ui-native">Native label</px-label><px-input><input id="ui-native"></px-input>'
      + '<px-input aria-label="Explicit name" title="Field title"></px-input>';
  });
  const fixture = page.locator('#ui-fixture');
  await fixture.getByText('Host label', { exact: true }).click();
  await expect(fixture.getByRole('spinbutton', { name: 'Host label', exact: true })).toBeFocused();
  await expect(fixture.getByRole('spinbutton')).toHaveAttribute('aria-describedby', 'ui-help');
  await fixture.getByText('Native label', { exact: true }).click();
  await expect(fixture.getByRole('textbox', { name: 'Native label', exact: true })).toBeFocused();
  await expect(fixture.getByRole('textbox', { name: 'Explicit name', exact: true })).toHaveAttribute('title', 'Field title');
  await fixture.locator('px-label').evaluate(label => label.removeAttribute('for'));
  await expect(fixture.locator('px-label > label')).not.toHaveAttribute('for');
});

test('standalone select retains selection across reconnect, resets and submits its native value', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<form><label for="ui-choice">Choice</label><px-select id="ui-choice" name="mode" value="b"><option value="a">Alpha</option><option value="b">Beta</option></px-select><button type="reset">Reset fixture</button></form>';
    const control = fixture.querySelector('px-select') as PxSelect;
    queueMicrotask(() => {
      for (const type of ['input', 'change']) control.control!.addEventListener(type, () => { control.dataset[type] = String(Number(control.dataset[type] ?? 0) + 1); });
    });
  });
  const fixture = page.locator('#ui-fixture'), host = fixture.locator('px-select');
  await expect(fixture.getByRole('button', { name: 'Choice', exact: true })).toHaveText('Beta');
  await fixture.getByText('Choice', { exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Alpha', exact: true }).click();
  await expect(host).toHaveAttribute('data-input', '1');
  await expect(host).toHaveAttribute('data-change', '1');
  await host.evaluate(element => {
    const form = element.parentElement!;
    element.remove(); form.append(element);
  });
  await expect(fixture.getByRole('button', { name: 'Choice', exact: true })).toHaveText('Alpha');
  await fixture.getByRole('button', { name: 'Reset fixture', exact: true }).click();
  await expect(fixture.getByRole('button', { name: 'Choice', exact: true })).toHaveText('Beta');
  await host.evaluate(element => { const control = element as PxSelect; control.disabled = true; });
  await expect(fixture.getByRole('button', { name: 'Choice', exact: true })).toBeDisabled();
  await host.evaluate(element => {
    const control = element as PxSelect;
    control.disabled = false; control.name = 'renamed'; control.value = 'a';
  });
  await expect(fixture.getByRole('button', { name: 'Choice', exact: true })).toBeEnabled();
  expect(await fixture.locator('form').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toEqual({ renamed: 'a' });
});

test('number drafts survive prop sync and commit one clamped value on blur', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<px-input value="5"><input type="number" min="1" max="10"></px-input><button type="button">Leave field</button>';
    const host = fixture.querySelector('px-input') as PxInput;
    queueMicrotask(() => {
      for (const type of ['input', 'change']) host.control!.addEventListener(type, () => { host.dataset[type] = String(Number(host.dataset[type] ?? 0) + 1); });
    });
  });
  const fixture = page.locator('#ui-fixture'), field = fixture.getByRole('spinbutton'), host = fixture.locator('px-input');
  await field.fill('');
  await host.evaluate(element => { (element as PxInput).value = 5; });
  await expect(field).toHaveValue('');
  await expect(host).not.toHaveAttribute('data-input');
  await fixture.getByRole('button', { name: 'Leave field', exact: true }).click();
  await expect(field).toHaveValue('1');
  await expect(host).toHaveAttribute('data-input', '1');
  await expect(host).toHaveAttribute('data-change', '1');
  await field.fill('30');
  await fixture.getByRole('button', { name: 'Leave field', exact: true }).click();
  await expect(field).toHaveValue('10');
  await expect(host).toHaveAttribute('data-input', '2');
  await expect(host).toHaveAttribute('data-change', '2');
});

test('number inputs select text normally and only scrub with Alt, respecting fractional steps', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<px-input><input type="number" step="0.05" value="123456" style="width:180px"></px-input>';
  });
  const field = page.locator('#ui-fixture input');
  const rect = (await field.boundingBox())!;
  await page.mouse.move(rect.x + 6, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + 70, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(field).toBeFocused(); await expect(field).toHaveValue('123456');
  await field.dblclick({ position: { x: 15, y: rect.height / 2 } });
  await page.keyboard.type('5'); await expect(field).toHaveValue('5');
  await field.press('Shift+ArrowLeft'); await page.keyboard.type('7');
  await expect(field).toHaveValue('7');
  await field.fill('0.5');
  await page.keyboard.down('Alt');
  await page.mouse.move(rect.x + 15, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + 45, rect.y + rect.height / 2, { steps: 10 }); await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(field).toHaveValue('1');
  await field.hover(); await page.mouse.wheel(0, -100); await expect(field).toHaveValue('1.05');
});

test('virtual list reconciles changed keys and leaves text editing keys to the input', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    const list = document.createElement('px-virtual-list') as PxVirtualList;
    list.style.cssText = 'height:160px;width:300px';
    let keys = ['alpha', 'beta', 'gamma'];
    list.renderItem = index => {
      const button = document.createElement('button'); button.textContent = keys[index];
      return button;
    };
    fixture.append(list); list.configure({ keys, estimate: 28 });
    fixture.addEventListener('swap', () => { keys = ['gamma', 'beta', 'alpha']; list.configure({ keys, estimate: 28 }); });
  });
  const fixture = page.locator('#ui-fixture');
  await expect(fixture.locator('[data-virtual-index="0"]')).toHaveText('alpha');
  await fixture.dispatchEvent('swap');
  await expect(fixture.locator('[data-virtual-index="0"]')).toHaveText('gamma');
  await expect(fixture.locator('[data-virtual-index="2"]')).toHaveText('alpha');
  await expect(fixture.locator('[data-virtual-index]')).toHaveText(['gamma', 'beta', 'alpha']);
  await fixture.locator('[data-virtual-index="0"]').evaluate(row => {
    const input = document.createElement('input'); input.value = 'draft'; input.setAttribute('aria-label', 'Row draft'); row.append(input);
  });
  const field = fixture.getByRole('textbox', { name: 'Row draft' });
  await field.focus(); await field.press('End');
  await expect(field).toBeFocused();
  expect(await field.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(5);
});

test('readonly and disabled fieldsets keep native control semantics', async ({ page }) => {
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<fieldset><px-input readonly value="5" aria-label="Readonly count"><input type="number" min="1" max="20"></px-input>'
      + '<px-select aria-label="Fieldset choice" value="a"><option value="a">Alpha</option><option value="b">Beta</option></px-select></fieldset>';
  });
  const fixture = page.locator('#ui-fixture'), field = fixture.getByRole('spinbutton', { name: 'Readonly count' });
  await field.dispatchEvent('wheel', { deltaY: -100 });
  await expect(field).toHaveValue('5');
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  await expect(field).toHaveValue('5');
  await fixture.locator('fieldset').evaluate(fieldset => { (fieldset as HTMLFieldSetElement).disabled = true; });
  await expect(field).toBeDisabled();
  await field.dispatchEvent('wheel', { deltaY: -100 });
  await expect(field).toHaveValue('5');
  await fixture.locator('px-select').evaluate(element => (element as PxSelect).show());
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await fixture.locator('fieldset').evaluate(fieldset => { (fieldset as HTMLFieldSetElement).disabled = false; });
  const choice = fixture.getByRole('button', { name: 'Fieldset choice' });
  await expect(choice).toBeEnabled();
  await choice.click();
  await page.getByRole('listbox').getByRole('option', { name: 'Beta', exact: true }).click();
  await expect(choice).toHaveText('Beta');
});

test('required select blocks invalid submission and focuses its visible trigger', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('#ui-fixture').evaluate(fixture => {
    fixture.innerHTML = '<form><label for="required-choice">Required choice</label><px-select id="required-choice" name="mode" required><option value="">Choose one</option><option value="a">Alpha</option></px-select><button type="submit">Submit fixture</button></form>';
    fixture.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); fixture.dataset.submitted = 'true'; });
  });
  const fixture = page.locator('#ui-fixture'), trigger = fixture.getByRole('button', { name: 'Required choice' });
  await fixture.getByRole('button', { name: 'Submit fixture', exact: true }).click();
  await expect(fixture).not.toHaveAttribute('data-submitted');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-required', 'true');
  await expect(trigger).toHaveAttribute('aria-invalid', 'true');
  expect(errors.filter(error => /not focusable|invalid form control/i.test(error))).toEqual([]);
  await trigger.click();
  await page.getByRole('listbox').getByRole('option', { name: 'Alpha', exact: true }).click();
  await expect(trigger).not.toHaveAttribute('aria-invalid');
  await fixture.getByRole('button', { name: 'Submit fixture', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-submitted', 'true');
  expect(await fixture.locator('form').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toEqual({ mode: 'a' });
});
