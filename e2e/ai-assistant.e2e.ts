import { expect, test, type Page } from '@playwright/test';
async function command(page: Page, id: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Control+k'); const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toHaveValue(''); await field.fill(id); await page.locator(`[data-command="${id}"]`).click();
}

async function openAssistant(page: Page) {
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
  return { chat, field };
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
  const { chat, field } = await openAssistant(page);
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

test('assistant loads only the requested skill, uses it to edit and reads back actual pixels', async ({ page }) => {
  const requests: any[] = [];
  const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  await page.route('http://localhost:11434/v1/chat/completions', async route => {
    const request = route.request().postDataJSON(), round = requests.push(request);
    const calls = round === 1 ? [call('skill', 'read_skill', { name: 'draw-pixel-art' })]
      : round === 2 ? [call('sprite', 'get_sprite', {})]
      : round === 3 ? [call('selection', 'get_selection', {}), call('before', 'get_pixels', { layer: 0, frame: 0, x: 3, y: 4, w: 2, h: 1 })]
      : round === 4 ? [call('write', 'fill_rect', { layer: 0, frame: 0, x: 3, y: 4, w: 2, h: 1, color: '#ff0088' }), call('after', 'get_pixels', { layer: 0, frame: 0, x: 3, y: 4, w: 2, h: 1 })] : undefined;
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: calls ? null : 'Painted and verified.', tool_calls: calls } }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const { chat, field } = await openAssistant(page);
  await field.fill('Draw two pink pixels at x=3, y=4 on this frame'); await field.press('Enter');
  await expect(chat.locator('.assistant')).toContainText('Painted and verified.');
  expect(requests).toHaveLength(5);
  const skillSchema = requests[0].tools.find((tool: any) => tool.function.name === 'read_skill');
  expect(skillSchema.function.parameters.properties.name.enum).toContain('animate-sprite');
  expect(requests[0].messages[0].content).toContain('draw-pixel-art');
  const loaded = JSON.parse(requests[1].messages.find((message: any) => message.tool_call_id === 'skill').content);
  expect(loaded).toMatchObject({ name: 'draw-pixel-art' });
  expect(loaded.tools).toContain('put_pixels');
  expect(requests[0].messages[0].content).not.toContain(loaded.instructions);
  const readback = JSON.parse(requests[4].messages.find((message: any) => message.tool_call_id === 'after').content);
  expect(readback).toEqual({ rect: { x: 3, y: 4, w: 2, h: 1 }, rows: [['#ff0088', '#ff0088']] });
});

test('switching documents during a model request prevents writes to the newly selected sprite', async ({ page }) => {
  const requests: any[] = [];
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://localhost:11434/v1/chat/completions', async route => {
    const round = requests.push(route.request().postDataJSON());
    if (round === 1) await waiting;
    const fn = round === 1 ? { name: 'fill_rect', arguments: JSON.stringify({ layer: 0, frame: 0, x: 0, y: 0, w: 1, h: 1, color: '#ff0000' }) }
      : { name: 'get_pixels', arguments: JSON.stringify({ layer: 0, frame: 0, x: 0, y: 0, w: 1, h: 1 }) };
    const message = round < 3 ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-' + round, type: 'function', function: fn }] }
      : { role: 'assistant', content: 'Checked the selected document.' };
    await route.fulfill({ json: { choices: [{ message }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const { chat, field } = await openAssistant(page);
  await field.fill('Paint the first pixel red'); await field.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  await page.getByTitle('Home', { exact: true }).click();
  await page.getByRole('button', { name: '32×32', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  release();
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await field.fill('Inspect the selected document'); await field.press('Enter');
  await expect(chat.locator('.assistant')).toContainText('Checked the selected document.');
  expect(requests).toHaveLength(3);
  const result = JSON.parse(requests[2].messages.find((message: any) => message.tool_call_id === 'call-2').content);
  expect(result.rows).toEqual([['']]);
});
