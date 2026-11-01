import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { minify, transformWithOxc } from 'vite';

const uiRoot = fileURLToPath(new URL('../packages/ui/src/', import.meta.url)).replaceAll('\\', '/');
const reactRoot = fileURLToPath(new URL('../packages/ui-react/src/', import.meta.url)).replaceAll('\\', '/');
const isUi = path => path.startsWith(uiRoot) || path.startsWith(reactRoot);

/** Sandbox modules need code, not a second copy of TypeScript types and comments. */
export function uiSources() {
  let building = false;
  return {
    name: 'pixprite-ui-sources',
    enforce: 'pre',
    configResolved(config) { building = config.command === 'build'; },
    handleHotUpdate({ file, server }) {
      if (!isUi(file.replaceAll('\\', '/'))) return;
      // A registry cannot replace an existing custom-element constructor.
      server.ws.send({ type: 'full-reload' });
      return [];
    },
    async load(id) {
      const [path, query] = id.split('?');
      if (!building || !isUi(path) || !/\.tsx?$/.test(path) || !new URLSearchParams(query).has('raw')) return;
      const source = await readFile(path, 'utf8');
      const transformed = await transformWithOxc(source, path, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts', jsx: { runtime: 'automatic', development: false }, target: 'esnext', sourcemap: false });
      const { code, errors } = await minify(path, transformed.code, { module: true, sourcemap: false, codegen: { legalComments: 'none' } });
      if (errors.length) throw new Error(`Cannot minify UI module ${path}: ${JSON.stringify(errors)}`);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
