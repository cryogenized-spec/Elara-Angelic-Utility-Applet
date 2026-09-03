# Prompt 5 — Gemini Integration Strategy

## Status

Accepted as the canonical Gemini provider strategy for the clean-room rebuild.

## Purpose

Elara has exactly one production Gemini execution path. The application will talk to one provider boundary; only that provider boundary knows the Google Gen AI SDK and Interactions-specific request/response shapes.

The archived application's multiple execution paths are intentionally not reproduced. In particular, the new application must not retain a `generateContent` fallback, a second Gemini client, or a compatibility adapter that can silently route around the Interactions provider.

## Current external facts verified for Prompt 5

The current Google documentation says the Interactions API is generally available and recommended for new projects. The original `generateContent` API remains supported by Google but is outside Elara's runtime path. The official JavaScript SDK is `@google/genai`; the npm latest checked for this build is 2.19.0. The SDK exposes `ai.interactions.create(...)`, including streaming, and stateful continuation uses `previous_interaction_id`.

## Canonical dependency direction

```text
UI
  ↓
application/chat
  ↓
normalized Gemini request contract
  ↓
canonical Gemini provider
  ↓
@google/genai → Interactions API
  ↓
normalized stream/completion/error contract
  ↓
application/chat
  ↓
UI + persistence + diagnostics
```

The UI never imports `@google/genai`. Persistence never imports it. Diagnostics never parses arbitrary SDK payloads. Worker/security may provide protected credentials but is not a second provider.

## Provider responsibilities

The `gemini/` boundary owns SDK client construction, translation to current Interactions requests, foreground streaming invocation, event/result normalization, provider-error classification, and provider continuity identifiers.

It does not own conversation persistence, UI state, retry policy, analytics, OAuth, attachments, tool execution, memory retrieval, or system-prompt authoring.

## Application-facing request direction

The eventual normalized request contains only product-approved values such as model, input, system-instruction payload, model-aware generation settings, optional prior interaction identifier, stream intent, storage intent, and curated tool declarations. Prompt 28 will freeze the validated schema. Prompt 7 controls which generation settings are legal. Provider-specific field names never escape `gemini/`.

## Provider response direction

The provider emits normalized lifecycle events. The intended stream includes interaction creation/progress, step lifecycle, thought-summary data, model text deltas, function-call lifecycle, completion/usage, and terminal failure/cancellation states.

## Stateful continuation

Normal multi-turn chat uses `previous_interaction_id`. The application persists the association between its local conversation and the latest provider interaction identifier; the provider translates that into the API request field. Stateful continuation is preferred because the server manages conversation history and thought-signature continuity.

## Future tool calling and Workspace

Tool definitions are curated application capabilities, not arbitrary model-generated code. A later tool registry supplies schemas; a validated application service executes requested calls. Google Workspace services remain behind one OAuth authority and a centralized Google tool boundary. Tool execution is therefore not owned by the Gemini provider.

## Future character system prompt

The character's master identity/personality/roleplay instruction will be maintained as a separate controlled system-instruction source. It is not stored as a user message and is not part of the tool registry. The provider only receives the final approved system instruction as a request input. Prompt 27 authors the production creative-context content.

## Future memory/notes

Long-term notable-event notes are a separate application context domain. The provider does not query or mutate the memory store directly. Chat/application orchestration will later retrieve approved notes and include bounded context in the normalized request.

## Credentials and deployment boundary

The browser must not contain an application-owned Gemini secret. The final credential path is through the security/Worker boundary established by Prompt 12–13. The SDK's ability to initialize in a browser is not permission to ship an application-owned production key there.

## Error ownership

Gemini-specific failures are normalized at the provider boundary. The normalized diagnostic preserves provider/HTTP status, safe category, provider request/interaction identifier where available, retryability metadata, and timing supplied by the outer lifecycle. It excludes credentials, OAuth tokens, secret headers, and message bodies. Retry decisions belong to chat/lifecycle, not the provider.

## Explicit exclusions

No `generateContent` or `generateContentStream` execution; no second Gemini client; no fallback routing between Gemini API families; no React/Dexie/OAuth/analytics dependencies; no implicit retry loops; no silent provider-failure swallowing.

## Relationship to later prompts

Prompt 6 owns the live model registry. Prompt 7 owns capability-driven settings. Prompt 8 owns the concrete normalized stream contract. Prompt 9 owns thinking presentation. Prompt 28 freezes the request schema. Prompt 29 freezes provider-error normalization. Prompt 49 evaluates background execution.
