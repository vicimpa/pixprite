import { chromium, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve, sep } from 'node:path';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { fullScenarios, drawingScenario, autosaveScenario, type Scenario } from './scenarios';

const args = process.argv.slice(2);
const numberArg = (name: string, fallback: number, min: number) => {
  const at = args.indexOf(name), n = at < 0 ? fallback : Number(args[at + 1]);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
};
const smoke = args.includes('--smoke');
if (smoke && args.includes('--full')) throw new Error('Choose --smoke or --full');
const samples = numberArg('--samples', smoke ? 1 : 3, 1), warmups = numberArg('--warmups', 1, 0);
const steps = numberArg('--steps', smoke ? 40 : 200, 10);
const outputAt = args.indexOf('--output');
const output = outputAt >= 0 ? args[outputAt + 1] : `benchmark-results/${new Date().toISOString().replaceAll(':', '-')}.json`;
if (!output) throw new Error('--output requires a filename');
const scenarios = smoke ? [fullScenarios[0], fullScenarios.at(-1)!] : fullScenarios;
const root = resolve(import.meta.dir, '..');
const trackedSources = [...new Bun.Glob('src/**/*.{ts,tsx,css,scss}').scanSync({ cwd: root }),
  ...new Bun.Glob('benchmarks/*.{ts,html}').scanSync({ cwd: root }), 'vite.config.js', 'package.json', 'bun.lock'].filter(path => !path.endsWith('.test.ts')).sort();
const sourceHasher = new Bun.CryptoHasher('sha256');
for (const path of trackedSources) { sourceHasher.update(path); sourceHasher.update(await Bun.file(resolve(root, path)).arrayBuffer()); }
const sourceSha256 = sourceHasher.digest('hex');
await build({ configFile: resolve(import.meta.dir, 'vite.config.ts'), logLevel: 'warn' });
const dist = resolve(root, '.benchmark-dist');
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const target = resolve(dist, '.' + pathname);
  if (!target.startsWith(dist + sep)) return new Response('Forbidden', { status: 403 });
  const file = Bun.file(target);
  return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: !args.includes('--headed') });
