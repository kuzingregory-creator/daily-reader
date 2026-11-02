/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// Dev only: lists books/*.json so the app (on the Mac or on the iPhone over Wi‑Fi)
// can load the converted books without copying files to the phone.
function devBooks(): Plugin {
  return {
    name: 'dev-books',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/books', (_req, res) => {
        const files = readdirSync('books').filter((f) => f.endsWith('.json'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(files));
      });
    },
  };
}

const THEME = '#ecdcb4';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; set BASE_PATH=/daily-reader/ when building for it.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    preact(),
    devBooks(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Daily Reader',
        short_name: 'Reader',
        description: 'Read a little every day and learn the words you meet.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs, including the word tables, works offline after the first visit.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['src/**/*.test.ts'] },
});
