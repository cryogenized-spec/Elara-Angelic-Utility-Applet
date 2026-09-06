# Memory Pass 2 — Deliberate Capability

## Status

Implemented on 2026-09-06 as the second canonical memory pass.

## What shipped

- Added `src/memory/capability.ts` as the application-owned deliberate memory capability.
- Exposed a single model-facing write operation: `memory.save(...)`.
- Kept the capability intentionally narrow: the request supplies durable-memory prose plus lightweight classification (`kind` and `tags`).
- Kept application context separate from model content: conversation/message provenance and folder scope are application-owned context.
- The capability forces provenance to `elara`; callers cannot select `user`, `import`, or `migration` provenance through this surface.
- Durable identity, creation/update timestamps, normalization, schema validation, and IndexedDB persistence remain owned by the canonical memory store.
- Migrated Gemini memory context and Memory Bank UI to import from `src/memory/` directly.
- Moved the durable-memory unit coverage to the canonical store boundary and added capability-specific boundary tests.
- Retired `src/persistence/memory.ts` and its obsolete test façade.
- Removed the expired `tmp/last.txt` and `tmp/placeholder-remove-me` temporary artifacts.

## Deliberate non-goals

This pass does not yet connect `memory.save` to Gemini tool declarations/execution, introduce autonomous extraction, add permission policy, change retrieval ranking, or consolidate memories automatically.

## Capability contract

The intended future model action is explicit and deliberate: request that a specific memory be saved. The application then validates and persists it through the canonical store. A future tool adapter may translate a Gemini tool call into this capability without exposing Dexie or persistence internals to the model.

## Next pass

Pass 3 introduces observations and explicit consolidation/promotion, with repeated evidence and contradictions represented as durable relationships rather than silent overwrites.
