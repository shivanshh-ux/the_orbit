import { defineConfig } from 'vite';

import { resolve } from 'path';

export default defineConfig({
  root: './',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mercury: resolve(__dirname, 'mercury.html'),
        venus: resolve(__dirname, 'venus.html'),
        earth: resolve(__dirname, 'earth.html'),
        mars: resolve(__dirname, 'mars.html'),
        jupiter: resolve(__dirname, 'jupiter.html'),
        saturn: resolve(__dirname, 'saturn.html'),
        uranus: resolve(__dirname, 'uranus.html'),
        neptune: resolve(__dirname, 'neptune.html'),
      }
    }
  }
});

