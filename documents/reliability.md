---
id: SYS-REL
status: active
verified_commit: 0b5fd5623962c1d737ec6f5a793428bc42cc8649
scope: CI, verification integrity, test quality, adversarial certification, coverage, secret scanning, supply-chain controls and certified deployment
paths: [scripts/check-docs.mjs, scripts/check-verification-integrity.mjs, scripts/security-architecture-gate.mjs, scripts/secret-scan.mjs, scripts/supply-chain-gate.mjs, scripts/supply-chain-baseline.json, scripts/test-quality-gate.mjs, scripts/check-coverage.mjs, scripts/verify-coverage-gate.mjs, scripts/coverage-baseline.json, scripts/reliability-gate.mjs, scripts/capture-visual-evidence.mjs, .github/workflows/ci.yml, .github/dependabot.yml, package.json, package-lock.json, .npmrc, .nvmrc, e2e]
keywords: [reliability, ci, exact-head, adversarial, mutation, fail-closed, supply-chain, secret-scan, audit, signature, dependency, coverage, deployment]
---

# Reliability and certification

## 1. Purpose and boundary

`SYS-REL` defines the evidence required before repository work is called complete or shipped. Repository structure is checked as structure; runtime behavior is tested as behavior; dependency capabilities are explicit; credential-shaped material is scanned before installation; and Pages deployment consumes only an artifact produced after the same `main` commit passes certification.

A green result certifies one exact SHA. A PR merge creates a different `main` SHA, so post-merge certification is required before a hardening phase is closed.

## 2. Certification pipeline

```text
exact PR head / main push SHA
-> documentation integrity
-> verification-integrity / anti-fake-green
-> security & architecture capability gate
-> secret scan
-> supply-chain gate
-> test-quality / structural-contract gate
-> adversarial mutation sentinel
-> locked npm ci
-> npm registry-signature verification
-> high-severity dependency audit
-> zero-warning lint
-> TS6 primary typecheck
-> TS7 compatibility typecheck
-> unit tests + whole-source coverage ratchet
-> Worker / Durable Object tests
-> production build
-> Playwright: Chromium + Android portrait + onboarding
-> final reliability gate
-> PR only, after Runtime verification: exact-base/exact-head visual evidence
-> main only: package certified dist/
-> deploy job after Runtime verification succeeds
```

CI pins Node `24.21.0` and npm `11.19.0`. Pull-request checkout explicitly uses `github.event.pull_request.head.sha`; push certification uses `github.sha`. Checkout credentials are not persisted.

## 3. Authorities

| Concern | Authority |
| --- | --- |
| Documentation integrity | `scripts/check-docs.mjs`, `documents/manifest.json` |
| Anti-fake-green integrity | `scripts/check-verification-integrity.mjs` |
| Runtime/security capability boundary | `scripts/security-architecture-gate.mjs` |
| High-confidence committed-secret scan | `scripts/secret-scan.mjs` |
| Dependency/release capability boundary | `scripts/supply-chain-gate.mjs`, `scripts/supply-chain-baseline.json` |
| Structural test-quality rules | `scripts/test-quality-gate.mjs` |
| Coverage measurement/ratchet | `vitest.config.ts`, `scripts/check-coverage.mjs`, `scripts/coverage-baseline.json` |
| Adversarial gate mutation proof | `scripts/verify-coverage-gate.mjs` |
| Runtime invariant gate | `scripts/reliability-gate.mjs` |
| CI and Pages release | `.github/workflows/ci.yml` |
| Automated dependency proposals | `.github/dependabot.yml` |
| Browser behavior | `e2e/`, `playwright.config.ts` |
| Before/after visual evidence | `scripts/capture-visual-evidence.mjs`, `.github/workflows/ci.yml` |
| Worker behavior | `worker/test/`, `vitest.workers.config.ts` |

## 4. Supply-chain contract

`.npmrc` denies git, remote-tarball and file dependency sources and requires explicit install-script review. `package.json` `allowScripts` is a capability list: new packages with install scripts do not acquire execution authority implicitly.

`scripts/supply-chain-baseline.json` freezes reviewed direct dependency specifications, install-script identities, immutable GitHub Action SHAs, Node/npm versions and security overrides. The gate requires registry packages to resolve from `registry.npmjs.org` with SHA-512 lockfile integrity.

CI runs `npm audit signatures` and then `npm audit --audit-level=high`. Phase 4 surfaced a high-severity Sharp/libheif path in Cloudflare development tooling; the repository now pins the patched `sharp 0.35.4` through a reviewed root override, and the lockfile must resolve that version. The override is part of the baseline and meta-gate rather than an undocumented lockfile accident.

Dependabot may propose npm and GitHub Actions updates. Such PRs are expected to fail the frozen capability baseline until the dependency/action change is reviewed and the baseline is deliberately updated.

GitHub Dependency Review is not currently a repository-side certification dependency because the repository's Dependency Graph feature is not enabled. This is not hidden with `continue-on-error`; supported controls remain mandatory instead.

## 5. Secret boundary

`npm run secrets:check` runs before dependency installation and again through final reliability. It rejects tracked private `.env` files and high-confidence credential formats including Google API keys, GitHub tokens, AWS access keys and private-key material. Clearly marked dummy values are tolerated only in test/spec/fixture paths.

The scanner reports path and line but does not echo matched credential material. It complements runtime Lockbox protections; it does not replace provider-side key revocation or GitHub's own secret-scanning features.

