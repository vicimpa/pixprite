import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Module membership, in addition to Vite's public entry/import manifest, makes boundaries auditable. */
export function bundleGraph(kind = 'main') {
  const name = id => id.replaceAll('\\', '/').replaceAll(root.replaceAll('\\', '/'), '');
  return {
    name: `pixprite-bundle-graph-${kind}`,
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(output => output.type === 'chunk').map(chunk => ({
        file: chunk.fileName, entry: chunk.isEntry,
        imports: chunk.imports, dynamicImports: chunk.dynamicImports,
        modules: Object.keys(chunk.modules).map(name).sort(),
      })).sort((a, b) => a.file.localeCompare(b.file));
      const edges = [...this.getModuleIds()].map(id => {
        const info = this.getModuleInfo(id);
        return { module: name(id), imports: info.importedIds.map(name), dynamicImports: info.dynamicallyImportedIds.map(name) };
      }).sort((a, b) => a.module.localeCompare(b.module));
      this.emitFile({ type: 'asset', fileName: `.vite/${kind}-graph.json`, source: JSON.stringify({ chunks, edges }, null, 2) + '\n' });
    },
  };
}
