import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    target: 'es2020',
    outDir: path.resolve(__dirname, '../public/customer'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/customer-app.tsx'),
      output: {
        format: 'es',
        entryFileNames: 'customer-app.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? '';
          if (name.endsWith('.css')) return 'menu-book.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
