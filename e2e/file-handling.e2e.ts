import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

async function home(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] }));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Custom size…', exact: true })).toBeVisible();
}

async function editor(page: Page) {
  await home(page);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await page.getByRole('dialog', { name: 'New sprite', exact: true }).getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

async function images(page: Page) {
  const data = await page.evaluate(async () => {
    const out = [];
    for (const [name, w, h, color] of [
      ['Frame10.png', 2, 3, '#ff0000'], ['Frame2.png', 4, 1, '#00ff00'],
    ] as const) {
      const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      out.push({ name, data: btoa(String.fromCharCode(...bytes)) });
    }
    return out;
  });
  return data.map(({ name, data }) => ({ name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }));
}

async function command(page: Page, id: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toBeHidden();
}

test('picking several images on the home page creates separate projects', async ({ page }) => {
  await home(page);
  const files = await images(page);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open file…/ }).click();
  const chooser = await picker;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
  await expect(page.locator('[data-key^="p:"]')).toHaveCount(2);
  await expect(page.locator('[data-key^="p:"]', { hasText: 'Frame10' })).toHaveCount(1);
  await expect(page.locator('[data-key^="p:"]', { hasText: 'Frame2' })).toHaveCount(1);
});

test('multi-file picker opens each healthy image even when another image is corrupted', async ({ page }) => {
  await editor(page);
  const files = await images(page);
  const picker = page.waitForEvent('filechooser');
  await command(page, 'file.open');
  await (await picker).setFiles([files[0], { name: 'Broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }, files[1]]);
  await expect(page.locator('[draggable=true][data-active]')).toHaveCount(3);
  await expect(page.locator('[draggable=true][title="Frame10 · 2×3"]')).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Frame2 · 4×1');
  await expect(page.locator('[data-hit=frame]')).toHaveCount(1);
  await expect(page.getByText(/Could not open: Broken.png/)).toBeVisible();
});

test('dropping several images over document tabs opens each once', async ({ page }) => {
  await editor(page);
  const files = await images(page);
  await page.getByTestId('document-tabs').evaluate((target, files) => {
    const dataTransfer = new DataTransfer();
    for (const file of files) dataTransfer.items.add(new File([Uint8Array.from(atob(file.data), c => c.charCodeAt(0))], file.name, { type: 'image/png' }));
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  }, files.map(file => ({ name: file.name, data: file.buffer.toString('base64') })));
  await expect(page.locator('[draggable=true][data-active]')).toHaveCount(3);
  await expect(page.locator('[draggable=true][title="Frame10 · 2×3"]')).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Frame2 · 4×1');
});

test('explicit frame import still combines selected images into the current document', async ({ page }) => {
  await editor(page);
  const files = await images(page);
  const picker = page.waitForEvent('filechooser');
  await command(page, 'file.importFrames');
  await (await picker).setFiles(files);
  await expect(page.locator('[data-hit=frame]')).toHaveCount(3);
  await expect(page.locator('[draggable=true][data-active]')).toHaveCount(1);
});

test('installed file handlers cover editor formats with scoped launch actions', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  const extensions = manifest.file_handlers.flatMap((handler: { accept: Record<string, string[]> }) => Object.values(handler.accept).flat());
  expect(extensions).toEqual(expect.arrayContaining(['.pixprite', '.aseprite', '.ase', '.png', '.gif', '.webp', '.jpg', '.jpeg', '.gpl', '.pal', '.hex', '.act']));
  for (const handler of manifest.file_handlers) {
    expect(handler.action).toBe('./');
    expect(handler.launch_type).toBe('single-client');
  }
});

test('launch queue opens files as tabs after startup and survives inaccessible handles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(data => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', extensionCatalogs: ['/__e2e__/registry.json'] }));
    const file = (name: string) => new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], name);
    Object.defineProperty(window, 'launchQueue', { value: {
      setConsumer(consume: (params: { files: { getFile(): Promise<File> }[] }) => void) {
        (window as any).deliverFiles = () => consume({ files: [
          { getFile: async () => { throw new DOMException('Permission revoked', 'NotAllowedError'); } },
          { getFile: async () => file('Second.gif') },
        ] });
        consume({ files: [{ getFile: async () => file('Startup.gif') }] });
      },
    } });
  }, gif);
  await page.goto('/');
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Startup · 1×1');
  await page.evaluate(() => (window as any).deliverFiles());
  await expect(page.locator('[draggable=true][data-active=true]')).toHaveAttribute('title', 'Second · 1×1');
  await expect(page.locator('[draggable=true][data-active]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
