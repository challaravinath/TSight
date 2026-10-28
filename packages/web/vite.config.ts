import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works from the CLI server and inlined into a report file.
  base: './',
  build: {
    // Inline the fonts, so a report is one file that works offline.
    assetsInlineLimit: 200_000,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 3000,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
