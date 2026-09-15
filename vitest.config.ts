import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./test/virtual-pwa-register.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'worker/**', '**/node_modules/**', '**/.git/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/*.d.ts',
      ],
      reportOnFailure: true,
    },
  },
});
