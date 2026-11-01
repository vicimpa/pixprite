import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import * as react from 'react';
import * as client from 'react-dom/client';
import * as dom from 'react-dom';
import * as jsx from 'react/jsx-runtime';

const id = 'virtual:pixprite-react-sources';
const entry = fileURLToPath(new URL('./sandbox-react-entry.js', import.meta.url));

/** Same installed React version, bundled for a separate sandbox realm without network imports. */
export function reactSources() {
  let sources;
  return {
    name: 'pixprite-react-sources',
    resolveId(specifier) { if (specifier === id) return '\0' + id; },
    async load(specifier) {
      if (specifier !== '\0' + id) return;
      sources ??= (async () => {
        const result = await build({
          configFile: false, publicDir: false, logLevel: 'silent',
          define: { 'process.env.NODE_ENV': JSON.stringify('production') },
          build: { write: false, minify: 'oxc', target: 'esnext',
            lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } },
        });
        const output = (Array.isArray(result) ? result[0] : result).output;
        const chunk = output.find(item => item.type === 'chunk' && item.isEntry);
        if (!chunk || chunk.imports.length || chunk.dynamicImports.length) throw new Error('Sandbox React must be self-contained');
        const modules = { 'vendor-runtime.js': chunk.code };
        for (const [name, exports] of Object.entries({ react, client, dom, jsx })) {
          const names = Object.keys(exports).filter(key => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key));
          modules[`vendor-${name}.js`] = `import { ${name} as runtime } from './vendor-runtime.js';const {${names.join(',')}}=runtime;export {${names.join(',')}};export default runtime;`;
        }
        return modules;
      })();
      return `export default ${JSON.stringify(await sources)};`;
    },
  };
}
