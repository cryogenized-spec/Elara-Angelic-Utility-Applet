# Agent instructions — Elara Angelic

This repository is maintained for repeated AI-assisted development. Minimize archaeology and context load: read only the subsystem material required for the task.

## Load protocol

1. Read `documents/manifest.json`.
2. Route by the most-specific matching source path; use keywords when the task is conceptual rather than path-scoped.
3. Load one canonical system document by default.
4. Fetch only the exact source/tests needed to verify or change that contract.
5. Load `documents/architecture.md` or a second system document only when the task crosses a declared boundary.

Authority is `source + tests -> canonical /documents`. Legacy `/docs`, old pass/status files and Git history are evidence/history only; they are not current technical authority.

Update the owning canonical system document whenever a durable contract changes. Do not create new `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, roadmap, milestone or implementation-log documents. Do not add new documentation under `/docs`. Chronology belongs in Git.

Legacy `/docs` and remaining pass/status files are migration-only inputs pending reference migration and deletion. Do not repair them in parallel with canonical docs.

## Engineering boundaries

Use implementation and tests, not old design prose, to determine runtime truth. Keep one canonical interactive Gemini path. Keep credentials behind their owning authority. UI must not own raw provider requests, OAuth internals, secrets or database implementation. Validate trust-boundary data. Preserve one authoritative state owner per domain rather than creating parallel stores.

Normal interactive Gemini is browser-direct through `src/gemini/provider.ts` and the local Lockbox. Google Workspace authorization is browser-side GIS through `src/google/oauth/`. Cloud Worker/autonomy execution is a separate runtime plane. VTT is an input modality and must not create a competing chat provider/persona. See `SYS-ARCH / documents/architecture.md` before changing those boundaries.

## Change discipline

Prefer narrow changes in the owning subsystem. Reuse existing schemas, repositories, registries and state machines before introducing another authority. Prefer exact symbols, paths, compact flows and invariants over repeated explanatory prose. When a task exposes stale documentation, fix the canonical document rather than adding a compensating note.

Direct commits to `main` are normal for this repository. Do not leave stale or superseded pull requests open.

## Verification

Run the smallest relevant checks while iterating and the applicable repository gates before declaring work complete. Main commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:workers`, `npm run build`, `npm run reliability:check`, `npm run e2e`. If the environment prevents a gate such as browser E2E, state that explicitly; never claim an unrun check passed.
