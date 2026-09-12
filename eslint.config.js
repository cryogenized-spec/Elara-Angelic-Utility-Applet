import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Pass 7, commit A: first real TypeScript lint gate.
// Flat config covering src/**, e2e/**, config files, and scripts/*.mjs.
// Type-aware (projectService) rules are deliberately OFF here; they land as a
// separate, independently revertable commit.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // worker/** is out of scope this pass: the first sweep found 3 unused
      // vars and 4 explicit anys in worker/src/autonomy/engine.ts and worker
      // tests. Keep it ignored until the worker gets its own lint pass so the
      // application gate stays signal-only.
      'worker/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    rules: {
      // The repo already uses the _event/_stream/_score convention for
      // deliberately unused parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Warn only: the codebase uses `any` at a few deliberate provider
      // boundaries; a full `any` cleanup is a separate pass.
      '@typescript-eslint/no-explicit-any': 'warn',
      // App.tsx deliberately keeps a best-effort `catch {}` around title
      // generation; an empty catch there is the intended semantics.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 23 pre-existing findings (12 set-state-in-effect, 9 purity,
      // 2 exhaustive-deps), triaged to a dedicated effects pass. Keep them
      // visible as warnings instead of hiding or fixing them here.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // One deliberate Composer.tsx VTT session guard relies on a finally
      // clause after an awaited rejection path.
      'no-unsafe-finally': 'warn',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Preserved from the pre-Pass 7 config: scripts log by design, but
      // stray console calls in app code are still worth seeing.
      'no-console': 'warn',
    },
  },
);
