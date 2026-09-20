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

`SYS-GEM` is the canonical browser Gemini boundary. It translates application requests into the Gemini Interactions API, applies model capabilities, prepares attachments, composes bounded memory context for interactive chat, normalizes streaming events/errors and continues tool calls. It does not own conversation persistence, Google service execution, memory storage or UI state.

Normal chat is browser-direct through `src/gemini/provider.ts` and `@google/genai`. Bounded internal classifiers such as the Pass 3 organic-memory observer reuse that same provider instead of creating a second SDK/client path. The Cloudflare Worker is a separate execution plane; see `SYS-WORKER / worker.md`.

## 2. Runtime architecture

```text
interactive App / tool loop
-> GeminiTurnPort
-> Lockbox credential
-> compose thread memory unless memoryContext=none
-> resolve attachments
-> local rolling-input admission reservation
-> interactions.create(stream=true, store=true)
-> normalized GeminiStreamEvent + per-interaction usage
-> optional tool execution
-> grouped tool-result continuation
-> bounded chain compaction / terminal synthesis when gross-input budget requires it

bounded internal classifier
-> GeminiTurnPort
-> explicit system contract
-> memoryContext=none
-> tools=[]
-> normalized events
-> strict application-side parsing/validation
```

The SDK client uses API version `v1` with SDK automatic retry attempts fixed to `1`; application retry/lifecycle policy remains outside the SDK.

Browser Gemini admission also uses a device-local rolling 60-second gross-input ledger stored as a typed row in the existing conversation/settings IndexedDB authority. Each provider request reserves conservatively before dispatch; provider-reported gross input replaces the estimate when available, while requests that fail after dispatch remain conservatively charged. When measured provider usage is unavailable, textual input is charged from a UTF-8 byte upper bound rather than the usual English-oriented ~4-characters/token heuristic, so arbitrary Unicode or high-entropy text cannot silently undercount the safety budget. Every still-live reservation/observation remains in the rolling window until timestamp expiry; the ledger never evicts active usage merely to satisfy an entry-count cap. Inline image base64 is treated as transport encoding rather than prompt text and receives a fixed media safety reserve. IndexedDB serialization is authoritative across same-origin tabs; snapshot reads do not mutate the ledger and BroadcastChannel is notification-only. The default local allowance is intentionally below the observed free-tier TPM ceiling and is a safety policy, not a claim about provider billing or cached-token quota discounts.

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
| Organic-memory classifier adapter | `src/gemini/memory-observer.ts` |
| Runtime context | `src/gemini/runtime-context.ts` |
| Background contracts | `src/gemini/background/` |

## 4. Data and contracts

Default model is `gemini-3.8-flash`. `model-registry.ts` is authoritative for exposed stable text models and supported thinking/settings controls; preview/experimental and non-text model families are deliberately excluded from the normal selector.

`GeminiStreamEvent` normalizes interaction/status, step boundaries, function calls, text deltas, thought-summary deltas/signatures, artifact creation, structured media resolution, per-interaction usage, completion, cancellation and failure. Usage is surfaced for `requires_action` interactions before tool execution; when Google omits usage on an already-dispatched request, the provider emits an explicitly estimated conservative input floor rather than treating the request as free. Tool continuations accept one result or a grouped `results` array.

Generation settings are capability-driven. The adapter maps supported values to `thinking_level`, `thinking_summaries`, `max_output_tokens`, `seed` and up to five stop sequences. Unsupported controls must not be invented or sent.

Attachments are stable artifact IDs. Ready files up to 4 MiB are sent inline; larger files use the Gemini Files API. Valid remote references may be reused until near expiry. Stale-generation/cancellation guards prevent obsolete preparation from mutating artifact metadata.

The organic-memory classifier is not a second conversational agent. It receives a bounded user-message payload plus a dedicated classifier instruction, exposes no tools or thread memory, has an eight-second timeout and 4,000-character output ceiling, and returns exact-span candidates with domain, human memory category, and coarse salience metadata. Those labels remain powerless until `SYS-MEM` revalidates the exact evidence and applies user-owned remembering/category policy.

