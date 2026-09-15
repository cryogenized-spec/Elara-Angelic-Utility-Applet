import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Verification lint authority.
// - Every TypeScript surface is linted.
// - src/** and worker/src/** use their nearest named tsconfig through projectService.
// - e2e/** uses its non-standard tsconfig.e2e.json explicitly.
// - worker/test/** is still linted with the non-type-aware TypeScript rules;
//   authoritative type safety there remains worker/tsconfig.json + the Worker
//   Vitest suite because Cloudflare's virtual test bindings are not resolved
//   correctly by the standard ESLint type-service parser.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'worker/src/**/*.ts'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Port/fake methods intentionally stay async for interface symmetry even
      // when a particular implementation has no await.
      '@typescript-eslint/require-await': 'off',
      // Existing assertion-heavy test/style boundaries make this mostly a
      // mechanical cleanup rather than a correctness gate.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Explicit String(value) at fetch/URL boundaries is an established
      // provider-boundary pattern in this repository.
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.e2e.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      // IndexedDB event handlers expose DOMException | null. Playwright storage
      // fixtures intentionally mirror that browser API; synthesizing replacement
      // Error instances at every reject site would not strengthen the behavior
      // under test. Other type-aware promise rules remain enabled.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
  {
    rules: {
      // The repo uses the _event/_stream/_score convention for deliberately
      // unused parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // App.tsx deliberately keeps a best-effort `catch {}` around title
      // generation; an empty catch there is the intended semantics.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-unsafe-finally': 'error',
    },
  },
  {
    // App is an orchestration shell: its direct clock reads occur in event/
    // async lifecycle handlers, plus the one boot placeholder. React's purity
    // rule conservatively reports those nested handlers as render-time reads.
    // The verification-integrity script freezes the reviewed clock-read count,
    // so disabling this compiler diagnostic here cannot silently grow powers.
    files: ['src/app/App.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  },
  {
    // These effects synchronize React with external authorities/lifecycles.
    // The rule follows their refresh functions and reports the downstream
    // state publication as synchronous even though the authority read is async.
    // Sidebar's visibility boundary intentionally resets transient UI state.
    files: ['src/app/components/GeminiApiLockbox.tsx', 'src/app/components/Sidebar.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    // Two worker HTTP fixtures intentionally inspect untyped response JSON.
    // Production worker code remains type-aware and no-explicit-any stays an
    // error everywhere else; Pass 3 can replace these legacy fixture casts.
    files: ['worker/test/autonomy-engine.test.ts', 'worker/test/autonomy-http.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'warn',
    },
  },
);
