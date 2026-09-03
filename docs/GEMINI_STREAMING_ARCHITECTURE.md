# Prompt 8 — Gemini Streaming Architecture

## Status

Accepted as the canonical streaming design for Elara.

## Provider stream boundary

The canonical Gemini provider consumes the Interactions API stream and converts provider-specific events into application events. UI, persistence, diagnostics, and future tool services never parse SSE directly and never depend on raw `@google/genai` event objects.

Current Interactions streaming is server-sent events with a step-based lifecycle. The canonical provider recognizes `interaction.created`, progress/status events, `step.start`, `step.delta`, `step.stop`, `interaction.completed`, and the terminal `done` condition. The current breaking-change surface uses `step.delta`; older `content.delta` parsing must not return. 

## Normalized event model

Conceptually the application stream is:

```ts
type GeminiStreamEvent =
  | { type: 'interaction-created'; interactionId: string; model: string }
  | { type: 'interaction-status'; interactionId: string; status: string }
  | { type: 'step-start'; index: number; stepType: 'thought' | 'model-output' | 'function-call' | 'other' }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'thought-summary-delta'; index: number; text: string }
  | { type: 'thought-signature'; index: number; signature: string }
  | { type: 'function-call-start'; index: number; callId: string; name: string; arguments?: unknown }
  | { type: 'function-call-arguments-delta'; index: number; argumentsText: string }
  | { type: 'step-stop'; index: number }
  | { type: 'completed'; interactionId: string; status: string; usage?: GeminiUsage }
  | { type: 'cancelled'; interactionId?: string }
  | { type: 'failed'; error: GeminiProviderError };
```

This is a conceptual discriminated union. Prompt 28/29 will freeze validation and exact provider/error contracts.

## Event ownership

`gemini/` parses the SDK stream and produces normalized events. `chat/` consumes those events and owns lifecycle transitions. The UI renders chat state. Persistence records application state at controlled checkpoints. Diagnostics receives safe request metadata. No event consumer is allowed to reimplement provider parsing.

## Step assembly

The provider maintains only the minimal transient state required to assemble deltas into application events. It must tolerate multiple `step.delta` events for the same index, step boundaries, empty/optional thought summaries, and function-call argument fragments. Completed interactions carry authoritative final status and usage.

The provider must not persist raw streams wholesale. If a reconnect/resume mechanism is later needed, the application stores the interaction identifier and safe event cursor metadata needed to recover the stream.

## Errors and termination

A stream can terminate by successful completion, explicit cancellation, transport failure, provider failure, protocol/validation failure, or timeout imposed by the outer request lifecycle. The provider reports a normalized terminal event; chat decides the user-visible lifecycle state.

No stream consumer may treat an exhausted iterator as success unless an explicit completion event or equivalent completed interaction is observed.

## Future function/tool calling

Function calls are normalized as first-class events even before tool execution is implemented. A future tool executor receives the normalized function name/call ID/arguments, validates them against the curated tool registry, executes the owned service, and sends a normalized function-result turn back through the same Interactions provider. Google Workspace functions therefore require no special stream parser.

## Future character system prompt

The stream layer does not own persona instructions. A dedicated system-instruction builder provides the approved character master prompt to the request layer; streamed output is independent of how that instruction was sourced.

## Future memory/notes

The stream layer does not own memory retrieval. The application request builder may add bounded retrieved note context before execution; the stream merely reports resulting model output and tool activity.

## Cancellation

Foreground cancellation is an application lifecycle operation. The provider exposes a cancellation capability appropriate to the active execution/transport, while the chat lifecycle determines whether the operation is marked cancelled and how partial output is persisted. Background-interaction cancellation is a later Prompt 49 concern.

## Required invariants

- Exactly one Gemini provider parses Interactions streams.
- No UI component imports SSE/parser code.
- No second streaming API path exists.
- Raw SDK events do not enter persistent application state.
- Function-call events are representable without adding provider-specific logic to chat components.
- Completion is explicit and not inferred from stream exhaustion.
- Provider failures become diagnosable normalized failures rather than silent hangs.
