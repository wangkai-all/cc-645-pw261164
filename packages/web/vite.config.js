import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The gateway serves the built app and proxies API/WS in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