## 5. Invariants

- One canonical browser Gemini provider path; never add `generateContent` fallback or a competing chat/classifier provider.
- API keys come through `SYS-SEC / security.md`, never a `VITE_*` browser variable.
- Empty Character Master means omit `system_instruction`, not inject a default persona.
- Interactive chat defaults to thread-scoped memory composition when companion memory is enabled and recall style is not `direct-only`; `natural` receives only query-relevant durable context, while `proactive` may additionally receive at most one non-sensitive established continuity anchor after relevant context. Callers that own their context use `memoryContext: 'none'`.
- Deliberate conversational recollection is a browser tool capability (`memory.recall`), not a second provider or persona prompt.
- Internal classifier calls never inherit Character Master, conversation memory or the interactive tool surface unless their owning system explicitly requires it.
- Tool declarations come from the registered executable capability surface; schemas contain no secrets.
- Structured tool/media/artifact events remain structured through the chat boundary.

## 6. Security and failure semantics

Empty or locked Lockbox state yields explicit configuration failures. Provider exceptions are normalized; cancellation resolves promptly even if the network stream is idle. Function arguments are parsed as objects after streaming assembly. Attachment MIME/readiness is revalidated at the provider boundary.

The organic-memory classifier is treated as an untrusted selector, not an authority. Provider failure, cancellation, timeout, oversized output or invalid JSON fails the classifier closed and does not fail an already-saved chat response. Exact evidence validation, sensitive-category downgrade protection, remembering-style thresholds, category permission and persistence authority live in `SYS-MEM`.

The app may expose provider-produced thought summaries, but it does not treat hidden reasoning/signatures as a user-editable second transcript.

The interactive tool loop has two independent governors: a call-count ceiling and a gross-input/model-interaction ceiling. Gross accounting never subtracts cached tokens for safety. Before a continuation is dispatched, the governor estimates the serialized pending tool-result payload and adds it to the latest measured inherited context; large Gmail/Docs/tool results therefore cannot hide behind a history-only heuristic. As a chain grows, the application keeps a bounded deterministic checkpoint of semantic tool observations—including bounded message/document evidence, mutation-critical ETags and pagination cursors—preserves external-data taint and existing mutation/confirmation authority, severs `previous_interaction_id`, and resumes from a fresh interaction. Collection projection retains a bounded prefix plus an explicit omitted-item/truncation marker. Because compaction is intentionally lossy, duplicate-read suppression is reset for the fresh chain so it may repeat an exact read to recover omitted current-page evidence; normal same-chain duplicate suppression resumes after that reread succeeds. Compaction and terminal synthesis are admitted from the actual constructed fresh-request estimate, including system instruction and mounted tool declarations, rather than a fixed reserve alone. An exact successful read is otherwise skipped only while no newer successful tool evidence has appeared; a different successful read or mutation advances the evidence epoch and permits an evidence-driven recheck. If another exploratory call would exceed the hard local budget, the loop uses a fresh no-tools synthesis only when that exact request still fits, otherwise a deterministic local fallback without contacting Gemini.

## 7. Verification and tests

Use `src/gemini/*.test.ts`, tool-loop integration/read-only/runtime-context tests, multimodal tests, model/settings tests and the repository reliability gate. `memory-observer.test.ts` additionally pins the organic classifier's no-tools/no-memory contract, strict JSON handling, provider completion requirement and output ceiling. The gate explicitly forbids legacy `generateContent`, Worker routing for browser chat and obsolete SDK API-version configuration.

## 8. Known gaps

Provider/model capabilities must be revalidated against current Google documentation before registry changes. Background/cloud execution shares contracts where useful but must not drift into a second interactive provider architecture. Phase 3 organic observation is uncertified until its exact PR head passes the repository CI pipeline.
