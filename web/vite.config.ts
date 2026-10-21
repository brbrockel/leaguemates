/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  // Shown in the profile menu: the release, and the commit when it isn't a release build.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload by itself: an update could land mid-scorecard. UpdateBanner offers it.
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'TeeMate',
        short_name: 'TeeMate',
        description: 'Tee times, pairings and standings for your golf league',
        theme_color: '#15803d',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        // Cache the app shell only. API responses are never cached, and /api is never answered with index.html.
        navigateFallbackDenylist: [/^\/api\//],
        // Push notifications: shows them and opens the right page when tapped.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 4101,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4100' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
});
