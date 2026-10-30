import { defineConfig, mergeConfig } from 'vite';
import production from '../vite.config.js';

// Real optimized editor modules in an isolated test output; no diagnostics in dist/.
export default mergeConfig(production, defineConfig({
  root: '.', base: '/__security__/', publicDir: false,
  build: { outDir: '.extension-dist', manifest: false, rollupOptions: { input: ['e2e/security.html'] } },
}));
