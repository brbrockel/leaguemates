import { defineConfig } from '@vite-pwa/assets-generator/config';

/**
 * The icon set, generated from public/icon.svg at build time (never committed).
 *
 * icon.svg is the rounded green tile. Where a platform applies its own shape, the tile is
 * laid on a green ground so nothing white shows at the edges: iOS rounds the corners
 * itself, and Android's maskable icon is cut to a circle or squircle, so its artwork is
 * padded into the safe zone.
 */
const GREEN = '#15803d';

export default defineConfig({
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, 'favicon.ico']],
      padding: 0,
    },
    maskable: {
      sizes: [512],
      padding: 0.15,
      resizeOptions: { background: GREEN },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: GREEN },
    },
  },
  images: ['public/icon.svg'],
});
