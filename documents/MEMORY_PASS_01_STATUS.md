# Memory Pass 1 — Foundation

## Status

Implemented on 2026-09-06 as the first canonical memory-foundation pass.

## What shipped

- Added `docs/MEMORY_ARCHITECTURE.md` as the canonical eight-pass memory contract.
- Added the `src/memory/` boundary with dedicated types, IDs, normalization, provenance helpers, runtime schemas, and Dexie-backed store operations.
- Promoted the memory record from a small `content` note into a rich document with `title`, Markdown-capable `body`, observation time, structured provenance, relationship references, supersession references, reinforcement bookkeeping, lifecycle, confidence, importance, and existing folder scope.
- Kept IndexedDB/Dexie as the sole persistence authority.
- Kept the temporary persistence façade only while application callers were being migrated to the canonical boundary.
- Expanded unit coverage around schema shape, normalization, relationships, provenance, mutation lifecycle, and folder isolation.

## Deliberate non-goals

This pass did not add autonomous memory extraction, permission policy, new retrieval algorithms, Gemini context injection, or a Memory Bank redesign.

## Superseded implementation seams

The temporary `src/persistence/memory.ts` façade and its companion test were retired during Memory Pass 2 after remaining consumers moved to `src/memory/`.

The older `documents/UI_PASS_10_DURABLE_MEMORY_ENGINE.md` remains historical implementation notes; the canonical memory contract is now `docs/MEMORY_ARCHITECTURE.md` plus the active pass status documents.

## Next pass

Pass 2 introduces an application-owned memory capability so Elara can explicitly request deliberate memory creation without receiving persistence internals or bypassing application validation.
