---
id: SYS-ARCH
status: active
verified_commit: 3ca672db8efe8710bba0bc83d536583c577a9e0e
scope: repository-wide
paths: [src, worker/src]
keywords: [architecture, systems, boundaries, source-map, runtime, persistence]
---

# Elara architecture

This is the code-verified repository map. Source and tests outrank prose if documentation later drifts. Superseded implementation narratives belong to Git history rather than a parallel documentation tree.

Elara is distributed as self-hosted shareware. The static PWA, provider credentials and optional Worker belong to the person deploying the fork; there is no shared Elara account or central OAuth service.

## 1. Runtime spine

`src/main.tsx` mounts the React application; `src/app/App.tsx` is the composition root. Normal conversation execution remains browser-first:

```text
React UI
-> App orchestration
-> chat/artifact/preference repositories
-> Gemini turn port + tool loop
-> Gemini Interactions API
-> validated application/provider tools when requested
-> normalized chat state
-> browser persistence
```

Interactive Gemini is direct from `src/gemini/provider.ts` using the local Lockbox credential. The Cloudflare Worker is a separate cloud/autonomy execution plane, not the browser chat provider. Google authorization is owned by `SYS-GAUTH`: unpaired installs use interactive GIS token acquisition; paired self-hosted installs use GIS popup code flow plus their own encrypted Worker vault for durable refresh authority.

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
| `SYS-GAUTH` | Google auth | GIS, capabilities/scopes, browser token state, durable refresh brokerage | `src/google/oauth/`, Worker OAuth boundary |
| `SYS-GWS` | Workspace/tools | Google services, executable registry, confirmations, human task workspace/cache | `src/google/` excluding OAuth, `src/kanban/` |
| `SYS-CLICKUP` | ClickUp | first-party ClickUp semantic schemas, encrypted OAuth/REST authority and normalized task operations | `src/clickup/`, `worker/src/clickup/` |
| `SYS-MEDIA` | Media | YouTube search, cache/budget, normalized handoff | `src/media/` |
| `SYS-AUTO` | Autonomy | routines, schedules, authority/context, cloud sync | `src/autonomy/`, `worker/src/autonomy/` |
| `SYS-SEC` | Security | browser credentials, encryption/unlock session, capability gates | security modules + gates |
| `SYS-PERSIST` | Persistence | Dexie/local state authorities and migrations | `src/persistence/` plus bounded stores |
| `SYS-PWA` | PWA | service-worker lifecycle and Pages deployment | `src/pwa.ts`, Vite/workflows |
| `SYS-WORKER` | Cloud Worker | protected cloud routes, Worker Gemini/autonomy, Google OAuth vault runtime | `worker/src/` |
| `SYS-REL` | Reliability | CI, tests, invariant checks, safe diagnostics | `scripts/`, `.github/workflows/ci.yml`, `e2e/` |
| `SYS-LEGAL` | Third-party | dependency/runtime-asset notices and release obligations | lockfile + asset notices |

Detailed current contracts live in the matching `/documents/<system>.md` file and are routed by `manifest.json`.

## 3. Dependency boundaries

UI is presentation. It may invoke typed application callbacks but must not own raw provider requests, OAuth mechanics, secret storage or raw database tables. `App.tsx` composes systems; its size does not make it a domain authority.

`SYS-GEM` may consume the Character Master, bounded memory context, prepared artifact IDs/settings and model-visible tool declarations. It does not own Google service logic, artifact persistence, memory persistence or OAuth secrets.

`SYS-GWS` separates model declaration from execution. The registry assigns capability/risk/exposure/execution plane; service schemas validate arguments; mutation confirmation is a separate consent boundary. The model proposes intent; application code validates and admits authority. `SYS-CLICKUP` consumes this same executable registry and confirmation authority; its MCP/REST layer is a provider transport, not a second model-tool authority.

`SYS-GAUTH` separates provider permission from application permission. A provider scope can satisfy an enabled capability but cannot manufacture a write/send capability. The durable vault stores refresh authority; it does not grant autonomous execution authority.

Autonomy/retrieval trust follows this precedence:

```text
system policy
> user routine
> user-authorized context
> external data
```

Retrieved/external content is evidence, never authority. It cannot grant tools, widen permissions or override system/application policy.

