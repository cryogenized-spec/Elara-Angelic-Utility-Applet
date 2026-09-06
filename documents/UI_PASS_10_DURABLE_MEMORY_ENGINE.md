# UI Pass 10 — Durable memory engine

## Scope

This pass introduces the first real durable-memory domain. It is separate from ordinary conversation history and does not change the Gemini provider request path yet.

Each durable memory records:

- kind: `CORE`, `CONTEXTUAL`, `EPISODIC`, or `MICRO_OBSERVATION`;
- lifecycle: `active`, `dormant`, or `archived`;
- content with a bounded length;
- folder scope (`folderId`) or global scope (`null`);
- confidence and importance scores;
- creation/update/expiry timestamps;
- recall timestamp and recall count;
- reinforcement count;
- bounded tags and provenance.

## Retrieval contract

Retrieval is intentionally bounded before integration with Gemini. The engine filters archived and expired memories, enforces folder isolation, optionally admits global memories, scores candidates using lexical relevance plus importance/confidence/recency, and caps both item count and total characters.

`Folder only` means an active folder can retrieve memories assigned to that exact folder scope. It cannot retrieve memories belonging to another folder. `Global` additionally admits memories whose `folderId` is `null`.

No model context window is created here. Retrieved memories will later become a bounded application-supplied context block inside the existing single Gemini interaction path.

## Mutation contract

The domain supports creation, editing, deletion, archival, reinforcement, listing, and retrieval. Retrieval updates recall bookkeeping without mutating the memory content itself.

This pass deliberately does not implement autonomous memory extraction from arbitrary chat text. Promotion rules and provider integration belong to the subsequent integration pass so that durable memory cannot silently become an uncontrolled second prompt layer.

## Persistence

Durable memories use the existing Dexie/IndexedDB database as the sole persistence authority. Database version 6 adds the `memories` table; no parallel storage mechanism is introduced.
