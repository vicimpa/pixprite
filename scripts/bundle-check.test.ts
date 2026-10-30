import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(budgets: { initialJsGzip: number; totalJsGzip: number }) {
  const root = await mkdtemp(join(tmpdir(), 'pixprite-bundle-'));
  roots.push(root);
  await mkdir(join(root, '.vite'));
  await writeFile(join(root, '.vite/manifest.json'), JSON.stringify({
    'index.html': { file: 'entry.js', isEntry: true, imports: ['shared'] },
    shared: { file: 'shared.js' },
  }));
  await writeFile(join(root, 'entry.js'), 'import "./shared.js";');
  await writeFile(join(root, 'shared.js'), 'console.log("shared");');
  await writeFile(join(root, 'worker.js'), 'console.log("worker");');
  await writeFile(join(root, 'budget.json'), JSON.stringify(budgets));
  return root;
}

async function run(root: string) {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./bundle-check.ts', import.meta.url)), root, join(root, 'budget.json')], {
    stdout: 'pipe', stderr: 'pipe',
  });
  return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
}

test('bundle gate passes within budgets and fails on oversized static imports', async () => {
  const root = await fixture({ initialJsGzip: 1000, totalJsGzip: 2000 });
  expect((await run(root)).code).toBe(0);
  // Incompressible dependency growth must count towards the initial budget too.
  await writeFile(join(root, 'shared.js'), crypto.getRandomValues(new Uint8Array(4096)));
  const failed = await run(root);
  expect(failed.code).toBe(1);
  expect(failed.out).toContain('FAIL initialJsGzip');
});

test('bundle gate counts worker/lazy files even outside the initial manifest graph', async () => {
  const root = await fixture({ initialJsGzip: 1000, totalJsGzip: 2000 });
  await writeFile(join(root, 'worker.js'), crypto.getRandomValues(new Uint8Array(4096)));
  const failed = await run(root);
  expect(failed.code).toBe(1);
  expect(failed.out).toContain('PASS initialJsGzip');
  expect(failed.out).toContain('FAIL totalJsGzip');
});

test('bundle gate fails when the build manifest references a missing chunk', async () => {
  const root = await fixture({ initialJsGzip: 1000, totalJsGzip: 2000 });
  await rm(join(root, 'shared.js'));
  const failed = await run(root);
  expect(failed.code).toBe(1);
  expect(failed.err).toContain('Missing emitted JavaScript');
});
