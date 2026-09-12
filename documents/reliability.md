---
id: SYS-REL
status: active
verified_commit: 8833818cafaca07d04552ead41c250bc9c4e9a1a
scope: CI, automated verification, diagnostics and release-quality gates
paths: [scripts/check-docs.mjs, scripts/reliability-gate.mjs, .github/workflows/ci.yml, e2e]
keywords: [reliability, testing, ci, diagnostics, analytics, performance, e2e, lint, typecheck, documentation]
---

# Reliability, testing and diagnostics

## 1. Purpose and boundary

`SYS-REL` defines the checks that keep `main` shippable and the safe diagnostics needed to understand failures. Tests are layered: documentation integrity protects the canonical knowledge surface, focused unit/contract tests prove domain rules, Worker tests prove cloud behavior, build/type/lint catch integration problems, and Playwright proves user-visible flows.

## 2. Runtime architecture

```text
change
-> documentation integrity
-> lint
-> typecheck
-> unit tests
-> Worker/Durable Object tests
-> build
-> Playwright browser projects
-> reliability invariant gate (includes documentation integrity)
```

CI targets Node 24 and currently runs Chromium, Android-portrait and onboarding Playwright projects. The final reliability script also inspects source text for architectural invariants that ordinary type/tests do not express cheaply.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Documentation integrity | `scripts/check-docs.mjs`, `documents/manifest.json` |
| CI pipeline | `.github/workflows/ci.yml` |
| Architecture invariant gate | `scripts/reliability-gate.mjs` |
| Browser E2E | `e2e/`, `playwright.config.ts` |
| Typecheck configuration | `tsconfig.json`, `worker/tsconfig.json`, `tsconfig.e2e.json`, package scripts |
| Lint configuration | `eslint.config.js` |
| Unit/integration | colocated `*.test.ts(x)` |
| Worker tests | `worker/test/`, `vitest.workers.config.ts` |
| Artifact verification | `scripts/verify-artifact-assets.mjs` |
| Worker verification | `scripts/verify-gemini-worker.mjs` and related scripts |

## 4. Data and contracts

The broad completion gate is ordered and must not be shortened when work is reported as complete:

```text
npm run docs:check
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright test --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

`npm run docs:check` is dependency-free. It validates the manifest, active system docs/frontmatter/chapter shape, declared source paths, the closed canonical `/documents` file set, local Markdown links, and the absence of the retired `/docs`/historical filename/reference conventions. CI runs it before dependency installation. `npm run reliability:check` chains it again before the runtime invariant gate, so the final gate cannot pass while canonical documentation integrity is broken.

`npm run typecheck` covers the web source project, Worker project and the full `e2e/` Playwright project. Focused checks include `typecheck:e2e`, `verify:artifact-assets`, `verify:worker` and subsystem tests. Focused checks are iteration aids; they do not replace the broad gate when claiming repository-level completion.

The runtime invariant gate protects, among other things: no legacy Gemini `generateContent`; direct browser Interactions provider with Lockbox credential and stable `v1`; no empty-character prompt injection; registry-derived tool declarations; explicit Google confirmation controls; safe Markdown; artifact integrity; BusyTeX shell escape disabled; VTT provider boundaries; and selected autonomy/roleplay invariants.

Diagnostics and analytics are distinct. Diagnostics explain bounded individual failures with safe categories/correlation metadata; analytics, where used, receives privacy-approved aggregates rather than transcripts, files, secrets or raw provider traces.

## 5. Invariants

- Never claim a check passed if it was not run.
- CI is the authority for branch/release verification; local results are supporting evidence.
- Canonical documentation routing/tree integrity is executable policy, not reviewer convention.
- A passing test that exercises the wrong state or cannot fail when its invariant is broken is not evidence; strengthen the test instead of weakening the contract.
- Main-quality milestones must leave relevant docs/lint/type/test/build/browser gates green.
- Architecture invariants should be executable when a cheap stable assertion exists.
- E2E failure artifacts may contain app state; keep retention bounded and never deliberately log credentials.
- Performance/accessibility/mobile reliability are product constraints, not decorative post-processing.
- Removed `/docs`, pass/status/handoff/recovery/roadmap/implementation-log documentation must not return.

## 6. Security and failure semantics

Diagnostic records redact credentials, OAuth material, raw attachment payloads and private reasoning. Provider/tool failures are normalized before UI/export. CI permissions remain minimal. Test fixtures must not use production credentials. The documentation guard reads repository text/metadata only and performs no network access or package installation.

## 7. Verification and tests

When changing one subsystem, run focused tests first, then the broad ordered gate above. Documentation-only changes still run `npm run docs:check`; they do not get to bypass current-state integrity. If the current environment cannot execute Playwright, report that explicitly and rely on CI for browser evidence. `npx playwright test --list` is useful for confirming discovery and syntax, but it is not browser validation.

Physical Android behavior that browser automation cannot reproduce is reported as a validation gap rather than inferred from green desktop or emulated-browser CI.

## 8. Known gaps

At the verified commit, `eslint.config.js` explicitly ignores `src/**/*.ts`, `src/**/*.tsx` and `e2e/**/*.ts`. Therefore `npm run lint` being green does not yet prove application TypeScript lint cleanliness. Treat that as verification debt until a TypeScript-aware ESLint configuration lands.

The documentation guard validates local structure/references and source-path existence; it intentionally does not judge whether prose is semantically current. Source/tests still outrank prose, and durable behavior changes must update the owning system document in the same change.
