import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2022',
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
