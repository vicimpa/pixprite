import { defineConfig, mergeConfig } from 'vite';
import production from '../vite.config.js';

// A separate optimized entry/output: diagnostics never enter the shipping build.
export default mergeConfig(production, defineConfig({
  root: '.', base: '/', publicDir: false,
  build: { outDir: 'dist/benchmarks', manifest: false, rollupOptions: { output: { inlineDynamicImports: false }, input: ['benchmarks/index.html', 'benchmarks/virtualization.html', 'benchmarks/history.html'] } },
}));