## 6. Coverage and behavioral evidence

Vitest V8 coverage includes the complete `src/**/*.{ts,tsx}` tree, excluding only test/spec files and declarations. The certified Phase-3 global floor remains:

| Metric | Floor |
| --- | ---: |
| Lines | 64.14% |
| Statements | 58.73% |
| Functions | 54.21% |
| Branches | 53.44% |

The coverage checker requires all 185 eligible source files to appear in the report and applies independent floors to critical directories/files. Structural source rules live in repository gates rather than pseudo-unit tests, so they do not inflate behavioral test counts or coverage.

Persistence/credential changes require failure-path and migration evidence. Worker changes are verified through the isolated Worker/Durable Object suite. Browser-visible geometry and interaction are owned by Playwright rather than source-string assertions.

For pull requests, the read-only `visual-evidence` job runs only after `Runtime verification` succeeds. It checks out the exact PR head with comparison history, materializes the exact PR base SHA into a detached worktree, installs each side from its own lockfile, and drives the same deterministic browser fixture against both revisions. The canonical initial fixture is Generation Activity at the Android reference viewport `412 x 915`; it emits a viewport PNG, a focused panel PNG and JSON geometry/font metadata under `before/` and `after/`. The pair is uploaded as a seven-day Actions artifact and is not committed to the repository.

Visual evidence is deliberately synthetic: no production secrets, live account data or user conversations are permitted in the fixture. Screenshots are review evidence rather than behavioral assertions; Playwright DOM/runtime checks remain authoritative for interaction correctness. A failed optional presentation asset is recorded in JSON rather than silently treated as proof of the intended rendering.

## 7. CI authority and release semantics

Workflow-wide `GITHUB_TOKEN` permissions default to none. Runtime certification and PR visual evidence each receive read-only repository contents. The permanent certification workflow rejects repository write authority and persisted checkout credentials. GitHub Actions are pinned to reviewed full commit SHAs; each job has an explicit timeout and superseded runs for the same ref are cancelled.

Pages write and OIDC authority exist only in the downstream deploy job. On a `main` push, the runtime job builds and certifies the commit first, then uploads `dist/`; the deploy job has `needs: runtime` and cannot run when certification fails. The former independent Pages workflow must not return.

## 8. Branch/ruleset boundary

Repository rules protect the default branch against deletion and non-fast-forward updates and require changes through pull requests. These server-side controls matter because an in-repo script cannot protect itself from an actor who can rewrite both the script and the workflow.

The preferred final configuration also requires the `Runtime verification` status check before merge. If the ruleset's required-check list is empty, the PR requirement exists but CI is not yet server-enforced as a merge prerequisite; treat that as an external configuration gap rather than pretending an in-repo gate can solve it.

## 9. Adversarial certification

The adversarial sentinel does not merely rerun green gates. It copies the checked-out repository into disposable sandboxes, injects controlled hostile changes, runs the owning guard and requires rejection for the expected reason. A guard that accepts its attack fixture, or rejects only because an unrelated fixture is broken, fails certification.

The protected mutation classes include executable DOM sinks and syntax evasions, dynamic code execution, unreviewed network and Dexie authority, credential-shaped browser persistence, committed secret/private-key material, disabled or narrowed tests, E2E source-boundary cheating, removal of guard controls, mutable or unpinned GitHub Actions, checkout credential persistence, workflow permission escalation, deployment decoupling, mutable dependency installation and runtime-pin drift. The coverage adversary remains part of the same sentinel and requires both metric regression and eligible-source disappearance to fail closed.

Runtime adversarial tests complement those static mutations. In particular, mutation tool calls must not execute after the confirmation shown to the user expires, and a delayed OAuth grant must not revive an expired mutation confirmation. Encrypted credential tests intentionally corrupt sealed material and require fail-closed reads/unlock behavior rather than plaintext recovery or silent weakening.

These tests certify application, credential, authority, test, CI and deployment boundaries. Indirect prompt injection now has an application-enforced containment boundary: successful Calendar/Tasks/Gmail/Drive/Docs/Sheets/YouTube reads intrinsically taint the model turn (with explicit `trust: untrusted-external` as a second tripwire). A mutation proposed by a later model continuation after that taint is marked `untrustedContext`; the confirmation broker displays an external-content warning, leaves the action unselected, and disables approval until the human explicitly selects it. Mutations emitted in the same model batch as a read are not retroactively tainted because the model had not yet received that read result. Grouped items likewise start unselected and there is no approve-all control. Broader cross-turn provenance/taint propagation and semantic information-flow analysis remain future security work rather than a solved claim.

## 10. Completion rule

Never inherit green status across SHAs. Temporary bootstrap/write-capable workflows or jobs are not certification evidence and must be removed before the candidate run. Focused tests are useful for iteration but do not replace the ordered full matrix.

Phase completion requires: exact PR-head certification, merge locked to that head, successful post-merge `main` certification, and successful certified Pages deployment when deployment is part of the change.


### Browser fixture isolation

Provider-mocked Playwright UI suites use `serviceWorkers: 'block'` in the test context: an activated dev worker can otherwise bypass page-level provider routes and send fixture traffic to the network. This does not alter production PWA registration or runtime caching. Tests that verify service-worker behavior explicitly opt into `serviceWorkers: 'allow'`; the kanban PWA integration group waits for readiness, reloads under a controller, and verifies board/chat navigation on desktop and Android portrait. Mocked-provider tests must not be presented as offline/installed-PWA certification.
