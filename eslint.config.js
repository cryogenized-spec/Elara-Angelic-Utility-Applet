import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Pass 7: first real TypeScript lint gate.
// Commit A: flat config covering src/**, e2e/**, config files, and
// scripts/*.mjs with non-type-aware rules.
// Commit B (independently revertable): type-aware rules via
// projectService, scoped to src/** (what tsconfig.json typechecks; see the
// scoping note on that block for why e2e/** stays non-type-aware).
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // worker/** is out of scope this pass. Measured backlog: 3 unused
      // vars in worker/src/autonomy/engine.ts (SCHEDULER_OVERLAP_CODE,
      // RoutineRunRecord, SchedulerPort) and 4 explicit anys in
      // worker/test/autonomy-engine.test.ts and autonomy-http.test.ts.
      // Keep it ignored until the worker gets its own lint pass so the
      // application gate stays signal-only.
      'worker/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    // Type-aware rules, scoped to exactly what tsconfig.json typechecks
    // (src/**): projectService auto-discovers only a file named
    // tsconfig.json, so tsconfig.e2e.json and the root *.config.ts files
    // are invisible to it. Those files keep the non-type-aware rules
    // above; type-aware lint for e2e/ is a recorded follow-up (it needs
    // its own project mechanism, e.g. an explicit-project setup).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Configured OFF — measured against the codebase before demoting:
      // @typescript-eslint/require-await (182): every port/fake method is
      // async for interface symmetry with its production counterpart, so
      // the keyword is load-bearing even when the body has no await.
      '@typescript-eslint/require-await': 'off',
      // @typescript-eslint/no-unnecessary-type-assertion (66): almost all
      // mechanical (test DOM queries, style-boundary casts); a mechanical
      // cleanup pass, not a style conflict — left off to keep this gate
      // about correctness.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // @typescript-eslint/no-base-to-string (20): explicit String(value)
      // of URL/RequestInfo at fetch boundaries is the established pattern.
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
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
