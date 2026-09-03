export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'src/**/*.ts',
      'src/**/*.tsx',
      'e2e/**/*.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'no-console': 'warn',
    },
  },
];
