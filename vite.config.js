import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import paths from "vite-tsconfig-paths";
import glsl from "vite-plugin-glsl";
import { fileURLToPath } from "url";
import { extensionsCatalog } from "./scripts/vite-extensions.js";

// The extension API package (also in tsconfig paths; spelled out here so the dev server never misses it)
const api = fileURLToPath(new URL("./packages/api/src/index.ts", import.meta.url));

export default defineConfig({
  root: './src',
  base: './',
  publicDir: '../public',
  build: {
    emptyOutDir: true,
    outDir: '../dist',
  },
  resolve: {
    alias: [{ find: /^@pixprite\/api$/, replacement: api }],
  },
  server: {
    host: true,
    port: 3355,
  },
  // Workers (src/core/compute.worker.ts) resolve the same `~/core/…` paths
  worker: {
    format: 'es',
    plugins: () => [paths({ root: '..' })],
  },
  plugins: [
    paths({ root: '..' }),
    react({
      plugins: [],
      tsDecorators: true,
    }),
    glsl({ minify: process.argv.includes('build') }),
    extensionsCatalog(),
  ],
});
