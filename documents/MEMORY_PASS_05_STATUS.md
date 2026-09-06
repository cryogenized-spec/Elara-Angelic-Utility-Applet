# Memory Pass 5 — Retrieval Engine

## Status

Implemented on 2026-09-06 as the canonical ranked retrieval pass.

## What shipped

- Added `src/memory/retrieval.ts` as the pure retrieval boundary.
- Moved candidate filtering, ranking, lifecycle/expiry checks, folder scope, global-memory policy, and context budgeting out of the durable store.
- Retrieval scoring now combines lexical relevance, importance, confidence, reinforcement, recency, lifecycle, memory kind, and relationship density as bounded signals.
- Retrieval has hard caps of 20 records and 20,000 payload characters, with defaults of 8 records and 6,000 payload characters.
- Character budgeting accounts for both memory title and body, not body alone.
- `src/memory/store.ts` now owns persistence and recall bookkeeping while delegating selection to the retrieval engine.
- Added focused pure tests for relevance ordering, secondary scoring signals, hard budgets, expiry/lifecycle filtering, and folder/global scope.

## Deliberate non-goals

This pass does not add embeddings, model-generated semantic vectors, autonomous memory extraction, Gemini-visible memory tools, Memory Bank UI, or provider-specific retrieval behavior.

## Next pass

Pass 6 composes the bounded retrieval projection into the existing single Gemini interaction path while preserving non-fatal memory failure behavior.
