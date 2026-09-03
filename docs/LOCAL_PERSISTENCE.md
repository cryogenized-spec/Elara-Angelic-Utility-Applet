# Prompt 11 — Local Persistence

## Status

Accepted.

Dexie over IndexedDB is the one authoritative browser persistence layer for client-owned state. Other modules use focused repository operations and do not open their own databases or maintain a second conversation store in localStorage.

## Domain ownership

The single database may contain separate logical tables for conversations, messages/parts, preferences, appearance, attachment metadata, diagnostics metadata where appropriate, and future memory notes. Separate tables do not create separate persistence authorities.

## Transaction rules

Related state changes are committed transactionally where correctness requires it. User messages are committed before provider execution. Assistant generation records can be created as pending/streaming and finalized on completion, cancellation, timeout, or failure.

## Streaming recovery

Persist only application state and the minimal provider continuity metadata needed for recovery: interaction identifiers, request identifiers, safe stream cursor information, and lifecycle state. Do not store raw SDK event streams wholesale.

## Versioning and migrations

The database has explicit schema versions. Every schema change is a migration with deterministic behavior. Migration failures are surfaced to a recovery boundary; they must not silently produce an empty application.

## Corruption handling

Malformed individual records may be quarantined while valid data remains available. Recovery must be observable through diagnostics and must never overwrite good records with a blank database.

## Memory/notes

Future notable-event notes use a separate domain/table lifecycle. Notes can later be retrieved as bounded context for a new Gemini request. They are not automatically copied into every conversation or merged into the chat manager.

## Tool/Workspace data

Tool declarations are configuration, not conversation data. Tool calls/results can be stored as typed message parts. Google Workspace service state remains under the Google boundary and is not owned by persistence.

## Forbidden patterns

No second IndexedDB database for a feature, no hidden localStorage chat cache used as source of truth, no repository that directly calls Gemini, and no persistence module that owns UI state, OAuth, or tool execution.
