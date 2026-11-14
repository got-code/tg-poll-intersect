import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: ['chrome100', 'firefox100'],
    manifest: true,
    license: { fileName: 'THIRD-PARTY-LICENSES.txt' },
  },
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  preview: { host: '127.0.0.1', port: 3000, strictPort: true },
  plugins: [
    {
      name: 'local-hmr-policy',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html.replace('connect-src ', 'connect-src ws://127.0.0.1:* ws://localhost:* '),
      },
    },
  ],
});
