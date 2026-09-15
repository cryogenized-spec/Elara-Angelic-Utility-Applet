---
id: SYS-REL
status: active
verified_commit: 02ae039eda51715f2950cf268a6fc0d55e65065c
scope: CI, automated verification, test quality, coverage, diagnostics and release-quality gates
paths: [scripts/check-docs.mjs, scripts/check-verification-integrity.mjs, scripts/security-architecture-gate.mjs, scripts/test-quality-gate.mjs, scripts/check-coverage.mjs, scripts/coverage-baseline.json, scripts/reliability-gate.mjs, vitest.config.ts, .github/workflows/ci.yml, e2e]
keywords: [reliability, testing, coverage, ratchet, ci, diagnostics, performance, e2e, lint, typecheck, structural-gate]
---

# Reliability, testing and diagnostics

## 1. Purpose and boundary

`SYS-REL` defines the evidence required to keep `main` shippable. Verification is layered deliberately: repository structure is checked as structure, runtime behavior is tested as behavior, unit coverage is measured across the complete `src/` tree, Worker behavior has its own isolated suite, and Playwright is the authority for browser-visible geometry and interaction.

A test is not counted as behavioral evidence merely because it is stored in a `*.test.ts(x)` file. Unit/Worker tests must execute code. Source-text/CSS architecture assertions belong in dependency-free repository gates and therefore do not inflate unit-test or coverage numbers.

## 2. Runtime architecture

```text
change
-> documentation integrity
-> verification-integrity / anti-fake-green
-> security & architecture capability gate
-> test-quality / structural-contract gate
-> npm ci
-> zero-warning lint
-> TS6 primary typecheck
-> TS7 compatibility typecheck
-> unit tests + whole-source V8 coverage ratchet
-> Worker / Durable Object tests
-> production build
-> Playwright: Chromium + Android portrait + onboarding
-> final reliability gate
```

CI targets Node 24. All dependency-free policy gates run before package installation. The final reliability command reruns documentation, verification-integrity, security and test-quality checks before the older runtime invariant gate.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Documentation integrity | `scripts/check-docs.mjs`, `documents/manifest.json` |
| Verification / fake-green integrity | `scripts/check-verification-integrity.mjs` |
| Security capability boundary | `scripts/security-architecture-gate.mjs` |
| Structural test-quality boundary | `scripts/test-quality-gate.mjs` |
| Coverage measurement | `vitest.config.ts`, `@vitest/coverage-v8` |
| Coverage ratchet | `scripts/check-coverage.mjs`, `scripts/coverage-baseline.json` |
| CI pipeline | `.github/workflows/ci.yml` |
| Runtime invariant gate | `scripts/reliability-gate.mjs` |
| Unit/integration behavior | colocated `*.test.ts(x)` |
| Worker behavior | `worker/test/`, `vitest.workers.config.ts` |
| Browser behavior | `e2e/`, `playwright.config.ts` |
| Typecheck | `tsconfig.json`, `worker/tsconfig.json`, `tsconfig.e2e.json` |
| Lint | `eslint.config.js` |

## 4. Verification contract

The broad completion path is ordered and must not be shortened when repository-level work is reported complete:

```text
npm run docs:check
npm run verify:gates
npm run security:check
npm run test:quality
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run typecheck:ts7
npm run test:coverage
npm run test:workers
npm run build
npm run e2e -- --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

`npm test` remains a fast local iteration command. It is not the repository certification command because it does not enforce the coverage ratchet. `npm run test:coverage` executes the same unit suite with V8 instrumentation and then runs `coverage:check`.

## 5. Behavioral tests versus structural contracts

Behavioral tests call exported logic, render components, exercise storage, simulate failures/cancellation, or drive the app through Playwright. They should fail because observable behavior changed.

Structural rules that are genuinely about what code is allowed to exist are owned by `scripts/test-quality-gate.mjs`. Current structural contracts include:

- unit/Worker tests may not read implementation/CSS files through `node:fs`/`node:path` and present those strings as runtime test evidence;
- Workspace shortcuts may not synthesize hidden model turns;
- App navigation/mutation paths must retain the terminal-save ownership boundary whose pure behavior is unit-tested in `src/chat/`;
- shell geometry selectors retain one reviewed owner while Playwright measures actual boxes;
- Elara-owned YouTube player presets may style the outer surface but may not overlay or manipulate the provider iframe.

This separation prevents source-grep tests from padding test counts or coverage while retaining cheap architecture enforcement where source structure is the actual invariant.

## 6. Coverage ratchet

Vitest V8 coverage includes the complete `src/**/*.{ts,tsx}` tree and excludes only test/spec files and declarations. Untested application files therefore count against the total; weak areas are visible rather than hidden through an exclusion list.

The certified whole-source Phase-3 starting floor is:

| Metric | Floor |
| --- | ---: |
| Lines | 63.83% |
| Statements | 58.39% |
| Functions | 54.02% |
| Branches | 53.21% |

`scripts/coverage-baseline.json` also sets independent floors for `autonomy`, `chat`, `domain`, `gemini`, `media`, `memory` and `persistence`, plus security/authority-critical files such as the autonomy credential/pairing stores, Gemini Lockbox, generation sync, provider, global playback authority and memory store. This prevents increased coverage in an easy subsystem from masking a regression in a critical one.

The verification-integrity gate carries immutable minimum global floors and requires every critical directory/file entry to remain represented. Raising a floor is allowed. Quietly lowering/removing the ratchet is not.

Coverage is one signal, not a correctness score. `App.tsx` and browser geometry rely heavily on Playwright; whole-source coverage intentionally exposes that unit-test gap rather than pretending E2E execution was unit coverage.

## 7. Failure, migration and persistence evidence

Persistence changes require failure-path evidence, not only successful round trips. Central database version bumps require migration tests from an existing schema. Credential migration must prove loss safety: plaintext legacy material is removed only after a protected write succeeds and remains recoverable when that write fails.

Generation/persistence tests must cover cancellation, terminal state, delayed settlement and navigation boundaries where applicable. Tests should use controlled failure injection at a real authority seam instead of asserting that an implementation string exists.

## 8. Security and diagnostics

Diagnostics redact credentials, OAuth material, raw attachment payloads and private reasoning. Test fixtures never use production credentials. E2E failure artifacts may contain application state; retention stays bounded.

CI repository permissions remain read-only. Workflow/ruleset and dependency supply-chain hardening are separate repository-control concerns; the in-repo gates cannot protect themselves against an actor who is authorized to rewrite every workflow and branch rule simultaneously.

## 9. Completion and certification

Never claim a check passed if it was not run. A green PR head certifies that exact SHA only. Merge completion is followed by the same CI matrix on the resulting `main` commit before a hardening phase is called fully certified.

Focused checks are useful during implementation but do not replace the broad matrix. If a required environment cannot execute a layer, record the gap explicitly rather than inferring success from another layer.