`SYS-MEM` owns durable semantics. Normal Gemini receives a bounded contextual projection; records remain in the memory store.

`SYS-VTT` is an input modality. Direct transcription and optional transformation do not establish a second chat provider/persona; transformed text returns to the composer for user review.

`SYS-AUTO` is a separate execution mode. Cloud routines may execute through the Worker while normal chat stays browser-driven. The Google OAuth vault shares the user's self-hosted Worker infrastructure but is not stored in or controlled by the autonomy database.

User-intent provenance remains a boundary: app-authored UI guidance must not masquerade as user-authored chat input.

## 4. Persistence map

The central `ElaraDatabase` contains messages, threads, Gemini settings, Workspace shortcuts, folders/assignments, durable memories and artifact metadata/blobs. Other bounded stores intentionally exist, including Lockbox, media cache, autonomy and roleplay-world persistence.

Google access tokens are browser-memory-only. Small non-secret authorization metadata may persist in localStorage. In paired durable mode, Google refresh tokens persist only as AES-GCM ciphertext inside the user's `GoogleOAuthVault` Durable Object; they never enter browser persistence or the autonomy store.

Therefore the invariant is **one authoritative store per domain**, not one physical IndexedDB/database for every feature.

## 5. Execution planes

### 5.1 Interactive Gemini

`App -> streamGoogleToolLoop() -> geminiTurnPort -> src/gemini/provider.ts -> GoogleGenAI.interactions.create()`.

The provider obtains the Lockbox key, composes thread memory unless disabled by the caller, resolves artifact inputs, streams normalized events and supports grouped tool-result continuation.

### 5.2 VTT

Microphone capture is browser-local. Transcription calls Gemini through its reviewed path; optional transformation returns text to the composer for user review. Neither path bypasses the user's final Send action.

### 5.3 Self-hosted Worker

`worker/src/entry.ts` is the HTTP composition root. `/google/oauth/*` and `/clickup/oauth/*` are isolated into their provider-specific durable OAuth boundaries; all existing health/Gemini/autonomy traffic delegates to the established Worker core. Scheduled execution remains owned by the existing autonomy Worker path.

The Worker may hold deployment-owned secrets. It still does not replace normal browser chat.

## 6. Google and model tool boundary

Google authorization has two deliberate modes:

```text
no Worker pairing -> browser GIS token client -> interactive-only
paired Worker -> GIS popup code -> signed Worker exchange -> encrypted refresh vault
```

The paired path uses the user's existing installation credential for authenticated browser-to-Worker admission. Short-lived access tokens return to browser memory; refresh tokens never do. A paired installation fails closed when its Worker is unavailable instead of silently switching security models.

Workspace adapters cover Calendar, Tasks, Gmail, Docs, Drive and Sheets; Google Chat adapter/scope foundations exist but model exposure remains deferred/internal. Consequential Workspace mutations remain confirmation-gated independently of OAuth.

The generic model tool registry also carries application-local tools and browser-only media/memory tools. Treat the registry as the executable model capability surface, not as proof that every tool is a Google API. The first-party ClickUp integration is designed to join this same surface: Gemini proposes a semantic ClickUp tool, the existing executor/confirmation authority admits it, and a browser MCP client delegates provider execution to the authenticated Worker where ClickUp credentials and REST calls remain server-side.

## 7. Deployment ownership

A fork owner configures their own GitHub Pages origin and optional Cloudflare Worker. Their Google Web OAuth client must authorize their PWA origin. `VITE_GOOGLE_CLIENT_ID` and Worker `GOOGLE_OAUTH_CLIENT_ID` identify the same client; the client secret and vault key remain Worker-only. `ALLOWED_ORIGINS` must be changed to that deployment's exact origin.

No credential or refresh grant is intended to be shared between unrelated Elara deployments.

## 8. Documentation ownership

`/documents` is the canonical technical-documentation root. Filenames/system IDs are stable routing keys; chapter numbers are local navigation. Do not create `PASS`, `STATUS`, `HANDOFF`, `RECOVERY`, roadmap or implementation-log files. Git owns chronology.

The legacy `/docs` tree and pass/status migration files were removed after canonical extraction and reference migration. `public/core/README.md` remains intentionally outside `/documents` as an operational BusyTeX asset note.
