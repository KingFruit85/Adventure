import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all API routes (mounted under /api in buildApp) to the Hono
      // backend in dev. Matches the Vercel-prod URL shape so the web client
      // uses the same paths everywhere.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
