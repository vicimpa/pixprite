import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { measureBundle } from './bundle-check';

type Chunk = { file: string; entry: boolean; imports: string[]; dynamicImports: string[]; modules: string[] };
type Graph = { chunks: Chunk[]; edges: { module: string; imports: string[]; dynamicImports: string[] }[] };
type Manifest = Record<string, { file: string; imports?: string[]; dynamicImports?: string[] }>;

export const demandModules = [
  'src/modules/Editor/EditorWorkspace.tsx', 'src/modules/Extensions/Extensions.tsx',
  'src/modules/Dialogs/NewSprite.tsx', 'src/modules/Dialogs/Common.tsx', 'src/modules/Dialogs/Filters.tsx',
  'src/modules/Dialogs/ColorMode.tsx', 'src/modules/Dialogs/Palette.tsx', 'src/modules/Dialogs/Slice.tsx',
  'src/modules/Dialogs/Tilemap.tsx', 'src/modules/Dialogs/Shortcuts.tsx', 'src/modules/Dialogs/Stroke.tsx',
  'src/core/compute.ts', 'src/core/ExportPreparation.ts', 'src/core/formats/Webm.ts',
  'src/core/formats/Aseprite.ts', 'src/core/formats/GifDecode.ts', 'src/core/formats/Palette.ts',
  'src/core/formats/Apng.ts', 'src/core/formats/Ico.ts', 'src/core/formats/Zip.ts', 'src/core/Gif.ts',
];

export async function inspectBundle(directory = 'dist') {
  const root = resolve(directory);
  const [main, worker, manifest] = await Promise.all([
    readFile(resolve(root, '.vite/main-graph.json'), 'utf8').then(s => JSON.parse(s) as Graph),
    readFile(resolve(root, '.vite/worker-graph.json'), 'utf8').then(s => JSON.parse(s) as Graph),
    readFile(resolve(root, '.vite/manifest.json'), 'utf8').then(s => JSON.parse(s) as Manifest),
  ]);
  const chunks = new Map([...main.chunks, ...worker.chunks].map(c => [c.file, c]));
  const closure = (files: string[]) => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      const chunk = chunks.get(file);
      if (!chunk) throw new Error(`Missing graph chunk: ${file}`);
      seen.add(file);
      chunk.imports.filter(f => f.endsWith('.js')).forEach(visit);
    };
    files.forEach(visit);
    return [...seen].sort();
  };
  const fileFor = (module: string, graph = main) => {
    const chunk = graph.chunks.find(c => c.modules.includes(module));
    if (!chunk) throw new Error(`Missing emitted module: ${module}`);
    return chunk.file;
  };
  const initial = closure(main.chunks.filter(c => c.entry).map(c => c.file));
  const home = closure([...initial, fileFor('src/modules/Home/Home.tsx'), fileFor('src/core/extensions/UiHost.ts'), fileFor('src/core/extensions/index.ts')]);
  const editor = closure([fileFor('src/modules/Editor/EditorWorkspace.tsx')]);
  const workerInitial = closure(worker.chunks.filter(c => c.entry).map(c => c.file));
  const modules = (files: string[]) => new Set(files.flatMap(f => chunks.get(f)!.modules));
  const exclude = (name: string, files: string[], forbidden: string[]) => {
    const present = modules(files);
    for (const module of forbidden) if (present.has(module)) throw new Error(`${name} eagerly contains ${module}`);
  };
  exclude('initial', initial, [...demandModules, 'src/modules/Home/Home.tsx']);
  exclude('Home bootstrap', home, demandModules);
  exclude('Editor UI', editor, demandModules.filter(m => m !== 'src/modules/Editor/EditorWorkspace.tsx'));
  exclude('worker bootstrap', workerInitial, demandModules.filter(m => m !== 'src/core/compute.ts'));
  for (const required of ['src/core/State.ts', 'src/core/Projects.ts', 'src/core/Sprite.ts', 'src/core/SpriteValidation.ts'])
    if (!modules(initial).has(required)) throw new Error(`Shared restore kernel is missing ${required}`);
  for (const module of demandModules) {
    fileFor(module);
    if (!manifest[module.replace(/^src\//, '')]) throw new Error(`Demand boundary missing from Vite manifest: ${module}`);
  }
  // Static and dynamic edges to the same module defeat a demand boundary. Separate worker
  // and browser graphs are independent entry graphs and are checked independently.
  for (const [name, graph] of [['main', main], ['worker', worker]] as const) {
    const staticImports = new Set(graph.edges.flatMap(e => e.imports));
    for (const target of new Set(graph.edges.flatMap(e => e.dynamicImports)))
      if (staticImports.has(target)) throw new Error(`${name}: mixed static/dynamic import of ${target}`);
  }
  for (const graph of [main, worker])
    for (const chunk of graph.chunks)
      for (const module of chunk.modules)
        if (module.startsWith('extensions/')) throw new Error(`Extension artifact leaked into editor: ${module}`);
  const gzip = async (files: string[]) => {
    const sizes = await Promise.all(files.map(async file => gzipSync(await readFile(resolve(root, file)), { level: 9 }).byteLength));
    return sizes.reduce((sum, size) => sum + size, 0);
  };
  const boundaries = Object.fromEntries(demandModules.map(module => [module.replace(/^src\//, ''), fileFor(module)]));
  return { ...await measureBundle(root), homeBootstrapJsGzip: await gzip(home), editorAdditionalJsGzip: await gzip(editor.filter(f => !home.includes(f))),
    initial, home, editor, workerInitial, boundaries };
}

if (import.meta.main) {
  try {
    const check = process.argv.includes('--check');
    const report = await inspectBundle(process.argv.slice(2).find(arg => arg !== '--check'));
    console.log(check ? 'PASS bundle graph: Home / editor / dialogs / formats / extensions / worker boundaries' : JSON.stringify(report, null, 2));
  }
  catch (error) { console.error(error); process.exitCode = 1; }
}
