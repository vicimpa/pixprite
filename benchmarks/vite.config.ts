import { defineConfig, mergeConfig } from 'vite';
import production from '../vite.config.js';

// A separate optimized entry/output: diagnostics never enter the shipping build.
export default mergeConfig(production, defineConfig({
  root: '.', base: '/', publicDir: false,
  build: { outDir: '.benchmark-dist', manifest: false, rollupOptions: { input: 'benchmarks/index.html' } },
}));
