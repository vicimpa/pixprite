import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { measureBundle } from './bundle-check';

type Chunk = { file: string; entry: boolean; imports: string[]; dynamicImports: string[]; modules: string[] };
type Graph = { chunks: Chunk[] };

/** One complete browser bundle and one self-contained bundle per computation worker. */
export async function inspectBundle(directory = 'dist/web') {
  const root = resolve(directory);
  const [main, worker] = await Promise.all(['main', 'worker'].map(async kind =>
    JSON.parse(await readFile(resolve(root, `.vite/${kind}-graph.json`), 'utf8')) as Graph));
  if (main.chunks.length !== 1 || !main.chunks[0].entry) throw new Error('The browser must have exactly one JavaScript bundle');
  if (!worker.chunks.length || worker.chunks.some(chunk => !chunk.entry)) throw new Error('Workers must be self-contained entry bundles');
  for (const graph of [main, worker]) for (const chunk of graph.chunks) {
    if (chunk.imports.some(file => file.endsWith('.js')) || chunk.dynamicImports.length)
      throw new Error(`Unexpected split bundle: ${chunk.file}`);
    for (const module of chunk.modules)
      if (module.startsWith('extensions/')) throw new Error(`Extension artifact leaked into editor: ${module}`);
  }
  const expected = new Set(['sw.js', ...main.chunks.map(chunk => chunk.file), ...worker.chunks.map(chunk => chunk.file)]);
  for (const file of await readdir(root, { recursive: true })) {
    const name = file.replaceAll('\\', '/');
    if (name.endsWith('.js') && !expected.has(name)) throw new Error(`Unexpected separate script: ${name}`);
  }
  const modules = new Set(main.chunks[0].modules);
  for (const required of ['src/core/State.ts', 'src/core/Projects.ts', 'src/core/Sprite.ts',
    'src/core/IconPacks.ts', 'src/ui/Icon/outline.json',
    'src/modules/Home/Home.tsx', 'src/modules/Editor/EditorWorkspace.tsx', 'src/modules/Dialogs/Common.tsx',
    'src/modules/Extensions/Extensions.tsx', 'src/core/formats/Webm.ts', 'src/core/formats/GifDecode.ts'])
    if (!modules.has(required)) throw new Error(`Browser bundle is missing ${required}`);
  return { ...await measureBundle(root), initial: main.chunks.map(chunk => chunk.file), workerInitial: worker.chunks.map(chunk => chunk.file) };
}

if (import.meta.main) {
  try {
    const check = process.argv.includes('--check');
    const report = await inspectBundle(process.argv.slice(2).find(arg => arg !== '--check'));
    console.log(check ? 'PASS bundle graph: one browser bundle / self-contained workers / separate extensions' : JSON.stringify(report, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
