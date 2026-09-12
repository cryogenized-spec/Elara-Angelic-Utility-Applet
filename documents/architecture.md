---
id: SYS-ARCH
status: active
verified_commit: 5db7ccc8ea6276d41f20973f012c4c43b3e2ffdf
scope: repository-wide
keywords: [architecture, systems, boundaries, source-map, runtime, persistence]
---

# Elara architecture

This is the code-verified system map for Elara. It describes the repository as implemented at the verified commit above. Source and tests outrank prose if this file later drifts. Historical pass notes, roadmap prose, and implementation logs are not architectural authority.

## 1. Runtime spine

The browser entry point is `src/main.tsx`, which mounts `FolderProvider` and `App`. `src/app/App.tsx` is the current application composition root: it loads persisted state, coordinates conversations and attachments, resolves the character instruction, invokes Gemini, runs the tool loop, manages generation lifecycle, exposes Settings and quick actions, and starts local/cloud autonomy synchronization.

```text
React UI
  -> App orchestration
  -> conversation / artifact / preference repositories
  -> Gemini turn port
  -> Gemini Interactions stream
  -> optional tool calls
  -> validated application services
  -> normalized chat state
  -> IndexedDB persistence
```

The primary interactive Gemini path is browser-side `src/gemini/provider.ts` using `@google/genai` and the Gemini API key recovered from the local Lockbox. The Cloudflare Worker has a separate Gemini endpoint for cloud/autonomy use; it is not the interactive browser provider used by `App`.

## 2. System registry

| ID | System | Owns | Primary source | Durable state / external boundary |
| --- | --- | --- | --- | --- |
| `SYS-APP` | Application + UI | composition, screen state, generation orchestration, settings surfaces, quick actions | `src/app/`, `src/ui/`, `src/main.tsx` | delegates persistence/provider work |
| `SYS-CHAT` | Conversation | messages, threads, generation state, retries, turn lineage, title generation | `src/chat/`, `src/domain/chat.ts` | central Dexie database through `src/persistence/conversation.ts` |
| `SYS-GEM` | Gemini | request contract, model/settings gates, Interactions streaming, errors, memory projection, tool continuation | `src/gemini/` | Google Gemini Interactions API; Lockbox credential |
| `SYS-MEM` | Durable memory | memory schema, normalization, permissions, observations, ranking, retrieval, lifecycle, integrity inspection | `src/memory/`, `src/gemini/memory-context.ts` | `db.memories` in the central Dexie database |
| `SYS-ART` | Artifacts | attachments, generated/derived artifacts, validation, preprocessing, transformations, operation guards | `src/artifacts/`, `src/domain/artifact.ts` | artifact metadata/blobs in the central Dexie database; Gemini Files API when required |
| `SYS-DOC` | Local documents | validated document generation and PDF compilation | `src/documents/`, `src/ocr/` | browser workers; generated output enters `SYS-ART` |
| `SYS-CHAR` | Character + roleplay | master character instruction, profile, portrait data, roleplay preferences/world model | `src/character/`, `src/domain/character.ts`, roleplay persistence/components | local persistence; roleplay world has its own bounded Dexie store |
| `SYS-GAUTH` | Google authorization | capability-to-scope mapping, GIS token acquisition, account identity, authorization state, approved API hosts | `src/google/oauth/` | browser GIS; capability metadata in `localStorage`; access token in memory |
| `SYS-GWS` | Google Workspace | Calendar, Tasks, Gmail, Docs, Drive, Sheets service boundaries; tool validation/execution; confirmation | `src/google/{calendar,tasks,gmail,docs,drive,sheets,tools,confirmation}/` | Google REST APIs through `SYS-GAUTH` |
| `SYS-MEDIA` | Media / YouTube | search contract, quota budget, normalization, cache, result handoff | `src/media/`, `src/app/components/media/` | YouTube Data API; Lockbox secondary credential; dedicated media-cache Dexie DB |
| `SYS-AUTO` | Autonomy | routines, context projection, authority, scheduling contracts, local/cloud synchronization | `src/autonomy/`, `src/persistence/autonomy.ts`, `worker/src/autonomy/` | local Dexie + Cloudflare Durable Object/Workflow when paired |
| `SYS-SEC` | Lockbox + local secrets | Gemini primary credential, secondary credentials, PIN/passkey modes, encryption/rotation | `src/persistence/gemini-api-key.ts`, `src/persistence/gemini-passkey.ts` | IndexedDB/Dexie; secrets never belong in tool schemas |
| `SYS-PWA` | PWA + deployment | service-worker update lifecycle, installable shell, Pages build/deploy | `src/pwa.ts`, `vite.config.ts`, `.github/workflows/` | GitHub Pages deployment; browser service worker |
| `SYS-WORKER` | Cloud runtime | health, protected Gemini streaming endpoint, transcription, autonomy Durable Object/Workflow routes | `worker/src/` | Cloudflare Worker bindings and secrets |
| `SYS-REL` | Reliability | architecture invariants, lint/typecheck/tests/build/E2E gates | `scripts/reliability-gate.mjs`, test suites, `.github/workflows/ci.yml` | CI |

## 3. Dependency boundaries

UI components are presentation surfaces. They receive data and callbacks; provider credentials, Google OAuth mechanics, memory storage, and raw IndexedDB tables should remain outside presentation code. `App.tsx` currently coordinates these domains and is therefore the composition root, not a reusable domain service.

`SYS-GEM` may consume character instructions, bounded memory context, artifacts prepared for a turn, model settings, and model-visible tool declarations. It must not become the owner of Google service logic, artifact persistence, or memory persistence.

