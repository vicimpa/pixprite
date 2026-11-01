import { expect, test } from '@playwright/test';
import type { PxCanvas, PxGradient, PxIcon } from '../packages/ui/src/elements';
import { gradientPixels } from '../packages/ui/src/gradient-pixels';

for (const fallback of [false, true]) test(`shared gradient preserves color and alpha with ${fallback ? 'Canvas fallback' : 'available graphics driver'}`, async ({ page }) => {
  await page.addInitScript(fallback => {
    if (window !== window.top) return;
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en' }));
    if (fallback) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
        if (args[0] === 'webgl2') return null;
        return original.apply(this, args);
      } as typeof original;
    }
  }, fallback);
  await page.goto('/'); await expect(page.getByTestId('home-page')).toBeVisible();
  const corners = { a: [.1, .8, .9, .7], b: [.6, .6, .7, .9], c: [.3, .5, .8, .6], d: [.8, .7, .6, 1] };
  for (const hsl of [false, true]) {
    const actual = await page.evaluate(({ corners, hsl }) => {
      const element = document.createElement('px-gradient') as PxGradient;
      element.style.cssText = 'position:fixed;left:0;top:0;width:4px;height:4px;z-index:5000';
      element.hsl = hsl; element.gradient = corners;
      document.body.append(element); element.redraw();
      const pixels = [...element.canvas!.getContext('2d')!.getImageData(0, 0, 4, 4).data];
      element.remove(); return pixels;
    }, { corners, hsl });
    const expected = [...gradientPixels(4, 4, corners, hsl)];
    expect(actual).toHaveLength(expected.length);
    expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))).toBeLessThanOrEqual(2);
  }
});

test('canvas releases drawing work on disconnect and icons render shared artwork', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('home-page')).toBeVisible();
  await page.evaluate(() => {
    const canvas = document.createElement('px-canvas') as PxCanvas;
    canvas.id = 'canvas-probe'; canvas.style.cssText = 'position:fixed;left:0;top:0;width:30px;height:20px';
    let frames = 0, cleanups = 0;
    canvas.draw = (_canvas, ctx) => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1, 1); return () => { cleanups++; canvas.dataset.cleanups = String(cleanups); }; };
    canvas.loop = () => { frames++; canvas.dataset.frames = String(frames); };
    document.body.append(canvas);
    const icon = document.createElement('px-icon') as PxIcon;
    icon.id = 'icon-probe'; icon.pixels = '##\n#.'; icon.scale = 2;
    document.body.append(icon);
  });
  const canvas = page.locator('#canvas-probe');
  await expect.poll(() => canvas.evaluate(element => Number((element as HTMLElement).dataset.frames))).toBeGreaterThan(1);
  expect(await canvas.locator('canvas').evaluate(element => [(element as HTMLCanvasElement).width, (element as HTMLCanvasElement).height])).toEqual([30, 20]);
  expect(await page.locator('#icon-probe svg').evaluate(element => [element.getAttribute('viewBox'), (element as SVGSVGElement).style.width])).toEqual(['0 0 2 2', '4px']);
  const stopped = await canvas.evaluate(async element => {
    element.remove();
    const stopped = (element as HTMLElement).dataset.frames;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { stopped: stopped === (element as HTMLElement).dataset.frames, cleanups: Number((element as HTMLElement).dataset.cleanups) };
  });
  expect(stopped.stopped).toBe(true);
  expect(stopped.cleanups).toBeGreaterThan(0);
  await page.locator('#icon-probe').evaluate(element => element.remove());
});
