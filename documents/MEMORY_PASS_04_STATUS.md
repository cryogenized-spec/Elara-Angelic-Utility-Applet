# Memory Pass 4 — Permission Architecture

## Status

Implemented on 2026-09-06 as the centralized permission and forget/delete pass.

## What shipped

- Added `src/memory/permissions.ts` as the single granular authorization policy boundary.
- Added independent permissions for `save`, `observe`, `consolidate`, `forget`, and `delete` across `model`, `user`, and `system` actors.
- Default model policy permits explicit memory creation/observation/consolidation but denies model-initiated forget/delete.
- Updated the memory capability to authorize before `save`, `forget`, and `delete`.
- Updated observation consolidation to authorize before relationship mutation.
- Added first-class `memory.forget()` (archive) and `memory.delete()` (hard delete) operations.
- Added focused unit coverage for denied model deletion, user forget/delete, policy updates, and consolidation denial.
- Updated `docs/MEMORY_ARCHITECTURE.md` with the Pass 4 policy contract and completion criterion.
- Removed `documents/PWA_REPAIR.md` because its normalization work was confirmed resolved and the note no longer represents an active task.

## Semantics

`forget` archives a durable record so it remains retained but is excluded from retrieval. `delete` permanently removes the durable record. They are intentionally distinct capabilities.

Storage primitives remain below the capability boundary. Model-facing mutation is authorized before persistence, so a UI or prompt cannot bypass the policy by choosing a lower-level store call.

## Deliberate non-goals

This pass does not add automatic memory extraction, model-visible Gemini tool schemas, semantic retrieval, prompt-context injection, or a Memory Bank permissions UI. Those remain later architectural passes.

## Next pass

Pass 5 builds the canonical ranked retrieval engine and hard context budget over the same authoritative store.
