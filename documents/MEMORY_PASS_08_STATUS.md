# Memory Pass 8 — Long-Horizon Hardening

**Status:** implemented 2026-09-06

## What shipped

- Added `inspectMemoryStore()` as a read-only integrity scan over the canonical IndexedDB memory table.
- Health diagnostics report total, valid, invalid, and identifiable invalid record IDs without silently deleting or rewriting malformed data.
- Added focused integrity tests for healthy stores, malformed records with IDs, and malformed records without usable IDs.
- Added a 5,000-record retrieval stress test covering deterministic ranking, folder isolation, uniqueness, and hard item/character budgets.
- Reused the existing capability, deletion, permission, and observation/consolidation tests as the semantic safety boundary rather than creating parallel mutation APIs.

## Architectural boundary

Pass 8 does not introduce another database, export cache, repair cache, or retrieval implementation. Integrity inspection reads the same authoritative `memories` table and validates through the same canonical Zod schema used by the store.

Malformed data is surfaced rather than implicitly repaired because destructive recovery could erase user data or conceal the cause of corruption. An eventual migration/import tool can reuse this diagnostic and schema boundary with explicit user-controlled recovery semantics.

## Stress coverage

The retrieval engine is exercised against 5,000 deterministic candidates. The test verifies that the selector still respects folder scope, returns unique records, preserves relevant ordering, and never exceeds the configured 8-record / 6,000-character budget. It intentionally avoids a fragile wall-clock performance threshold so CI remains meaningful across machines.

## Existing safety coverage retained

Pass 4 capability tests continue to cover default model denial of `forget` and `delete`, while user deletion and archival remain explicit. Pass 3 observation/consolidation tests continue to cover support, conflict, and related evidence semantics, including the rule that conflict does not mutate established target prose or reinforcement.

## Deferred by design

No automatic destructive corruption repair was introduced. No import/export file format was introduced in this pass; provenance already reserves `import` and `migration` sources for a future explicit boundary.

## Completion criterion

Pass 8 is complete when durable-memory integrity can be inspected without destructive recovery, multi-thousand candidate sets have hard-budget stress coverage, and existing permission/deletion/conflict guarantees remain explicitly tested without introducing a second persistence authority.
