# Agent instructions — Elara Angelic

This repository is maintained for repeated AI-assisted development. Minimize archaeology and context load: read only the subsystem material required for the task.

## Load protocol

1. Read `documents/manifest.json`.
2. Route by the longest matching source-path prefix. If equally specific routes tie, load all tied system documents. Use keywords for conceptual tasks without a clear path.
3. Load one canonical system document by default.
4. Fetch only the exact source/tests needed to verify or change that contract.
5. Load `documents/architecture.md` or another system document only when the task crosses a declared boundary.

Authority is `source + tests -> canonical /documents`. Git history is evidence/history only; it is not current technical authority.

Update the owning canonical system document whenever a durable contract changes. Do not create new `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, roadmap, milestone or implementation-log documents. Do not create a second documentation root. Chronology belongs in Git.

## Engineering boundaries

Use implementation and tests, not old design prose, to determine runtime truth. Keep one canonical interactive Gemini path. Keep credentials behind their owning authority. UI must not own raw provider requests, OAuth internals, secrets or database implementation. Validate trust-boundary data. Preserve one authoritative state owner per domain rather than creating parallel stores.

Normal interactive Gemini is browser-direct through `src/gemini/provider.ts` and the local Lockbox. Google Workspace authorization is browser-side GIS through `src/google/oauth/`. Cloud Worker/autonomy execution is a separate runtime plane. VTT is an input modality and must not create a competing chat provider/persona. See `SYS-ARCH / documents/architecture.md` before changing those boundaries.

A green test that passes for the wrong reason is a defect. Strengthen the assertion or fixture until it proves the intended invariant; do not weaken product or test contracts merely to make a gate green.

## Change discipline

Prefer narrow changes in the owning subsystem. Reuse existing schemas, repositories, registries and state machines before introducing another authority. Prefer exact symbols, paths, compact flows and invariants over repeated explanatory prose. When a task exposes stale documentation, fix the canonical document rather than adding a compensating note.

Before writing directly to `main`, check open PRs and recent `main` movement. If another active workstream depends on a stable base or touches the same files, use a short-lived branch and do not move, close or rewrite that work. Direct `main` writes remain acceptable when no such conflict exists. Do not leave stale or superseded pull requests open.

## Verification

Before calling repository work complete, run the broad gate in this order:

```text
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright test --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

CI is the release authority. If the current environment cannot execute Playwright, state that explicitly and rely on CI for browser evidence; `playwright --list` proves discovery/parsing only, not execution. Never claim an unrun gate passed.
