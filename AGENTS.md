# Agent instructions — Elara Angelic

This repository is maintained for repeated AI-assisted development. Minimize archaeology: load only the context needed for the subsystem you are changing.

## Documentation routing

1. Read `documents/manifest.json`.
2. Load the canonical document for the system you are changing; every registered system is active under `/documents`.
3. Treat authority as: source/tests → canonical `/documents` → legacy `/docs` → Git history.
4. Update the owning canonical system document whenever a durable contract changes.

Do not create new `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, roadmap, milestone or implementation-log documents. Do not add new documentation under `/docs`. Chronology belongs in Git; current technical truth belongs in the owning `/documents/<system>.md` file.

Legacy `/docs` and the remaining old pass/status files are temporary Phase 5 migration inputs, not architectural authority. Do not repair them in parallel with canonical docs unless the task is explicitly the migration/deletion pass.

## Engineering boundaries

Use the current implementation, not old design prose, to determine runtime truth. Keep one canonical interactive Gemini path. Keep credentials behind their owning authority. UI must not own raw provider requests, OAuth internals, secrets or database implementation. Validate external/trust-boundary data. Preserve one authoritative state owner per domain rather than creating parallel stores.

Normal interactive Gemini is browser-direct through `src/gemini/provider.ts` and the local Lockbox. Google Workspace authorization is browser-side GIS through `src/google/oauth/`. Cloud Worker/autonomy execution is a separate runtime plane. VTT is an input modality and must not create a competing chat provider/persona. See `SYS-ARCH / documents/architecture.md` before changing those boundaries.

## Change discipline

Prefer narrow changes in the owning subsystem. Reuse existing schemas, repositories, registries and state machines before introducing another authority. When a task exposes stale documentation, fix the canonical document rather than adding a compensating note.

Direct commits to `main` are normal for this repository. Do not leave stale or superseded pull requests open.

## Verification

Run the smallest relevant checks while iterating and the applicable repository gates before declaring work complete. The main commands are `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:workers`, `npm run build`, `npm run reliability:check`, and `npm run e2e`. If an environment prevents a gate such as browser E2E, state that explicitly; never claim an unrun check passed.
