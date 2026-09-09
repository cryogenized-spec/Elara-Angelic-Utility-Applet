import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'worker/**', '**/node_modules/**', '**/.git/**'],
  },
});
