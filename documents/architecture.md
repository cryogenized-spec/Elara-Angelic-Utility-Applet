---
id: SYS-ARCH
status: active
verified_commit: c9650583b813b6914d8f3f11161e646215330421
scope: repository-wide
paths: [src, worker/src]
keywords: [architecture, systems, boundaries, source-map, runtime, persistence]
---

# Elara architecture

This is the code-verified repository map. Source and tests outrank prose if documentation later drifts. Superseded implementation narratives belong to Git history rather than a parallel documentation tree.

## 1. Runtime spine

`src/main.tsx` mounts the React application; `src/app/App.tsx` is the current composition root. Normal conversation execution is browser-first:

```text
React UI
-> App orchestration
-> chat/artifact/preference repositories
-> Gemini turn port + tool loop
-> Gemini Interactions API
-> validated application/Google tools when requested
-> normalized chat state
-> browser persistence
```

Interactive Gemini is direct from `src/gemini/provider.ts` using the local Lockbox credential. The Cloudflare Worker is a separate cloud/autonomy execution plane, not the browser chat provider. Google Workspace authorization is separately browser-side GIS.

## 2. System registry

| ID | System | Owns | Primary source |
| --- | --- | --- | --- |
| `SYS-UI` | UI | composition, shell/layout, Settings, composer, presentation | `src/app/`, `src/ui/` |
| `SYS-CHAT` | Chat | messages/threads, generation state, lineage, recovery | `src/chat/`, `src/domain/chat.ts` |
| `SYS-GEM` | Gemini | Interactions requests/streaming, models/settings, errors, tool continuation | `src/gemini/` |
| `SYS-VTT` | Voice-to-text | recording, transcription, draft transformation/insertion | `src/vtt/` |
| `SYS-MEM` | Memory | durable-memory schema, lifecycle, ranking/retrieval, integrity | `src/memory/` |
| `SYS-ART` | Artifacts | attachments/generated/derived files, blobs, validation/transforms | `src/artifacts/` |
| `SYS-DOC` | Documents | local PDF compilation and OCR | `src/documents/`, `src/ocr/` |
| `SYS-CHAR` | Character | Character Master, profile/portrait, roleplay/world state | `src/character/`, roleplay domain/persistence |
| `SYS-GAUTH` | Google auth | GIS, capabilities/scopes, token/account state | `src/google/oauth/` |
| `SYS-GWS` | Workspace/tools | Google services, executable registry, confirmations | `src/google/` excluding OAuth |
| `SYS-MEDIA` | Media | YouTube search, cache/budget, normalized handoff | `src/media/` |
| `SYS-AUTO` | Autonomy | routines, schedules, authority/context, cloud sync | `src/autonomy/`, `worker/src/autonomy/` |
| `SYS-SEC` | Lockbox | browser API credentials, encryption/unlock session | Lockbox modules under `src/persistence/` |
| `SYS-PERSIST` | Persistence | Dexie/local state authorities and migrations | `src/persistence/` plus bounded stores |
| `SYS-PWA` | PWA | service-worker lifecycle and Pages deployment | `src/pwa.ts`, Vite/workflows |
| `SYS-WORKER` | Cloud Worker | protected cloud routes, Worker Gemini/autonomy runtime | `worker/src/` |
| `SYS-REL` | Reliability | CI, tests, invariant checks, safe diagnostics | `scripts/`, `.github/workflows/ci.yml`, `e2e/` |
| `SYS-LEGAL` | Third-party | dependency/runtime-asset notices and release obligations | lockfile + asset notices |

Detailed current contracts live in the matching `/documents/<system>.md` file and are routed by `manifest.json`.

## 3. Dependency boundaries

UI is presentation. It may invoke typed application callbacks but must not own raw provider requests, OAuth mechanics, secret storage or raw database tables. `App.tsx` composes systems; its size does not make it a domain authority.

`SYS-GEM` may consume the Character Master, bounded memory context, prepared artifact IDs/settings and model-visible tool declarations. It does not own Google service logic, artifact persistence or memory persistence.

