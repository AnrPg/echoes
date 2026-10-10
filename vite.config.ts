import { defineConfig } from 'vitest/config';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: { input: { inspector: 'src/pages/inspector.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
