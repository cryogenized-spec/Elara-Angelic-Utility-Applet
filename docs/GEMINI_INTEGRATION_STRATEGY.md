# Gemini Integration Strategy

## Status

Accepted as the canonical Gemini provider strategy for the clean-room rebuild.

## Purpose

Elara has one production Gemini execution path. The application talks to one provider boundary; only that provider boundary knows the Google GenAI SDK and Interactions-specific request/response shapes.

The archived application's multiple execution paths are intentionally not reproduced. In particular, the new application does not retain a `generateContent` fallback, a second Gemini client, or a compatibility adapter that can silently route around the Interactions provider.

## Current external facts

Google's current documentation exposes the Interactions API with a dedicated `system_instruction` field, optional tool declarations, streaming, and stateful continuation through `previous_interaction_id`. The official JavaScript SDK is `@google/genai`. The application keeps those provider-specific shapes behind its Gemini boundary.

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

The UI never imports `@google/genai`. Persistence never imports it. Diagnostics never parses arbitrary SDK payloads. The Cloudflare Worker is a protected transport and credential boundary; it is not an alternate character layer.

## Provider responsibilities

The `gemini/` boundary owns SDK client construction, translation to current Interactions requests, foreground streaming invocation, event/result normalization, provider-error classification, and provider continuity identifiers.

It does not own conversation persistence, UI state, retry policy, analytics, OAuth, attachments, tool execution, memory retrieval, or character authoring.

## Application-facing request direction

The normalized request contains product-approved values such as model, input, Character Master System Instruction, model-aware generation settings, optional prior interaction identifier, and curated tool declarations. Provider-specific field names never escape `gemini/`.

## Elara Character Master

Elara's configured `character.systemInstruction` is the application's Character Master System Instruction. It establishes Elara's identity, embodied description, personality, demeanour, continuity, perception of the user, and response behavior.

The application passes that instruction as the system-instruction field. It does not manufacture a generic assistant persona first and then decorate the result with Elara. User input is received and answered from inside the established Elara identity.

There is one character instruction for a turn. Runtime code must not append a competing character prompt for roleplay, VTT, tool use, or task category.

## Tool calling and Workspace

Tool definitions are curated application capabilities. They are not model-generated code and they are not a competing model persona or policy layer.

The Gemini model may request an exposed capability. The application decides whether the request is registered, authorized, validated, confirmed where required, and executable. A capability should only be exposed on a conversational path when that path has a concrete handler for it.

Google Workspace services remain behind the application's OAuth authority and tool execution boundary.

## Provider response direction

The provider emits normalized lifecycle events including interaction creation/progress, step lifecycle, thought-summary data, model text deltas, function-call lifecycle, completion/usage, and terminal failure/cancellation states.

## Stateful continuation

Normal multi-turn chat uses `previous_interaction_id`. The application persists the association between its local conversation and the latest provider interaction identifier; the provider translates that into the API request field. Stateful continuation is preferred when supported because Gemini manages the interaction history and continuity data.

## Memory and context

Long-term memory/notes remain a separate application context domain. The provider does not query or mutate the memory store directly. Chat/application orchestration supplies only the context that is actually available for the current turn.

## Credentials and Cloudflare boundary

The browser must not contain the application-owned Gemini secret. The Cloudflare Worker holds the Gemini API key as a secret and forwards authorized application requests to Gemini. Cloudflare documents secrets as encrypted Worker bindings accessible through the Worker environment. The Worker therefore protects the credential without becoming part of Elara's character architecture.

## Error ownership

Gemini-specific failures are normalized at the provider boundary. The normalized diagnostic preserves provider/HTTP status, safe category, provider request/interaction identifier where available, retryability metadata, and timing supplied by the outer lifecycle. It excludes credentials, OAuth tokens, secret headers, and message bodies.

## Explicit exclusions

No `generateContent` execution; no second Gemini client; no fallback routing between Gemini API families; no React/Dexie/OAuth/analytics dependencies inside the provider; no implicit retry loops; no silent provider-failure swallowing; no competing character system layer.
