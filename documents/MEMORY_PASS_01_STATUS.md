# Memory Pass 1 — Foundation

## Status

Implemented on 2026-09-06 as the first canonical memory-foundation pass.

## What shipped

- Added `docs/MEMORY_ARCHITECTURE.md` as the canonical eight-pass memory contract.
- Added the `src/memory/` boundary with dedicated types, IDs, normalization, provenance helpers, runtime schemas, and Dexie-backed store operations.
- Promoted the memory record from a small `content` note into a rich document with `title`, Markdown-capable `body`, observation time, structured provenance, relationship references, supersession references, reinforcement bookkeeping, lifecycle, confidence, importance, and existing folder scope.
- Kept IndexedDB/Dexie as the sole persistence authority.
- Kept `src/persistence/memory.ts` as a compatibility façade so existing application callers do not become a second persistence path.
- Expanded unit coverage around schema shape, normalization, relationships, provenance, mutation lifecycle, and folder isolation.

## Deliberate non-goals

This pass does not add new autonomous memory extraction, permission policy, retrieval algorithms, Gemini context injection, or Memory Bank redesign. Existing retrieval behavior remains available for compatibility but is not expanded by this pass.

## Next pass

Pass 2 introduces an application-owned memory capability so Elara can explicitly request deliberate memory creation without receiving persistence internals or bypassing application validation.
