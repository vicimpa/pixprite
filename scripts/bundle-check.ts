import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

type Chunk = { file: string; isEntry?: boolean; imports?: string[] };
type Budgets = { initialJsGzip: number; totalJsGzip: number };

/** Each emitted file is counted once; initial JS includes the static import graph. */
export async function measureBundle(directory: string) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(resolve(root, '.vite/manifest.json'), 'utf8')) as Record<string, Chunk>;
  const initial = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk || typeof chunk.file !== 'string') throw new Error(`Missing manifest chunk: ${key}`);
    if (chunk.file.endsWith('.js')) initial.add(chunk.file);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  const entries = Object.keys(manifest).filter(key => manifest[key].isEntry);
  if (!entries.length) throw new Error('Build manifest has no entry points');
  entries.forEach(visit);

  const all = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile() && item.name.endsWith('.js')) all.add(relative(root, path).split(sep).join('/'));
    }
  };
  await walk(root);
  if (!initial.size || !all.size) throw new Error('Build contains no JavaScript');
  const compressed = new Map<string, number>();
  for (const file of all) compressed.set(file, gzipSync(await readFile(resolve(root, file)), { level: 9 }).byteLength);
  const sum = (files: Set<string>) => [...files].reduce((total, file) => {
    const size = compressed.get(file);
    if (size === undefined) throw new Error(`Missing emitted JavaScript: ${file}`);
    return total + size;
  }, 0);
  return { initialJsGzip: sum(initial), totalJsGzip: sum(all) };
}

if (import.meta.main) {
  try {
    const sizes = await measureBundle(process.argv[2] ?? 'dist');
    const budgetFile = process.argv[3] ?? new URL('./bundle-budgets.json', import.meta.url);
    const budgets = JSON.parse(await readFile(budgetFile, 'utf8')) as Budgets;
    let exceeded = false;
    for (const key of ['initialJsGzip', 'totalJsGzip'] as const) {
      if (!Number.isSafeInteger(budgets[key]) || budgets[key] <= 0) throw new Error(`Invalid budget: ${key}`);
      const pass = sizes[key] <= budgets[key];
      console.log(`${pass ? 'PASS' : 'FAIL'} ${key}: ${sizes[key]} / ${budgets[key]} bytes`);
      exceeded ||= !pass;
    }
    if (exceeded) process.exitCode = 1;
  } catch (error) {
    console.error(`Bundle check failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
