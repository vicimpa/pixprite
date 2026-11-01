import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import glsl from "vite-plugin-glsl";
import { fileURLToPath } from "url";
import { bundleGraph } from "./scripts/vite-bundle-graph.js";
import { serviceWorker } from "./scripts/vite-service-worker.js";
import { extensionsCatalog } from "./scripts/vite-extensions.js";
import { uiSources } from "./scripts/vite-ui-sources.js";
import { reactSources } from "./scripts/vite-react-sources.js";

// The extension API package (also in tsconfig paths; spelled out here so the dev server never misses it)
const api = fileURLToPath(new URL("./packages/api/src/index.ts", import.meta.url));
const ui = fileURLToPath(new URL("./packages/ui/src/", import.meta.url));

export default defineConfig({
  root: './src',
  base: './',
  publicDir: '../public',
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
    emptyOutDir: true,
    outDir: '../dist/web',
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      { find: /^@pixprite\/api$/, replacement: api },
      { find: /^@pixprite\/ui$/, replacement: `${ui}index.ts` },
      { find: /^@pixprite\/ui\/(.*)$/, replacement: `${ui}$1` },
    ],
  },
  server: {
    host: true,
    port: 3355,
  },
  // Workers (src/core/compute.worker.ts) resolve the same `~/core/…` paths
  worker: {
    format: 'es',
    rolldownOptions: { output: { codeSplitting: false } },
    plugins: () => [bundleGraph('worker')],
  },
  plugins: [
    uiSources(),
    reactSources(),
    react({
      plugins: [],
      tsDecorators: true,
    }),
    glsl({ minify: process.argv.includes('build') }),
    extensionsCatalog(),
    bundleGraph(),
    serviceWorker(),
  ],
});
