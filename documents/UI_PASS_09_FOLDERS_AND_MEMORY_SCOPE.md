# UI Pass 9 — Mobile-first folders and scoped memory boundary

## Scope

This pass adds a mobile-first folder tree for conversation threads without changing the provider or conversation ownership model.

Folders support:

- root folders;
- nested subfolders;
- GitHub/Obsidian-style slash paths such as `Projects/Elara/UI` when creating a folder path;
- moving a folder to another parent while preventing cycles;
- moving a thread into or out of a folder;
- renaming folders;
- deleting a folder while promoting its direct child folders and moving directly assigned threads to the deleted folder's parent;
- a per-folder `Folder only` / `Global` memory-scope setting.

## Context-window semantics

A folder does **not** create a separate Gemini model context window. Context capacity remains a property of the selected model and the current provider interaction/thread.

Conversation history remains thread-scoped. The Gemini provider already carries continuity through the thread's `previous_interaction_id`, so selecting or moving a thread between folders does not splice two conversations together.

The folder memory setting is a boundary for future durable-memory retrieval:

- `Folder only`: retrieve durable notes belonging to the active folder/project scope only.
- `Global`: permit the normal global durable-memory pool in addition to the active folder scope.

This distinction deliberately keeps folder organization separate from model context management. Folder scoping can reduce the amount of application-supplied memory context entering a request, but it does not increase the model's context window or allocate one window per folder.

## Current implementation status

The folder model and UI boundary are implemented locally. The durable-memory retrieval subsystem itself remains a separate future domain in the architecture. Until that retriever exists, the folder scope value is stored as forward-compatible configuration and does not by itself inject memory into Gemini requests.

## Mobile interaction

Folder actions remain touch-friendly and live inside the existing glass sidebar. Creation uses a compact inline form, nested folders are rendered as an expandable tree, and move/scope actions are exposed from each folder's local action menu rather than through desktop-only drag-and-drop.
