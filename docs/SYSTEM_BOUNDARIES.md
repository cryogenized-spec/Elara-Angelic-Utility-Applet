# Prompt 4 — System Boundaries

## Status

Accepted and implemented as the responsibility/ownership contract for the clean-room rebuild.

## Purpose

Elara must have clear boundaries without recreating the abstraction maze of the archived application. A boundary exists because a responsibility needs a clear owner, not because every function needs another layer.

## Responsibility map

| Area | Sole responsibility | May depend on | Must not own |
|---|---|---|---|
| `ui/` | Rendering, input, interaction, accessibility, responsive layout | chat/application interfaces, appearance state | Gemini client, Dexie, OAuth internals, secrets |
| `chat/` | Conversation orchestration and request lifecycle | provider contract, persistence interfaces, diagnostics | raw provider SDK construction, UI rendering |
| `gemini/` | Canonical Gemini request/response translation and provider contract | `@google/genai` | UI state, IndexedDB, OAuth, analytics |
| `persistence/` | Dexie schema, repositories, migrations, recovery | Dexie/IndexedDB | provider calls, UI state |
| `attachments/` | File picking, validation, metadata, lifecycle, provider-ready representation | browser file APIs, provider boundary types | conversation orchestration, OAuth |
| `appearance/` | Theme/background/portrait presentation state | browser APIs, persistence interface | chat/provider logic |
| `diagnostics/` | Request diagnostics, safe error normalization, timing metadata | provider/network lifecycle information | secrets, message-content collection |
| `analytics/` | Privacy-conscious product telemetry | safe application events | raw message content, tokens, credentials |
| `google/` | Google authorization and later Calendar/Tasks/Docs/Chat services | GIS/OAuth, validated service contracts | Gemini credentials, chat rendering |
| `security/` | Lockbox/configuration and secret classification | secure runtime interfaces | conversation content, analytics |
| `worker/` | Server-side HTTP mediation and protected credential boundary | Gemini provider, diagnostics, later Google boundaries | UI state, browser persistence |

## Dependency direction

The preferred dependency direction is:

`ui → application/chat → domain contracts → concrete adapters`

Concrete adapters include Gemini, persistence, attachments, browser capabilities, diagnostics storage, Google services, security, and the Worker boundary.

The reverse direction is prohibited. A persistence adapter must not import UI components. The Gemini adapter must not import React. A Google service must not reach into chat state. UI components must not reach around an application interface to call the SDK or database directly.

## One-owner rules

### Gemini

There is exactly one canonical Gemini provider implementation. Normal chat uses the Interactions API through `@google/genai`. No legacy `generateContent` fallback and no second client may exist.

### Persistence

Dexie/IndexedDB is the single authoritative browser persistence mechanism. Other modules communicate through persistence interfaces rather than opening their own databases.

### OAuth

There is one Google authorization authority. Later Calendar, Tasks, Docs, and Chat services consume authorization state; they do not implement their own consent flows.

### Secrets

Secret ownership belongs to the security/Worker boundary. Browser UI and normal client state must never become the source of truth for an application-owned Gemini API secret.

### Diagnostics

Diagnostics are structured data attached to request lifecycles. They must be useful enough to explain failures while excluding credentials and user message contents by default.

### Analytics

Analytics are separate from diagnostics. Analytics describe product-level behavior and health; diagnostics explain individual technical failures. Neither may silently collect conversation contents.

## Boundary contracts

Cross-boundary values should use explicit TypeScript interfaces or schemas and be validated where data enters the system. Zod is the default validation mechanism for external/untrusted payloads.

Raw browser `File` objects, provider SDK objects, OAuth token responses, persisted database records, and HTTP JSON bodies should not leak across the entire application. Convert them at the responsible boundary into small domain representations.

## UI rule

UI is an adapter to application state, not the application architecture. Components should ask for actions and read state through focused interfaces. They should not know whether persistence uses Dexie, whether Gemini uses streaming HTTP, or how OAuth tokens are refreshed.

## Provider rule

The application/provider boundary owns provider-specific details. The rest of the application consumes normalized request, stream-event, completion, cancellation, and diagnostic contracts. Provider-specific fields are translated only inside `gemini/`.

## Persistence rule

Repositories expose domain operations such as creating a conversation, appending a message, updating request state, or reading a conversation. Callers should not depend on Dexie table names or IndexedDB implementation details.

## Diagnostics rule

Every provider/network request must have a lifecycle that can be represented as structured diagnostic data: request identifier where available, operation, timestamps/duration, network/provider status, retryability, retry count, cancellation/timeout outcome, and a safe error category.

Message content, API keys, OAuth tokens, authorization codes, and raw secret-bearing headers are excluded from diagnostics.

## Analytics rule

Analytics must be opt-in to the minimum useful metadata needed for product health and debugging trends. Message text, prompt/response bodies, tokens, credentials, and raw provider payloads are not analytics data.

## Worker rule

The Worker is a narrow security and mediation boundary. It may validate requests, attach protected credentials, call the canonical provider, normalize diagnostics, and expose later integration endpoints. It must not become a second application runtime with its own competing chat state, persistence, provider implementation, or UI logic.

## Complexity guardrails

Do not introduce:

- generic `Manager`, `Service`, `Runtime`, or `Utils` layers without a concrete ownership reason;
- dependency-injection frameworks merely for indirection;
- parallel repositories or caches that become hidden sources of truth;
- compatibility adapters for code that does not exist in the new application;
- a second Gemini execution path;
- a second OAuth authority;
- a second production server runtime;
- framework-specific architecture solely to satisfy a tool rather than a product requirement.

When a new module is proposed, its owner, inputs, outputs, dependencies, and reason for change should be explainable in a few sentences.

## Prompt 4 completion criterion

The repository has one explicit owner for each major responsibility, a directional dependency model, and documented prohibitions against the failure modes observed in the archived application. These rules are architectural constraints for subsequent prompts, not a requirement to create a large abstraction hierarchy.
