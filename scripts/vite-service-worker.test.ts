import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeServiceWorker } from './vite-service-worker.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const digest = (bytes: string | Buffer) => 'sha256-' + createHash('sha256').update(bytes).digest('base64');

test('release snapshot covers final HTML, public assets, lazy chunks, worker chunks and fonts, with byte integrity', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pixprite-precache-'));
  temporary.push(directory);
  const files = {
    'index.html': '<script src="./assets/main.js"></script>',
    'favicon.svg': '<svg/>', 'manifest.webmanifest': '{}',
    'assets/main.js': 'import("./lazy.js")', 'assets/lazy.js': 'export const lazy = 1',
    'assets/worker.js': 'import("./worker-lazy.js")', 'assets/worker-lazy.js': 'export const worker = 1',
    'assets/font.woff2': 'font bytes',
  };
  await mkdir(resolve(directory, 'assets'));
  await mkdir(resolve(directory, '.vite'));
  await writeFile(resolve(directory, '.vite/main-graph.json'), 'build diagnostics');
  await writeFile(resolve(directory, 'precache-old.json'), 'stale manifest');
  for (const [name, source] of Object.entries(files)) await writeFile(resolve(directory, name), source);
  await writeServiceWorker(directory);
  const worker = await readFile(resolve(directory, 'sw.js'), 'utf8');
  const name = (await readdir(directory)).find(name => name.startsWith('precache-') && name !== 'precache-old.json')!;
  const manifest = await readFile(resolve(directory, name), 'utf8');
  expect(JSON.parse(manifest)).toEqual(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, source]) => [name, digest(source)]));
  expect(worker).toContain(digest(manifest));
  expect(worker).toContain(name.slice('precache-'.length, -'.json'.length));
  expect(worker).not.toContain('__RELEASE__');
  expect(worker).not.toContain('__MANIFEST_INTEGRITY__');
  await writeServiceWorker(directory);
  expect(await readFile(resolve(directory, 'sw.js'), 'utf8')).toBe(worker);
  // A change to a worker-only lazy file changes the release, not just the main Vite graph.
  await writeFile(resolve(directory, 'assets/worker-lazy.js'), 'export const worker = 2');
  await writeServiceWorker(directory);
  expect(await readFile(resolve(directory, 'sw.js'), 'utf8')).not.toBe(worker);
});
