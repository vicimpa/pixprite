import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  root: './src',
  base: './',
  publicDir: '../public',
  build: {
    emptyOutDir: true,
    outDir: '../dist',
  },
  server: {
    host: true,
    port: 3355,
  },
  plugins: [
    react({
      plugins: [],
      tsDecorators: true,
    }),
  ],
});
