import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all API routes to the Hono backend in dev.
      '/sessions': { target: 'http://localhost:3000', changeOrigin: true },
      '/adventures': { target: 'http://localhost:3000', changeOrigin: true },
      '/device-sessions': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
