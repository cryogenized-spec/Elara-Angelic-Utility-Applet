import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Verification lint authority.
// - Every TypeScript surface is linted.
// - src/** and worker/** use their nearest named tsconfig through projectService.
// - e2e/** uses its non-standard tsconfig.e2e.json explicitly.
// Keep coverage expansion separate from warning promotion: Pass 1 first exposes
// and fixes real findings, then tightens the gate once the repository is clean.
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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'worker/**/*.ts'],
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
      // Pass 1 measures and removes these before the final zero-warning gate.
      '@typescript-eslint/no-explicit-any': 'warn',
      // App.tsx deliberately keeps a best-effort `catch {}` around title
      // generation; an empty catch there is the intended semantics.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unsafe-finally': 'warn',
    },
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
