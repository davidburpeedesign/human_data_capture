import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /**
   * Relative asset paths, so the same build works at a domain root, in a
   * GitHub Pages project subpath (/human_data_capture/), or from a local
   * static server without rebuilding.
   */
  base: './',
  server: { port: 5173 },
  // three.js alone is ~600 kB; one chunk is fine for a single-screen tool.
  build: { chunkSizeWarningLimit: 1200 },
});
