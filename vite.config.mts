import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${root}src/renderer`,
  base: './',
  plugins: [
    react(),
    {
      // The React refresh preamble is an inline script; allow it only in dev.
      name: 'dev-csp',
      apply: 'serve',
      transformIndexHtml: (html: string) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ],
  server: { port: 5183, strictPort: true },
  build: {
    outDir: `${root}dist`,
    emptyOutDir: true,
    rollupOptions: {
      // The app window and the in-game timer overlay.
      input: {
        main: `${root}src/renderer/index.html`,
        overlay: `${root}src/renderer/overlay.html`,
      },
    },
  },
  test: {
    root,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
