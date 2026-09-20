---
id: SYS-PERSIST
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: browser persistence authorities and migrations
paths: [src/persistence]
keywords: [dexie, indexeddb, persistence, migration, repository, localstorage]
---

# Persistence

## 1. Purpose and boundary

`SYS-PERSIST` defines how browser-owned durable state is stored and migrated. The invariant is **one authoritative store per domain**, not one physical database for the entire application. Domain modules expose focused repository operations; persistence does not own provider calls, OAuth policy or presentation state.

## 2. Runtime architecture

The main Dexie database is `elara-angelic-utility-applet`. Its current schema version is 8 and contains conversations plus several central domains. Other bounded systems use dedicated stores where isolation is intentional, including Lockbox, media cache, autonomy and roleplay-world persistence. Google OAuth access tokens remain memory-only; small authorization metadata may use localStorage.

```text
domain operation
-> repository/normalizer
-> authoritative table/store
-> deterministic migration/versioning
```

## 3. Source map

| Concern | Authority |
| --- | --- |
| Central DB + conversations/settings | `src/persistence/conversation.ts` |
| Folders | `src/persistence/folders.ts` |
| Character/preferences | matching `src/persistence/*.ts` modules |
| Lockbox | `gemini-api-key.ts`, `gemini-passkey.ts` |
| Autonomy | `src/persistence/autonomy.ts` |
| Roleplay world | `src/persistence/roleplay-world.ts` |
| Media cache | `src/media/cache.ts` |
| Generation Activity font subset cache | `src/ui/noto-emoji.ts` |

## 4. Data and contracts

Central `ElaraDatabase` tables are: `messages`, `threads`, `settings`, `workspaceShortcuts`, `folders`, `folderAssignments`, `memories`, `artifactMetadata`, `artifactBlobs`. Schema migrations evolved these tables from v1 through v8; v8 adds the indexed `autonomyContext` memory consent field. A legacy folder localStorage cache is migrated into tables and removed only after successful parsing/write.

Related correctness-sensitive writes use Dexie transactions, for example message/thread updates and artifact association/storage. Persisted Gemini settings are per-model and normalized through the model settings engine.

Chat Appearance preferences remain authoritative for Generation Activity glyph selection. The selected twelve Unicode graphemes live in the existing `elara-preferences` / `chat-appearance` record and are normalized on every load/save, so no schema bump is required for older rows. Noto Emoji WOFF2 bytes live separately in CacheStorage as disposable derived data keyed by the final glyph subset. Preview never writes that cache; only the Settings-exit commit may replace the committed subset. A missing/corrupt cache is recoverable from preferences and must not change the selected glyph values.

Companion memory behavior uses the same `elara-preferences` authority under record id `memory-behavior`. It stores only policy/preferences (master state, remembering/recall style, and automatic-memory category choices); canonical memories remain exclusively in `db.memories`. Missing or older partial preference shapes are normalized field-by-field, with sensitive automatic-memory categories falling back to disabled. Adding this record requires no Dexie schema bump because the existing keyed preference table already admits new ids.

## 5. Invariants

- Each domain has one state authority; no shadow localStorage/IndexedDB copy may compete with it.
- Schema changes use explicit deterministic version migrations.
- Binary artifacts are hydrated at the repository boundary and corruption is surfaced, not silently replaced.
- localStorage is for small coordination/metadata where explicitly owned; it is not the conversation or memory database.
- Persistence modules do not call Gemini or Google APIs.
- A physical extra database is acceptable only when it is the deliberate authoritative store for a bounded subsystem.

## 6. Security and failure semantics

Credentials have their own encrypted Lockbox store and must not leak into ordinary persistence. Malformed legacy data should not block unrelated valid data where a migration can safely ignore/quarantine it. Migration/storage failures must be diagnosable; never respond by silently resetting healthy application data.

## 7. Verification and tests

Use `src/persistence/*.test.ts`, fake-indexeddb-backed domain tests, artifact repository tests and subsystem store tests. Any central DB version bump requires migration coverage from existing versions and should be exercised by the full unit/build gate.

## 8. Known gaps

Some older documentation claimed one literal IndexedDB database for all client state; that is no longer accurate. Preserve domain authority rather than forcing physically unrelated stores into the central DB merely for uniformity.
