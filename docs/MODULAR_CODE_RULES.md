# Modular Code Rules

## Purpose

This document is the implementation rulebook for Elara's source tree. It turns the earlier ownership architecture into enforceable coding constraints before the first runtime slice is built.

## Core rule

Every module must have one primary responsibility that can be described in one sentence. A module may coordinate adjacent responsibilities only when that coordination is its explicit ownership boundary.

Prefer small, composable functions, types, hooks, adapters, repositories, and UI components over broad managers.

## Dependency direction

The intended dependency direction is:

```text
ui
  ↓
application / chat orchestration
  ↓
domain contracts
  ↓
concrete adapters
```

Infrastructure adapters must not leak upward into presentation components. Domain contracts must not depend on a concrete browser API, Gemini SDK, Dexie implementation, OAuth provider, or Cloudflare Worker.

## Ownership rules

### UI
Owns rendering, input behavior, accessibility, responsive layout, visual states, and user interaction wiring.

Must not own raw Gemini requests, IndexedDB/Dexie implementation, OAuth token handling, secrets, analytics internals, or tool execution.

### Chat/application
Owns conversation orchestration and request lifecycle coordination.

Must not become a generic `AppManager`, `RuntimeManager`, or dumping ground for unrelated infrastructure.

### Gemini
Owns translation between the application's provider-neutral request/event contracts and Google's Interactions API.

Exactly one canonical Gemini provider implementation is permitted. No legacy `generateContent` path, duplicate client, or compatibility facade is allowed.

### Persistence
Owns Dexie schema, migrations, repositories, transactions, and recovery semantics.

Persistence callers work through domain-specific repositories or contracts rather than reaching into the database directly.

### Attachments
Owns selection, validation, metadata, preview state, transfer lifecycle, removal, and provider handoff metadata.

It must not decide conversation UI layout or embed Gemini SDK request construction.

### Appearance
Owns theme, background, readability treatment, and portrait presentation state.

It is presentation/configuration state, not a chat attachment or provider concern.

### Diagnostics
Owns safe request diagnostics, timing, retryability, normalized errors, and developer-facing diagnostic data.

Diagnostics must never store secrets or user message contents by default.

### Analytics
Owns privacy-conscious product telemetry separate from diagnostics.

Analytics must not become a logging sink for raw prompts, responses, OAuth tokens, or provider payloads.

### Security / Lockbox
Owns application secrets and protected configuration boundaries.

Secrets must never cross into React state, conversation persistence, analytics, diagnostics, or model-visible tool schemas.

### Google Workspace
Owns OAuth and later Calendar, Tasks, Docs, and Chat integrations behind one authorization authority.

Individual Workspace services do not invent their own OAuth/token store.

### Worker
Owns the thin protected server boundary required to mediate credentials and server-only operations.

It must not recreate the application orchestration layer or become a second frontend runtime.

## Anti-patterns prohibited by default

Avoid generic classes or modules named `Manager`, `Runtime`, `Engine`, `Orchestrator`, `Coordinator`, or `Utils` unless the name describes a real, documented ownership boundary.

Do not introduce a dependency injection framework merely to hide straightforward imports.

Do not maintain parallel stores for the same domain state.

Do not create compatibility adapters whose only purpose is keeping an old design alive.

Do not mirror Gemini state in multiple application layers.

Do not let a UI component call a provider SDK directly.

Do not pass database handles into reusable UI components.

Do not let tool schemas contain credentials or hidden execution behavior.

Do not make long-term memory a sub-feature of ordinary conversation persistence.

Do not let diagnostics, analytics, memory, Workspace, or tool execution become implicit side effects of a generic message handler.

## Boundary rules for functions

Functions should accept explicit inputs and return explicit outputs. Side effects must occur at named boundaries.

Validation must happen at trust boundaries. External data should be narrowed before entering internal domain logic.

Async operations must have explicit success, failure, and cancellation behavior where cancellation is meaningful.

No unbounded caches, retry loops, polling loops, or listener registrations are allowed without a stated owner and cleanup path.

## UI composition rules

Prefer components that represent a stable visual responsibility: shell, scroll surface, message item, composer, attachment chip, status row, portrait, settings control, and similar units.

A parent may compose children but should not absorb their infrastructure responsibilities.

Keep presentational components free of provider, database, OAuth, or secret logic.

## Provider rules

The application-facing provider contract must be narrower than the Google SDK surface.

The provider adapter may translate capability-aware settings, multimodal input, continuation identifiers, streaming events, and normalized failures, but it must not own persistence, UI state, or tool business logic.

## Testing rules

Modules with deterministic logic must be testable without a browser, Gemini network, OAuth session, or real IndexedDB connection whenever practical.

Browser-dependent behavior should be isolated behind small adapters so the majority of logic can use unit tests.

End-to-end tests should verify user-visible vertical slices rather than becoming a substitute for unit tests.

## Change discipline

When adding a feature, first identify its owner. If ownership cannot be stated clearly, the design is not ready to implement.

When a feature appears to need access to several domains, prefer explicit application-level composition over creating a new mega-module.

When the same rule is needed in multiple places, extract a focused contract or function rather than copying infrastructure.

## Review checklist

Before merging a code change, verify:

- The changed files have clear ownership.
- No new duplicate provider/persistence/OAuth/runtime path was introduced.
- External input is validated at the boundary.
- UI remains infrastructure-agnostic.
- Side effects have a named owner and cleanup/error path.
- Tests exist for meaningful deterministic behavior.
- No generic manager/service/runtime module was introduced without justification.
- Documentation still matches the actual dependency direction.

These rules are binding implementation guidance for the clean-room rebuild.