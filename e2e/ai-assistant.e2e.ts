import { expect, test, type Page } from '@playwright/test';
async function command(page: Page, id: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Control+k'); const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toHaveValue(''); await field.fill(id); await page.locator(`[data-command="${id}"]`).click();
}

test('TSX assistant uses shared controls, queues prompts, executes a tool and restores chat history', async ({ page }) => {
  const errors: string[] = [], requests: { messages: { role: string; content: string }[] }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://localhost:11434/v1/chat/completions', async route => {
    const index = requests.push(route.request().postDataJSON());
    if (index === 1) await waiting;
    const message = index === 1 ? { role: 'assistant', content: '**Checking**', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_sprite', arguments: '{}' } }] }
      : { role: 'assistant', content: index === 2 ? '**First answer**' : '**Second answer**' };
    await route.fulfill({ json: { choices: [{ message }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.addInitScript(() => { if (window === top) localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', keyStyle: 'pc', autosave: false, extensionCatalogs: ['/__e2e__/ai/registry.json'] })); });
  await page.goto('/'); await page.getByRole('button', { name: '32×32', exact: true }).click();
  await command(page, 'extensions.openStore'); const store = page.getByRole('dialog');
  await store.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Install', exact: true }).click();
  await store.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect(store.getByText('Running', { exact: true })).toBeVisible(); await store.getByRole('button', { name: 'Close', exact: true }).click();
  const chat = page.frameLocator('iframe[title="AI assistant"]');
  await chat.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('textbox', { name: 'API endpoint (OpenAI-compatible)', exact: true }).fill('http://localhost:11434/v1');
  await settings.getByRole('textbox', { name: 'Model', exact: true }).fill('fixture');
  await settings.getByRole('button', { name: 'OK', exact: true }).click();
  const field = chat.getByRole('textbox', { name: 'Ask about the sprite or tell what to change…', exact: true });
  await expect(chat.locator('px-button')).not.toHaveCount(0);
  await field.fill('Describe this sprite'); await field.press('Enter');
  await expect(chat.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await field.fill('And now explain the layers'); await field.press('Enter');
  await expect(chat.locator('.queued')).toContainText('And now explain the layers');
  release();
  await expect(chat.locator('.assistant').getByText('Second answer', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  const tool = requests[1].messages.find(m => m.role === 'tool');
  expect(JSON.parse(tool!.content)).toMatchObject({ width: 32, height: 32 });
  await page.locator('iframe[title="AI assistant"]').locator('xpath=..').locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Extensions', exact: true }).click();
  await page.getByText('AI assistant', { exact: true }).click();
  await expect(chat.locator('.assistant').getByText('First answer', { exact: true })).toBeVisible();
  await expect(chat.locator('.assistant').getByText('Second answer', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(chat.locator('.chat-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