`SYS-GWS` separates model-visible declarations from execution. The tool registry assigns each operation a capability, risk class, exposure, and where necessary an execution plane. Service-specific schemas validate arguments before provider execution. Confirmation policy is a separate boundary for consequential operations.

`SYS-MEM` owns durable-memory semantics. Interactive Gemini receives a bounded projection through `src/gemini/memory-context.ts`; the canonical records remain in the memory store. At this verified commit there is no Gemini-visible `memory.*` tool in the live tool registry, so retrieval is operational while autonomous model mutation is not.

`SYS-ART` owns file identity and lifecycle. Gemini adapts ready artifacts to inline data or uploaded file references, but the provider does not become the artifact database.

`SYS-AUTO` is deliberately a separate execution mode. Cloud routine execution can use the Worker and its scheduler while normal chat remains local-first and browser-driven.

## 4. Persistence map

The main browser database is `ElaraDatabase` in `src/persistence/conversation.ts`. Its current schema includes messages, threads, Gemini settings, Workspace shortcuts, folders, folder assignments, durable memories, artifact metadata, and artifact blobs. This database is the authoritative store for those domains.

Not all browser state lives in that single database. The source currently contains bounded additional stores, including the media cache (`elara-media-cache`), autonomy persistence, roleplay-world persistence, and passkey credential persistence. Google authorization metadata is stored in `localStorage`, while its access token exists only in memory. Therefore old documentation that describes one literal IndexedDB database for every client-owned domain is too broad; the invariant is one authoritative store per domain, not one physical database for the whole application.

`localStorage` is also used for small coordination state such as the active conversation and Google authorization metadata. It is not the conversation or memory database.

## 5. Gemini execution planes

### 5.1 Interactive browser path

`App` -> `streamGoogleToolLoop()` -> `geminiTurnPort` -> `src/gemini/provider.ts` -> `GoogleGenAI.interactions.create()`.

The browser provider checks Lockbox state, reads the Gemini API key, composes thread-scoped memory context, adapts attachments, sends the Interactions request, normalizes streaming events, and returns explicit terminal states. Provider retries are intentionally bounded outside the SDK's automatic retry path.

### 5.2 Cloud Worker path

`worker/src/index.ts` exposes health, Gemini streaming, transcription, and autonomy routes. The Worker owns its `GEMINI_API_KEY` secret and filters model-visible declarations by execution plane. The Worker can surface tool calls but does not replace the browser application's service executors.

These two planes share contracts and declarations where useful but serve different runtime purposes. Documentation must not describe the Worker as the current interactive-chat credential authority.

## 6. Google boundary

The live Google authorization authority is browser-side. `src/google/oauth/authority.ts` acquires GIS access tokens, persists enabled capabilities/provider-scope evidence/account metadata, holds the access token only in memory, restricts requests to approved Google API hosts, and reauthorizes when the browser session can no longer silently recover access.

There is no durable server-side Google refresh-token authority in the current runtime. Documents that present such a server as implemented are historical or aspirational.

Workspace services are independent service boundaries behind the authorization authority. The current model-visible registry includes Calendar, Tasks, Gmail, Docs, Drive, Sheets, local PDF creation, roleplay-world operations, and YouTube search. The registry filename is Google-oriented for historical reasons but the registry now contains several application-local/non-Google tools; future documentation should describe it as the model tool surface rather than implying every entry is a Google Workspace API.

## 7. Media boundary

YouTube search is a browser-execution tool. Search results are normalized and cached locally; credentials never enter the media cache. Playback is not embedded in Elara: media cards resolve to external HTTPS destinations and hand them to the platform/browser. The application may express `watch` or `listen` intent, but does not claim that media is playing, queued, liked, or saved.

This system belongs under a general `media` document. YouTube is the current provider implementation, not the architectural name of the subsystem.

## 8. Documentation migration findings

The code audit identifies the following facts as migration anchors for the documentation rewrite:

1. The interactive Gemini path is browser-direct and Lockbox-backed; Worker-only credential narratives are stale for normal chat.
2. Google authorization is the browser GIS token-client design; a durable server refresh-token authority is not implemented.
3. Durable memory retrieval is live and thread/folder scoped, but no model-visible memory mutation tool is live on `main` at the verified commit.
4. Persistence is domain-authoritative but physically split across the central Elara database plus a small number of bounded subsystem stores.
5. The model tool registry now spans Google Workspace and non-Google/local capabilities, so documentation should separate the generic tool boundary from provider-specific services.
6. Media playback is an external handoff, not an embedded player.
7. `App.tsx` is currently the application composition root and contains substantial orchestration; documents should describe that reality rather than inventing a separate manager layer.
8. Historical pass/status documents are evidence only. Current contracts must be reconstructed from source, tests, and the consolidated system documents.

## 9. Documentation ownership target

This system map is the repository-level architecture reference. Detailed contracts should be moved into one document per bounded system under `/documents` and referenced by stable system ID: `SYS-UI`, `SYS-CHAT`, `SYS-GEM`, `SYS-MEM`, `SYS-ART`, `SYS-DOC`, `SYS-CHAR`, `SYS-GAUTH`, `SYS-GWS`, `SYS-MEDIA`, `SYS-AUTO`, `SYS-SEC`, `SYS-PWA`, and `SYS-REL`.

Do not create new `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, or implementation-log documents. Temporary work belongs in Git commits/PRs; durable facts belong in the owning system document.
