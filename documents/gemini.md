---
id: SYS-GEM
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: Gemini request, streaming and continuation boundary
paths: [src/gemini]
keywords: [gemini, interactions, provider, streaming, model, tool-call, thinking]
---

# Gemini

## 1. Purpose and boundary

`SYS-GEM` is the canonical interactive Gemini boundary. It translates application requests into the Gemini Interactions API, applies model capabilities, prepares attachments, composes bounded memory context, normalizes streaming events/errors and continues tool calls. It does not own conversation persistence, Google service execution, memory storage or UI state.

Normal chat is browser-direct through `src/gemini/provider.ts` and `@google/genai`. The Cloudflare Worker is a separate execution plane; see `SYS-WORKER / worker.md`.

## 2. Runtime architecture

```text
App / tool loop
-> GeminiTurnPort
-> Lockbox credential
-> compose thread memory unless memoryContext=none
-> resolve attachments
-> interactions.create(stream=true, store=true)
-> normalized GeminiStreamEvent
-> optional tool execution
-> grouped tool-result continuation
```

The SDK client uses API version `v1` with SDK automatic retry attempts fixed to `1`; application retry/lifecycle policy remains outside the SDK.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Request/event contracts | `src/gemini/contracts.ts` |
| Provider/stream adapter | `src/gemini/provider.ts` |
| Stable model registry | `src/gemini/model-registry.ts` |
| Capability settings | `src/gemini/settings-engine.ts` |
| Error normalization | `src/gemini/errors.ts` |
| Tool loop | `src/gemini/google-tool-loop.ts` |
| Memory projection | `src/gemini/memory-context.ts` |
| Runtime context | `src/gemini/runtime-context.ts` |
| Background contracts | `src/gemini/background/` |

## 4. Data and contracts

Default model is `gemini-3.8-flash`. `model-registry.ts` is authoritative for exposed stable text models and supported thinking/settings controls; preview/experimental and non-text model families are deliberately excluded from the normal selector.

`GeminiStreamEvent` normalizes interaction/status, step boundaries, function calls, text deltas, thought-summary deltas/signatures, artifact creation, structured media resolution, completion, cancellation and failure. Tool continuations accept one result or a grouped `results` array.

Generation settings are capability-driven. The adapter maps supported values to `thinking_level`, `thinking_summaries`, `max_output_tokens`, `seed` and up to five stop sequences. Unsupported controls must not be invented or sent.

Attachments are stable artifact IDs. Ready files up to 4 MiB are sent inline; larger files use the Gemini Files API. Valid remote references may be reused until near expiry. Stale-generation/cancellation guards prevent obsolete preparation from mutating artifact metadata.

## 5. Invariants

- One canonical interactive Gemini provider path; never add `generateContent` fallback or a competing chat provider.
- API keys come through `SYS-SEC / security.md`, never a `VITE_*` browser variable.
- Empty Character Master means omit `system_instruction`, not inject a default persona.
- Interactive chat defaults to thread-scoped memory composition; callers that own memory scope use `memoryContext: 'none'`.
- Tool declarations come from the registered executable capability surface; schemas contain no secrets.
- Structured tool/media/artifact events remain structured through the chat boundary.

## 6. Security and failure semantics

Empty or locked Lockbox state yields explicit configuration failures. Provider exceptions are normalized; cancellation resolves promptly even if the network stream is idle. Function arguments are parsed as objects after streaming assembly. Attachment MIME/readiness is revalidated at the provider boundary.

The app may expose provider-produced thought summaries, but it does not treat hidden reasoning/signatures as a user-editable second transcript.

## 7. Verification and tests

Use `src/gemini/*.test.ts`, tool-loop integration/read-only/runtime-context tests, multimodal tests, model/settings tests and the repository reliability gate. The gate explicitly forbids legacy `generateContent`, Worker routing for browser chat and obsolete SDK API-version configuration.

## 8. Known gaps

Provider/model capabilities must be revalidated against current Google documentation before registry changes. Background/cloud execution shares contracts where useful but must not drift into a second interactive provider architecture.
