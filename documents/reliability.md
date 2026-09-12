---
id: SYS-REL
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: CI, automated verification, diagnostics and release-quality gates
paths: [scripts/reliability-gate.mjs, .github/workflows/ci.yml, e2e]
keywords: [reliability, testing, ci, diagnostics, analytics, performance, e2e]
---

# Reliability, testing and diagnostics

## 1. Purpose and boundary

`SYS-REL` defines the checks that keep `main` shippable and the safe diagnostics needed to understand failures. Tests are layered: focused unit/contract tests prove domain rules, Worker tests prove cloud behavior, build/type/lint catch integration problems, and Playwright proves user-visible flows.

## 2. Runtime architecture

```text
change
-> lint
-> web + worker typecheck
-> unit tests
-> Worker/Durable Object tests
-> build
-> Playwright browser projects
-> reliability invariant gate
```

CI targets Node 24 and currently runs Chromium, Android-portrait and onboarding Playwright projects. The final reliability script also inspects source text for architectural invariants that ordinary type/tests do not express cheaply.

## 3. Source map

| Concern | Authority |
| --- | --- |
| CI pipeline | `.github/workflows/ci.yml` |
| Architecture invariant gate | `scripts/reliability-gate.mjs` |
| Browser E2E | `e2e/`, `playwright.config.ts` |
| Unit/integration | colocated `*.test.ts(x)` |
| Worker tests | `worker/test/`, `vitest.workers.config.ts` |
| Artifact verification | `scripts/verify-artifact-assets.mjs` |
| Worker verification | `scripts/verify-gemini-worker.mjs` and related scripts |

## 4. Data and contracts

Primary commands are `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:workers`, `npm run build`, `npm run e2e`, and `npm run reliability:check`. Focused checks include `verify:artifact-assets`, `verify:worker` and subsystem tests.

The invariant gate currently protects, among other things: no legacy Gemini `generateContent`; direct browser Interactions provider with Lockbox credential and stable `v1`; no empty-character prompt injection; registry-derived tool declarations; explicit Google confirmation controls; safe Markdown; artifact integrity; BusyTeX shell escape disabled; VTT provider boundaries; and selected autonomy/roleplay invariants.

Diagnostics and analytics are distinct. Diagnostics explain bounded individual failures with safe categories/correlation metadata; analytics, where used, receives privacy-approved aggregates rather than transcripts, files, secrets or raw provider traces.

## 5. Invariants

- Never claim a check passed if it was not run.
- Main-quality milestones must leave relevant lint/type/test/build gates green.
- Architecture invariants should be executable when a cheap stable assertion exists.
- E2E failure artifacts may contain app state; keep retention bounded and never deliberately log credentials.
- Performance/accessibility/mobile reliability are product constraints, not decorative post-processing.
- Documentation checks must converge on canonical `/documents`; legacy path assertions are temporary migration debt.

## 6. Security and failure semantics

Diagnostic records redact credentials, OAuth material, raw attachment payloads and private reasoning. Provider/tool failures are normalized before UI/export. CI permissions remain minimal. Test fixtures must not use production credentials.

## 7. Verification and tests

The complete broad gate is the command sequence listed above. When changing one subsystem, run its focused tests first, then the applicable repository gate. Physical Android behavior that browser automation cannot reproduce is reported as a validation gap rather than inferred from green desktop CI.

## 8. Known gaps

CI/reliability still names several legacy `/docs` files as required foundation documents. Repoint those assertions before deleting the legacy tree. A dedicated documentation-integrity guard is not yet present; it should validate the manifest, canonical file/path references and forbidden legacy documentation patterns.
