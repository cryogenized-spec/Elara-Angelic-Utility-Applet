# Prompt 5 — Gemini Integration Strategy

## Status

Accepted as the canonical Gemini provider strategy for the clean-room rebuild.

## Purpose

Elara has exactly one production Gemini execution path. The application will talk to one provider boundary; only that provider boundary knows the Google Gen AI SDK and Interactions-specific request/response shapes.

The archived application's multiple execution paths are intentionally not reproduced. In particular, the new application must not retain a `generateContent` fallback, a second Gemini client, or a compatibility adapter that can silently route around the Interactions provider.

## Current external facts verified for Prompt 5

These facts were re-checked against Google's current documentation and the live npm package page before fixing the strategy:

- The Interactions API is generally available as of June 2026 and Google recommends it for new projects. The original `generateContent` API remains supported by Google, but it is explicitly outside Elara's canonical runtime path. (Google AI for Developers, Interactions overview, checked 2026-09-03.)
- The official JavaScript SDK is `@google/genai`; the npm `latest` release checked for this prompt is `2.19.0`. The package documentation warns against exposing API keys in client-side production code and identifies the older `@google/generative-ai` package as legacy. (npm, checked 2026-09-03.)
- The current JavaScript SDK exposes `ai.interactions.create(...)` for Interactions, including a streaming overload, and supports stateful continuation through `previous_interaction_id`. (Official SDK reference, checked 2026-09-03.)
- The current model-interaction request shape includes the fields Elara needs to own explicitly: `model`, `input`, `generation_config`, `previous_interaction_id`, `system_instruction`, `tools`, `safety_settings`, `stream`, and `store`, with background execution also available for later work. (Official API/SDK references, checked 2026-09-03.)
- Interactions represent model execution as typed steps. Thinking is a first-class `thought` step and stateful mode is the recommended way to preserve thought-signature continuity because the server manages the required signatures. (Google thinking documentation, checked 2026-09-03.)

## Canonical dependency direction

```text
UI
  ↓
application/chat
  ↓
normalized Gemini request contract
  ↓
Canonical Gemini provider
  ↓
@google/genai → Interactions API
  ↓
normalized stream/completion/error contract
  ↓
application/chat
  ↓
UI + persistence + diagnostics
```

The UI never imports `@google/genai`. Persistence never imports `@google/genai`. Diagnostics never parses arbitrary SDK payloads. The Worker/security boundary may supply protected credentials, but it does not become a second Gemini implementation.

## Provider responsibilities

The `gemini/` boundary owns exactly these provider-specific concerns:

1. Constructing the `GoogleGenAI` client in the approved runtime boundary.
2. Translating a normalized Elara request into the current Interactions API request shape.
3. Calling `ai.interactions.create(...)` for foreground execution, with streaming when the caller requests streaming.
4. Translating Interactions stream events and completed interaction resources into normalized Elara events/results.
5. Translating provider failures into a small diagnostic contract without losing HTTP/provider status information.
6. Preserving provider continuity identifiers such as `interaction.id` and the previous-interaction relationship needed by application state.
7. Enforcing the one-path rule: there is no alternate Gemini API method inside the provider.

The provider does not own conversation persistence, UI state, retry policy, analytics, OAuth, attachments, or application-level message orchestration.

## Application-facing request direction

The application sends a provider-neutral request containing only product-approved values. Conceptually:

```ts
interface GeminiRequest {
  model: string;
  input: GeminiInput;
  systemInstruction?: string;
  generation: GeminiGenerationSettings;
  previousInteractionId?: string;
  stream: true;
  store: true;
  tools?: GeminiTool[];
  safetySettings?: GeminiSafetySetting[];
}
```

This is an architectural shape, not a final TypeScript contract. Prompt 28 will define and validate the actual request schema. Prompt 7 will narrow the generation fields by model capability. Unsupported values must be impossible to emit rather than merely ignored.

The foreground chat path should prefer `stream: true` and `store: true` so the UI can update incrementally while the interaction remains recoverable for later continuation. Background execution is explicitly deferred to Prompt 49.

## Provider response direction

The provider emits normalized application events rather than leaking raw SDK objects. The next streaming prompt will formalize the exact event discriminant, but the intended conceptual flow is:

```text
interaction created
→ step lifecycle
→ thought summary (when actually supplied)
→ model text delta(s)
→ tool-call lifecycle (when supported/used)
→ completion
or
→ cancellation / failure
```

Every event must carry enough information for deterministic request-state handling and diagnostics without exposing raw credentials or message-content telemetry.

## Stateful continuation

Elara will use the Interactions API's `previous_interaction_id` for normal multi-turn continuation once conversation state is implemented.

The application owns the relationship between a local conversation/message and its latest provider interaction identifier. The provider owns the provider-specific request field used to continue the interaction.

Stateful Interactions are preferred over rebuilding full history solely to preserve server-managed thought signatures. Google documents server-side state as the recommended approach for continuity. Stateless mode is not the default architectural path, although the normalized provider contract must not make a future explicit stateless implementation impossible.

## Credentials and deployment boundary

The browser must not contain an application-owned Gemini API secret. The final credential flow will pass through the security/Worker boundary established in Prompts 4 and 12–13.

The provider boundary therefore has two deployment-compatible modes conceptually:

- protected server/Worker execution using an application-owned credential; or
- another explicitly approved secure credential mechanism that does not bundle an application-owned secret into browser code.

This document intentionally does not authorize a browser-exposed API key merely because the SDK supports client-side initialization.

## Error ownership

Provider-specific failures are classified at the Gemini boundary and surfaced as normalized diagnostics. The provider must preserve:

- provider/HTTP status where available;
- provider request or response identifier where available;
- safe error category;
- retryability signal;
- timing metadata supplied by the surrounding request lifecycle;
- provider status/message suitable for developer diagnostics.

The provider must not include API keys, OAuth tokens, authorization codes, secret-bearing headers, or raw user message bodies in diagnostic payloads.

Retry policy is not owned by the provider. The chat/request lifecycle layer will decide whether a normalized failure is retryable and whether an operation is safe to retry.

## Explicit exclusions

The canonical provider will not contain:

- `generateContent` or `generateContentStream` execution;
- a second Gemini SDK/client instance for normal chat;
- fallback routing between Gemini API families;
- React/UI imports;
- Dexie/IndexedDB access;
- Google OAuth implementation;
- analytics collection;
- persistence of conversation records;
- implicit retry loops;
- silent swallowing of provider failures.

## Relationship to upcoming prompts

- Prompt 6 owns the live model registry and capability metadata.
- Prompt 7 owns model-aware generation settings and field emission.
- Prompt 8 owns the concrete normalized streaming event contract.
- Prompt 9 owns display semantics for supported thinking summaries.
- Prompt 28 later freezes the validated request contract.
- Prompt 29 later freezes normalized provider-error behavior.
- Prompt 49 later evaluates Interactions background execution after foreground chat is proven.

## Prompt 5 completion criterion

There is now one documented canonical Gemini provider boundary with one execution path, a product-owned request/response seam, explicit credential ownership, and explicit exclusions for the legacy API and duplicate providers. The strategy is grounded in the current Interactions API and `@google/genai` rather than the archived application's historical implementation.