# UI Pass 9 — Mobile-first folders and scoped memory boundary

## Scope

This pass adds a mobile-first folder tree for conversation threads without changing the provider or conversation ownership model.

Folders support:

- root folders;
- nested subfolders;
- GitHub/Obsidian-style slash paths such as `Projects/Elara/UI` when creating a folder path;
- moving a folder to another parent while preventing cycles and duplicate sibling names;
- moving a thread into or out of a folder;
- renaming folders;
- deleting a folder while promoting its direct child folders and moving directly assigned threads to the deleted folder's parent;
- a per-folder `Folder only` / `Global` memory-scope setting.

## Persistence

Folders and thread-folder assignments are persisted in the application's canonical Dexie/IndexedDB database alongside conversations, settings, workspace shortcuts, and durable memories. A database v5 migration imports the previous localStorage folder cache once and removes that retired cache after a successful import. No second folder persistence authority is introduced.

The onboarding completion marker is intentionally different: it is a small localStorage browser-lifecycle flag, with backwards-compatible fallback to the existing preferences record. This keeps first-run state out of the durable content model.

## Context-window semantics

A folder does **not** create a separate Gemini model context window. Context capacity remains a property of the selected model and the current provider interaction/thread.

Conversation history remains thread-scoped. The Gemini provider carries continuity through the thread's `previous_interaction_id`, so selecting or moving a thread between folders does not splice two conversations together.

The folder memory setting is a boundary for durable-memory retrieval:

- `Folder only`: retrieve memories assigned to the active folder and its parent folders, while excluding the global pool and unrelated sibling folders.
- `Global`: retrieve the active folder hierarchy and also admit memories whose `folderId` is `null`.
- An unfiled thread may retrieve global memories, but never a folder-scoped memory.

Retrieved memories remain bounded before entering the existing single Gemini interaction: the resolver caps retrieval at 8 memories and 6,000 characters, while the memory engine independently enforces its own safety bounds.

## Durable-memory boundary

Durable memory is separate from both ordinary conversation history and Elara's Master Prompt. Records are typed, scoped, lifecycle-aware, timestamped, tagged, and attributed to provenance. The application supports explicit creation, editing, deletion, archival, reinforcement, promotion, and bounded retrieval.

The application does **not** silently extract arbitrary chat text into memory. Memory remains explicit and user-owned; the provider receives retrieved memories as application context labelled as contextual notes rather than instructions.

## Current implementation status

The folder model, durable persistence boundary, UI tree, mutation guards, durable-memory engine, folder hierarchy retrieval, Gemini request integration, and regression coverage are implemented. Remaining work is product polish and final release/reliability verification rather than foundational folder architecture.

## Mobile interaction

Folder actions remain touch-friendly and live inside the existing glass sidebar. Creation uses a compact inline form, nested folders are rendered as an expandable tree, and move/scope actions are exposed from each folder's local action menu rather than through desktop-only drag-and-drop. Durable-memory controls are also exposed in Character settings with a mobile-safe editing layout.
