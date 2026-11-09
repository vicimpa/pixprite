import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function command(page: Page, id: string) {
  await expect(page.getByTestId('text-entry')).toBeHidden();
  await page.keyboard.press('Control+k');
  const field = page.getByPlaceholder('Type a command… (= calculates)');
  await expect(field).toBeFocused(); await expect(field).toHaveValue(''); await field.fill(id);
  await expect(page.locator(`[data-command="${id}"][data-active=true]`)).toBeVisible();
  await field.press('Enter'); await expect(field).toBeHidden();
}

export async function createDrawing(page: Page, width = 32, height = 32) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New sprite', exact: true });
  await dialog.getByRole('spinbutton').nth(0).fill(String(width));
  await dialog.getByRole('spinbutton').nth(1).fill(String(height));
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('sprite-canvas')).toBeVisible();
}

export async function pixelPosition(page: Page, x: number, y: number, width = 32, height = 32) {
  const box = (await page.getByTestId('sprite-canvas').boundingBox())!;
  const zoom = Number(await page.getByRole('textbox', { name: 'Zoom, %', exact: true }).inputValue()) / 100;
  return { x: box.x + Math.round(box.width / 2 - width * zoom / 2) + (x + .5) * zoom,
    y: box.y + Math.round(box.height / 2 - height * zoom / 2) + (y + .5) * zoom };
}

export async function pointer(page: Page, kind: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, pressure: number, pointerType = 'pen') {
  const at = await pixelPosition(page, x, y);
  await page.getByTestId('sprite-canvas').dispatchEvent(kind, {
    pointerType, pointerId: 7, isPrimary: true, button: 0, buttons: kind === 'pointerup' ? 0 : 1,
    pressure, clientX: at.x, clientY: at.y,
  });
}

export async function viewPixel(page: Page, x: number, y: number) {
  const at = await pixelPosition(page, x, y);
  return page.getByTestId('sprite-canvas').locator('canvas').evaluate(async (canvas: HTMLCanvasElement, at) => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const box = canvas.getBoundingClientRect();
    return [...canvas.getContext('2d')!.getImageData(Math.floor((at.x - box.x) * canvas.width / box.width),
      Math.floor((at.y - box.y) * canvas.height / box.height), 1, 1).data];
  }, at);
}

export async function exportPixels(page: Page) {
  const pending = page.waitForEvent('download'); await command(page, 'file.exportPng');
  const path = (await (await pending).path())!;
  const encoded = (await readFile(path)).toString('base64');
  return page.evaluate(async encoded => {
    const raw = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    return { width: canvas.width, height: canvas.height, pixels: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
  }, encoded);
}
