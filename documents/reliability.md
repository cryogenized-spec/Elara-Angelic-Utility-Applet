---
id: SYS-REL
status: active
verified_commit: 52a37aa242d97012b67d2e8b50fd07a94a1857e2
scope: CI, automated verification, diagnostics and release-quality gates
paths: [scripts/check-docs.mjs, scripts/check-verification-integrity.mjs, scripts/reliability-gate.mjs, .github/workflows/ci.yml, e2e]
keywords: [reliability, testing, ci, diagnostics, analytics, performance, e2e, lint, typecheck, documentation, verification-integrity, anti-cheat]
---

# Reliability, testing and diagnostics

## 1. Purpose and boundary

`SYS-REL` defines the checks that keep `main` shippable and the safe diagnostics needed to understand failures. Tests are layered: documentation integrity protects the canonical knowledge surface, verification integrity protects the test/CI harness from common false-positive shortcuts, focused unit/contract tests prove domain rules, Worker tests prove cloud behavior, build/type/lint catch integration problems, and Playwright proves user-visible flows.

A green command is evidence only for the surface it actually checks. In particular, the current lint configuration does not lint application or E2E TypeScript; see chapter 8.

## 2. Runtime architecture

```text
change
-> documentation integrity
-> verification-integrity guard
-> dependency install
-> lint
-> typecheck
-> unit tests
-> Worker/Durable Object tests
-> build
-> Playwright browser projects
-> reliability invariant gate (includes docs + verification integrity)
```

CI targets Node 24 and runs Chromium, Android-portrait and onboarding Playwright projects. The final reliability script also inspects source text for architectural invariants that ordinary type/tests do not express cheaply.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Documentation integrity | `scripts/check-docs.mjs`, `documents/manifest.json` |
| Verification/test-harness integrity | `scripts/check-verification-integrity.mjs` |
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
npm run verify:gates
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright test --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

`npm run docs:check` is dependency-free. It validates the manifest, active system docs/frontmatter/chapter shape, declared source paths, the closed canonical `/documents` file set, local Markdown links, and the absence of the retired `/docs`/historical filename/reference conventions. Retired `docs/*.md` references are rejected even when they appear as plain text or source comments rather than clickable Markdown links.

`npm run verify:gates` is also dependency-free and runs before dependency installation in CI. It pins the reviewed npm gate commands and CI command order, rejects CI bypass markers, verifies the expected Playwright project routing and E2E TypeScript coverage, rejects disabled/focused/expected-failure E2E controls, rejects the retired browser `/api/gemini` path, and rejects E2E code that directly imports application source or directly writes IndexedDB. Local-storage writes in E2E are limited to the explicit onboarding setup and legacy-migration fixtures. CI also refuses to reuse a pre-existing Playwright web server.

`npm run reliability:check` chains documentation integrity and verification integrity before the architecture invariant gate. This makes common in-repository weakening visible, but it is not a cryptographic trust anchor: a writer who can alter the workflow and every guard together can still change policy. Repository/branch protection must provide that external governance boundary.

`npm run typecheck` covers the web source project, Worker project and the full `e2e/` Playwright project. Focused checks include `typecheck:e2e`, `verify:artifact-assets`, `verify:worker` and subsystem tests. Focused checks are iteration aids; they do not replace the broad gate when claiming repository-level completion.

The runtime invariant gate protects, among other things: no legacy Gemini `generateContent`; direct browser Interactions provider with Lockbox credential and stable `v1`; no empty-character prompt injection; registry-derived tool declarations; explicit Google confirmation controls; safe Markdown; artifact integrity; BusyTeX shell escape disabled; VTT provider boundaries; and selected autonomy/roleplay invariants.

## 5. Invariants

- Never claim a check passed if it was not run.
- CI is the authority for branch/release verification; local results are supporting evidence.
- A passing test that exercises the wrong state, bypasses the user/runtime boundary it claims to test, or cannot fail when its invariant is broken is not evidence.
- E2E may stub external provider/browser boundaries. It must not forge app-owned runtime state except in an explicitly named setup or migration test.
- E2E storage inspection is read-only unless the test specifically proves a storage migration; ordinary feature tests drive state through the application UI/API boundary.
- Canonical documentation routing/tree integrity is executable policy, not reviewer convention.
- Main-quality milestones must leave relevant docs/gate-integrity/lint/type/test/build/browser gates green.
- Architecture invariants should be executable when a cheap stable assertion exists.
- E2E failure artifacts may contain app state; keep retention bounded and never deliberately log credentials.
- Performance/accessibility/mobile reliability are product constraints, not decorative post-processing.
- Removed `/docs`, pass/status/handoff/recovery/roadmap/implementation-log documentation must not return.

## 6. Security and failure semantics

Diagnostic records redact credentials, OAuth material, raw attachment payloads and private reasoning. Provider/tool failures are normalized before UI/export. CI permissions remain repository-read-only. Test fixtures use synthetic credentials only. The documentation and verification-integrity guards read repository text/metadata only and perform no network access or package installation.

A repo-local checker cannot make itself tamper-proof. The code guards make accidental or ordinary agent weakening fail closed; protection against an actor deliberately editing the workflow and its guards together belongs to GitHub repository policy, required reviews and protected-branch/ruleset settings.

## 7. Verification and tests

When changing one subsystem, run focused tests first, then the broad ordered gate above. Documentation-only changes still run `docs:check` and `verify:gates`; they do not bypass current-state integrity. If the current environment cannot execute Playwright, report that explicitly and rely on CI for browser evidence. `npx playwright test --list` confirms discovery/parsing only, not browser validation.

Playwright fixtures are classified by what they replace. External boundaries such as Gemini responses, Google Identity Services/userinfo, YouTube responses, microphone APIs and visibility state may be deterministic test doubles. App-owned state should be produced by the app itself; the explicit onboarding baseline and legacy-storage migration cases are the narrow exceptions and are pinned by `verify:gates`.

Physical Android behavior that browser automation cannot reproduce is reported as a validation gap rather than inferred from green desktop or emulated-browser CI.

## 8. Known gaps

`eslint.config.js` currently ignores `src/**/*.ts`, `src/**/*.tsx` and `e2e/**/*.ts`. Therefore `npm run lint` being green proves that the lint command executed, but **does not prove application or E2E TypeScript lint cleanliness**. This is genuine verification debt and requires a TypeScript-aware ESLint configuration before lint can be treated as a full source-quality gate.

CI currently installs dependencies with `npm install` rather than lockfile-strict `npm ci`. The committed lockfile is available, so switching CI to `npm ci` is a separate reproducibility hardening opportunity; it is not silently treated as completed here.

At the verified repository state, `main` is not protected by a GitHub branch protection rule. Repo-contained checks therefore cannot stop a sufficiently privileged writer from replacing the checks themselves; external branch/ruleset governance remains the trust boundary for deliberate tampering.

The documentation guard validates local structure/references and source-path existence; it intentionally does not judge whether prose is semantically current. Source/tests still outrank prose, and durable behavior changes must update the owning system document in the same change.
