# Gemini Request Contract

## Purpose

Define the only application-facing contract for sending an Elara interaction to the canonical Gemini Interactions provider.

## Boundary

The application constructs a provider-neutral `InteractionRequest`. The Gemini adapter alone translates that contract into the Google `interactions.create` request.

Conceptually:

```text
UI/input
  → chat application state
  → InteractionRequest
  → canonical Gemini provider
  → Gemini Interactions
  → normalized stream events
```

The UI never creates a Google SDK request and never receives a provider secret.

## Request shape

The contract contains only validated application data:

- model identifier selected from the live model registry
- current user input and typed multimodal parts
- optional previous interaction identifier
- character master system instruction
- capability-filtered generation settings
- allow-listed tool declarations
- attachment references resolved by the attachment boundary
- streaming preference
- storage/background intent when explicitly supported by the application

Provider-specific fields must not leak into the application model unless they are deliberately promoted into a stable domain contract.

## System instruction

The character master instruction is a first-class request input and is re-supplied whenever the provider contract requires it. It is never appended to user text and is never treated as ordinary conversation history.

## Tools

Tool declarations are selected from the application allow-list. A tool schema is descriptive capability metadata only; it does not grant permission to execute anything. Actual execution remains behind validated application services.

## Continuity

`previous_interaction_id` is optional provider continuity metadata. Local conversation history remains the authoritative user-facing conversation store; the provider interaction identifier is continuity metadata, not the local source of truth.

## Validation

All external/configured values are validated before crossing the provider boundary. Unsupported model settings are stripped before request creation. Missing authorization, invalid attachment references, and malformed tool declarations fail before network execution.

## Current upstream facts

Google's current Interactions API accepts `input`, `system_instruction`, `tools`, `generation_config`, `stream`, `store`, `background`, and `previous_interaction_id`. Streaming uses SSE and function-calling can resume through `previous_interaction_id`. These are translated only inside the canonical provider adapter. citeturn901754search0turn901754search1turn901754search3

## Non-goals

Do not add a second Gemini request builder, GenerateContent fallback, browser-side Gemini secret, or provider-specific request construction in presentation code.