`SYS-GWS` separates model declaration from execution. The registry assigns capability/risk/exposure/execution plane; service schemas validate arguments; mutation confirmation is a separate consent boundary. The model proposes intent; application code validates and admits authority.

Autonomy/retrieval trust follows this precedence:

```text
system policy
> user routine
> user-authorized context
> external data
```

Retrieved/external content is evidence, never authority. It cannot grant tools, widen permissions or override system/application policy.

`SYS-MEM` owns durable semantics. Normal Gemini receives a bounded contextual projection; records remain in the memory store. No live Gemini-visible `memory.*` mutation tool exists at this verified commit.

`SYS-VTT` is an input modality. Direct transcription and optional transformation do not establish a second chat provider/persona; transformed text returns to the composer for user review.

`SYS-AUTO` is a separate execution mode. Cloud routines may execute through the Worker while normal chat stays browser-driven.

User-intent provenance is also a boundary: app-authored UI guidance must not masquerade as user-authored chat input. The current Workspace shortcut path in `App.tsx` is a known exception documented in `SYS-CHAT`; remove that exception rather than generalizing it.

## 4. Persistence map

The central `ElaraDatabase` in `src/persistence/conversation.ts` currently contains messages, threads, Gemini settings, Workspace shortcuts, folders/assignments, durable memories and artifact metadata/blobs. Other bounded stores intentionally exist, including Lockbox, media cache, autonomy and roleplay-world persistence. Google access tokens are memory-only while small authorization metadata may use localStorage.

Therefore the invariant is **one authoritative store per domain**, not one physical IndexedDB database for every browser feature.

## 5. Execution planes

### 5.1 Interactive Gemini

`App -> streamGoogleToolLoop() -> geminiTurnPort -> src/gemini/provider.ts -> GoogleGenAI.interactions.create()`.

The provider obtains the Lockbox key, composes thread memory unless disabled by the caller, resolves artifact inputs, streams normalized events and supports grouped tool-result continuation.

### 5.2 VTT

Microphone capture is browser-local. Transcription currently calls Gemini directly using the Lockbox key and a transcription model; polish/roleplay draft transformation goes through the canonical Gemini turn port. Neither path bypasses the user's final Send action.

### 5.3 Cloud Worker/autonomy

`worker/src/index.ts` exposes protected cloud/health/transcription/Gemini/autonomy boundaries using Worker-side secrets. Worker tool exposure is execution-plane filtered. This plane does not replace browser Google OAuth or interactive chat.

## 6. Google and model tool boundary

Live Google authorization is browser GIS. The current product decision is self-contained browser authorization: no external Google-auth server, durable browser refresh-token store or second authorization Worker is part of the active architecture. `src/google/oauth/code-flow.ts` is an unreferenced/tested foundation, not a live execution boundary.

Workspace adapters cover Calendar, Tasks, Gmail, Docs, Drive and Sheets; Google Chat adapter/scope foundations exist but model exposure remains deferred/internal.

The generic model tool registry also carries application-local tools (`document.create_pdf`, roleplay world operations) and browser-only `youtube.search`. Treat it as the executable model capability surface, not as proof that every tool is a Google API.

## 7. Media, character and memory context

YouTube search returns structured media and hands playback to an external HTTPS/platform destination; Elara does not embed playback in the current architecture.

The Character Master is user-owned and ships empty by default. Durable memory is separate from conversation history and appended as bounded contextual notes, never as a competing instruction. Roleplay World Canvas is persistent setting data with confirmation-gated mutations, not personal memory.

## 8. Documentation ownership

`/documents` is the canonical technical-documentation root. Filenames/system IDs are stable routing keys; chapter numbers are local navigation. Do not create `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, roadmap or implementation-log files. Git owns chronology.

The legacy `/docs` tree and pass/status migration files were removed after canonical extraction and reference migration. `public/core/README.md` remains intentionally outside `/documents` as an operational BusyTeX asset note.
