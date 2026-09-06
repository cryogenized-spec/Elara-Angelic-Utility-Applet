# Elara Memory Architecture

## Status

Canonical architecture contract for the eight-pass durable-memory implementation.

The archived `Elara-Companion-current` memory system is reference material only. This document defines the canonical design for Elara-Angelic and does not require migration of the archived architecture's modules or runtime contracts.

## Core invariant

The Memory Bank UI, Omnisearch, retrieval context, and future memory tools are projections over one authoritative durable memory store.

```text
                         ┌──────────────────────┐
                         │   Durable Memory     │
                         │      Store           │
                         │    AUTHORITATIVE     │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
      Memory Retrieval        Memory Bank UI        Omnisearch
              │                     │                     │
              ▼                     ▼                     ▼
     bounded Gemini context   human inspection       query interface
```

No second memory database, no UI-owned persistence, and no permanently duplicated prompt-context copy is permitted.

## Eight implementation passes

### Pass 0 — Clear the runway

Repair pre-existing CI failures, establish a green baseline, and record this architecture before changing the memory runtime.

### Pass 1 — Memory foundation

Establish the canonical rich memory document, identifiers, normalization, validation, provenance representation, and IndexedDB persistence boundary. This pass must not make memory retrieval or autonomous extraction a prerequisite for ordinary chat.

### Pass 2 — Deliberate memory capability

Expose an application-owned memory capability so Elara can explicitly request that a memory be stored. The model supplies meaningful prose; the application owns identity, timestamps, provenance, validation, permissions, and persistence.

### Pass 3 — Observation and consolidation

Introduce observations as lower-lifecycle evidence and explicit consolidation/promotion into established memories. Repeated evidence reinforces a memory; contradictions remain visible rather than being silently overwritten.

### Pass 4 — Permission architecture

Introduce granular memory permissions. Application policy is authoritative and is evaluated before every model-requested memory mutation. Forget/delete is a first-class operation.

### Pass 5 — Retrieval engine

Build one canonical ranked retrieval engine with explicit relevance signals and a hard context budget. Retrieval may consider lexical/semantic relevance, project relationship, recency, importance, confidence, reinforcement, lifecycle, memory kind, and explicit entity relationships.

### Pass 6 — Gemini integration

Compose a bounded temporary memory-context projection into the existing single Gemini interaction path. Memory failures remain non-fatal to the chat turn.

### Pass 7 — Memory Bank UI

Turn the existing memory settings surface into a human inspection interface over the same store: search, filters, collapsed records, one-record expansion, Markdown reading view, and direct navigation from search results.

### Pass 8 — Long-horizon hardening

Add migration/corruption recovery, large-dataset performance tests, deletion and permission verification, conflict handling, export/import considerations, and stress coverage at thousands of records.

## Canonical memory document

A durable memory is a structured document with prose as its primary payload.

Required fields:

- `id`
- `kind`
- `title`
- `body`
- `createdAt`
- `updatedAt`
- `observedAt`
- `confidence`
- `importance`
- `lifecycle`
- `source`
- `tags`
- `relatedMemoryIds`
- `supportingMemoryIds`
- `conflictingMemoryIds`
- `supersedes`
- `supersededBy`
- `reinforcementCount`

`body` is UTF-8 text and may contain Markdown. Presentation is a later concern and must not alter stored text.

Folder/project scope remains an application concern and may be represented alongside the document when the current conversation/folder architecture requires it.

## Provenance

Provenance is structured metadata, not a free-form note. It must be able to distinguish at least:

- `user` — explicitly created or edited by the user;
- `elara` — explicitly proposed by Elara through a future memory capability;
- `import` — introduced through a future import operation;
- `migration` — transformed from an older Elara memory representation.

Future passes may add conversation, message, or source references without changing the fundamental contract.

## Boundary rules

The memory store owns durable records and record invariants. The retrieval engine owns ranking and context budgeting. The Memory Bank owns presentation. Omnisearch owns query UX. Gemini integration owns temporary context composition. Memory tools are capability adapters. None of these surfaces may become an alternate persistence authority.

Ordinary conversation history is not automatically converted into permanent memory. Autonomous extraction and consolidation are explicitly deferred until their dedicated passes.

Memory persistence is best-effort from the chat path: a storage failure must never prevent an otherwise valid conversational response from being presented.

## Pass 1 completion criterion

Pass 1 is complete when the canonical rich memory schema, validation/normalization, deterministic identifiers, structured provenance, and Dexie-backed store are independently testable and existing application callers remain operational without introducing a second memory database.
