import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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
