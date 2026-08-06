import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Le frontend React est monté sur /v2 pendant la migration progressive :
// l'application vanilla d'origine reste servie sur / et continue de fonctionner.
export default defineConfig({
  plugins: [react()],
  base: '/v2/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // legacy/ étant sous la racine Vite, l'import de legacy/css/app.css
    // (source unique du style) ne demande plus de dérogation `fs.allow`.
    proxy: {
      '/api':     { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
