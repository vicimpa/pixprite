/** Reproducible, trusted UI drags; timings describe this browser run, not physical refresh rate. */
import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const root = resolve(import.meta.dir, '..'), dist = resolve(root, 'dist/web');
const label = process.argv[2] || 'candidate';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Expected a simple report label');
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = resolve(dist, '.' + new URL(request.url).pathname.replace(/^\/$/, '/index.html'));
  return path.startsWith(dist + sep) && await Bun.file(path).exists() ? new Response(Bun.file(path)) : new Response('Not found', { status: 404 });
} });
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: !process.argv.includes('--headed') });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const summaries: any[] = [], errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', autosave: false, keyStyle: 'pc' }));
  const original = Storage.prototype.setItem;
  const writes: Record<string, number> = {};
  Storage.prototype.setItem = function(key, value) { writes[key] = (writes[key] || 0) + 1; original.call(this, key, value); };
  Object.assign(window, { interaction: { writes, intervals: [] as number[], tracking: false } });
});
async function start() {
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  await cdp?.send('Performance.enable');
  const before = await cdp?.send('Performance.getMetrics');
  await page.evaluate(() => {
    const state = (window as any).interaction; state.tracking = true; state.intervals = []; state.last = null;
    for (const key of Object.keys(state.writes)) delete state.writes[key];
    const tick = (now: number) => { if (!state.tracking) return; if (state.last !== null) state.intervals.push(now - state.last); state.last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  return { cdp, before };
}
async function finish(name: string, capture: Awaited<ReturnType<typeof start>>) {
  const after = await capture.cdp?.send('Performance.getMetrics');
  const value = await page.evaluate(() => { const state = (window as any).interaction; state.tracking = false; return { intervals: state.intervals, writes: { ...state.writes } }; });
  const sorted = [...value.intervals].sort((a: number,b: number)=>a-b);
  const metrics: Record<string, number> = {};
  for (const key of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']) {
    if (after && capture.before) metrics[key] = after.metrics.find(m => m.name === key)!.value - capture.before.metrics.find(m => m.name === key)!.value;
  }
  await page.waitForTimeout(350);
  const writesAfterSettle = await page.evaluate(() => ({ ...(window as any).interaction.writes }));
  summaries.push({ name, browser: engine, mode: process.argv.includes('--headed') ? 'headed' : 'headless',
    intervalMs: { p50: sorted[Math.ceil(sorted.length*.5)-1]??null, p95: sorted[Math.ceil(sorted.length*.95)-1]??null, raw: value.intervals }, storageWrites: value.writes, storageWritesAfterSettle: writesAfterSettle, metrics });
  await capture.cdp?.detach();
}
try {
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByTestId('sprite-canvas').waitFor();
  await page.waitForTimeout(700);
  const handle = page.locator('[data-splitter=columns]');
  // Support the pre-instrumentation layout for baseline runs.
  const target = await handle.count() ? handle.first() : page.getByTestId('sprite-canvas').locator('xpath=ancestor::div[3]/preceding-sibling::div').first();
  const box = await target.boundingBox();
  if (!box || box.width > 10) throw new Error('Could not identify the real column splitter');
  let sample = await start();
  await page.mouse.move(box.x + box.width / 2, box.y + 60); await page.mouse.down();
  for (let i = 0; i < 96; i++) await page.mouse.move(box.x + 2 + Math.sin(i/12)*70, box.y + 60);
  await page.mouse.up(); await finish('splitter', sample);
  await page.keyboard.press('Control+k'); await page.getByPlaceholder('Type a command… (= calculates)').fill('edit.prefs'); await page.locator('[data-command="edit.prefs"]').click();
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
  const title = dialog.locator(':scope > div').first(); const titleBox = (await title.boundingBox())!;
  sample = await start(); await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2); await page.mouse.down();
  for (let i = 0; i < 96; i++) await page.mouse.move(titleBox.x + titleBox.width / 2 + Math.sin(i/12)*60, titleBox.y + titleBox.height / 2 + Math.cos(i/12)*30);
  await page.mouse.up(); await finish('dialog', sample);
  if (errors.length) throw new Error(errors.join('\n'));
  const directory = resolve(root, 'dist/reports/benchmarks/interaction'); await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory, `${label}-${engine}.json`),JSON.stringify(summaries,null,2));
  for (const value of summaries) console.log(JSON.stringify({...value,intervalMs:{...value.intervalMs,raw:undefined}}));
} finally { await browser.close(); server.stop(true); }