const raw: any[] = [];
const errors: string[] = [];
let browserIdentity: unknown = null;
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, p50: sorted[Math.ceil(sorted.length * .50) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}
async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    localStorage.setItem('pixprite:prefs', JSON.stringify({ language: 'en', autosave: false }));
    // Include strict transaction commit in save timings; leave production code untouched.
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      return transaction.call(this, stores, mode, mode === 'readwrite' ? { ...options, durability: 'strict' } : options);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/benchmarks/index.html`);
  browserIdentity ??= await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null }));
  await page.waitForFunction(() => (window as any).benchmark);
  await page.getByRole('button', { name: 'Custom size…', exact: true }).waitFor();
  return { context, page, cdp: await context.newCDPSession(page) };
}
async function memory(cdp: Awaited<ReturnType<typeof open>>['cdp']) {
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    const value = await cdp.send('Runtime.getHeapUsage');
    return { value, unavailableReason: null };
  } catch (error) { return { value: null, unavailableReason: String(error) }; }
}
async function storage(cdp: Awaited<ReturnType<typeof open>>['cdp']) {
  try {
    const value = await cdp.send('Storage.getUsageAndQuota', { origin });
    const indexedDB = value.usageBreakdown.find(entry => entry.storageType === 'indexeddb');
    return { indexedDBBytes: indexedDB?.usage ?? null, originUsageBytes: value.usage,
      unavailableReason: indexedDB ? null : 'CDP omitted IndexedDB usage', breakdown: value.usageBreakdown };
  } catch (error) { return { indexedDBBytes: null, originUsageBytes: null, unavailableReason: String(error) }; }
}
async function draw(page: Page, steps: number) {
  const box = await page.getByTestId('sprite-canvas').boundingBox();
  if (!box) throw new Error('Drawing surface missing');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x - 80, y);
  await page.mouse.down();
  // Each trusted CDP event takes the real pencil event -> brush preview -> editor render path.
  for (let i = 0; i < steps; i++) await page.mouse.move(x - 80 + i * 160 / (steps - 1), y + Math.sin(i / 8) * 45);
  await page.mouse.up();
}

const version = browser.version();
let graphics: unknown = null;
try {
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send('SystemInfo.getInfo');
  graphics = info.gpu;
  await cdp.detach();
} catch (error) { graphics = { unavailableReason: String(error) }; }
try {
  for (const config of scenarios) {
    for (let i = -warmups; i < samples; i++) {
      const { context, page, cdp } = await open();
      try {
        const memoryBefore = await memory(cdp), storageBefore = await storage(cdp);
        const measurement = await page.evaluate(config => (window as any).benchmark.core(config), config);
        const memoryAfter = await memory(cdp), storageAfter = await storage(cdp);
        if (i >= 0) raw.push({ scenario: config.id, sample: i, ...measurement, memoryBefore, memoryAfter, storageBefore, storageAfter,
          indexedDBDeltaBytes: storageAfter.indexedDBBytes === null || storageBefore.indexedDBBytes === null ? null : storageAfter.indexedDBBytes - storageBefore.indexedDBBytes });
        console.log(`${i < 0 ? 'warmup' : `sample ${i + 1}`} ${config.id}: save ${measurement.saveMs.toFixed(1)} ms, open ${measurement.openMs.toFixed(1)} ms, PNG ${measurement.exportMs.toFixed(1)} ms`);
      } finally { await context.close(); }
    }
  }
  for (const config of [drawingScenario, autosaveScenario]) {
    for (let i = -warmups; i < samples; i++) {
      const { context, page, cdp } = await open();
      try {
        await page.evaluate(config => (window as any).benchmark.installEditor(config), config);
        const memoryBefore = await memory(cdp), storageBefore = await storage(cdp);
        const beforeChecksum = await page.getByTestId('sprite-canvas').screenshot();
        await page.evaluate(() => (window as any).benchmark.startTracking());
        if (config.id === autosaveScenario.id) {
          await page.evaluate(() => (window as any).benchmark.scheduleAutosave());
          await page.waitForFunction(() => (window as any).benchmark.activePreparations() > 0, null, { polling: 1 });
        }
        await draw(page, steps);
        const measurement = await page.evaluate(requireOverlap => (window as any).benchmark.finishTracking(requireOverlap), config.id === autosaveScenario.id);
        let autosave: unknown = null;
        if (config.id === autosaveScenario.id) autosave = await page.evaluate(() => (window as any).benchmark.finishAutosave());
        const afterChecksum = await page.getByTestId('sprite-canvas').screenshot();
        if (beforeChecksum.equals(afterChecksum)) throw new Error('Real editor did not visibly render the stroke');
        const memoryAfter = await memory(cdp), storageAfter = await storage(cdp);
        if (i >= 0) raw.push({ scenario: config.id, config, sample: i, ...measurement, memoryBefore, memoryAfter, storageBefore, storageAfter, autosave,
          inputLatencySummaryMs: summary(measurement.inputLatencyMs), autosaveInputLatencySummaryMs: summary(measurement.autosaveInputLatencyMs),
          pointerDownLatencySummaryMs: summary(measurement.pointerDownLatencyMs), autosavePointerDownLatencySummaryMs: summary(measurement.autosavePointerDownLatencyMs) });
        console.log(`${i < 0 ? 'warmup' : `sample ${i + 1}`} ${config.id}: ${measurement.fps.toFixed(1)} FPS, input p95 ${summary(measurement.inputLatencyMs).p95?.toFixed(2)} ms, Worker overlap ${measurement.autosaveInputLatencyMs.length} moves / ${measurement.autosavePointerDownLatencyMs.length} downs`);
      } finally { await context.close(); }
    }
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  const groups = [...new Set(raw.map(row => row.scenario))].map(scenario => {
    const rows = raw.filter(row => row.scenario === scenario);
    const metrics = ['saveMs', 'openMs', 'exportMs', 'fps', 'indexedDBDeltaBytes'];
    return { scenario, ...Object.fromEntries(metrics.filter(key => rows.some(row => typeof row[key] === 'number')).map(key => [key, summary(rows.map(row => row[key]))])),
      inputLatencyMs: summary(rows.flatMap(row => row.inputLatencyMs ?? [])), autosaveInputLatencyMs: summary(rows.flatMap(row => row.autosaveInputLatencyMs ?? [])),
      pointerDownLatencyMs: summary(rows.flatMap(row => row.pointerDownLatencyMs ?? [])), autosavePointerDownLatencyMs: summary(rows.flatMap(row => row.autosavePointerDownLatencyMs ?? [])),
      jsHeapUsedBytes: summary(rows.flatMap(row => row.memoryAfter.value ? [row.memoryAfter.value.usedSize] : [])),
      backingStorageBytes: summary(rows.flatMap(row => typeof row.memoryAfter.value?.backingStorageSize === 'number' ? [row.memoryAfter.value.backingStorageSize] : [])),
      indexedDBBytes: summary(rows.flatMap(row => row.storageAfter.indexedDBBytes === null ? [] : [row.storageAfter.indexedDBBytes])),
      undoUniqueBufferBytes: summary(rows.map(row => row.history.uniqueBufferBytes)), undoMetadataPayloadBytes: summary(rows.map(row => row.history.metadataPayloadBytes)) };
  });
  const artifact = { schemaVersion: 1, timestamp: new Date().toISOString(), status: raw.length === (scenarios.length + 2) * samples && !errors.length ? 'complete' : 'incomplete',
    environment: { bun: Bun.version, playwright: (await import('@playwright/test/package.json')).version,
      vite: (await import('vite/package.json')).version, browserIdentity,
      chromium: version, headless: !args.includes('--headed'), platform: platform(), osRelease: release(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, hostRamBytes: totalmem(), graphics, commit: (await Bun.$`git rev-parse HEAD`.cwd(root).quiet()).text().trim(),
      sourceSha256, sourceFileCount: trackedSources.length, gitStatus: (await Bun.$`git status --porcelain`.cwd(root).quiet()).text() },
    config: { mode: smoke ? 'smoke' : 'full', samples, warmups, steps, viewport: [1440, 1000], deviceScaleFactor: 1,
      strictIDBDurability: true, gcBeforeHeapSamples: true, freshBrowserContextPerIteration: true, scenarios: [...scenarios, drawingScenario, autosaveScenario] },
    units: { saveMs: 'ms', openMs: 'ms', exportMs: 'ms', inputLatencyMs: 'ms', autosaveInputLatencyMs: 'ms', pointerDownLatencyMs: 'ms', autosavePointerDownLatencyMs: 'ms', elapsedMs: 'ms', fps: 'frames/s', '*Bytes': 'bytes', workerTimes: 'ms since navigation' },
    methodology: { percentile: 'nearest rank', save: 'incremental capture + Worker prepare/validate/preview + real project storage; resolves after strict IDB transaction.complete',
      open: 'IDB manifest/resource hydration + Worker decode + Sprite.loadAsync hydration', export: 'capture + Worker render + PNG encoding, one frame, scale 1',
      fps: 'actual editor canvas draw loops / measured performance.now window; continuous pencil input including autosave wait when applicable',
      latency: 'trusted pointer event.timeStamp to microtask after next actual editor canvas draw loop, including event handling/brush/frame/render; excludes display scanout/OS device latency',
      pointerDownLatency: 'separate trusted pointerdown capture-phase timestamp to next editor draw; measured before the first pixel mutation can cancel preparation; existing latency arrays contain pointermoves only',
      memory: 'CDP Runtime.getHeapUsage after GC, browser JS heap only; excludes worker heaps, GPU/native allocations, object overhead of undo estimate and process RSS',
      history: 'unique retained ArrayBuffers excluding buffers shared with live document; metadataPayloadBytes is a specified payload estimate, excludes engine headers/allocator/WeakMap overhead',
      storage: 'CDP Storage.getUsageAndQuota actual browser origin IndexedDB usage, includes database overhead; delta from fresh context, excludes browser executable/cache/GPU',
      correctness: 'full resource checksums, metadata, tile refs and cel aliases; first/middle/last composites; decoded first-frame PNG; latest autosaved stroke pixels' },
    summary: groups, samples: raw, errors };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Artifact: ${output} (${artifact.status})`);
  await browser.close(); server.stop(true);
}
