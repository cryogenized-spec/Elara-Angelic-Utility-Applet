---
id: SYS-CHAT
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: conversation state and generation lifecycle
paths: [src/chat, src/domain/chat.ts, src/persistence/conversation.ts]
keywords: [chat, conversation, thread, generation, retry, lineage, markdown]
---

# Chat

## 1. Purpose and boundary

`SYS-CHAT` owns conversation/thread semantics, message metadata, generation lifecycle, retry/regeneration lineage, title generation and conversation recovery. It consumes `SYS-GEM / gemini.md` through the turn port and persists through `SYS-PERSIST / persistence.md`; it does not own provider SDK construction or UI rendering.

## 2. Runtime architecture

```text
user submit
-> persist user message
-> generation state/arbiter
-> Gemini tool loop
-> normalized stream events
-> assistant message + metadata
-> persist final/cancelled/failed state
```

`src/chat/generation-state.ts` and `generation-sync.ts` coordinate active generations and prevent superseded work from winning races. `turn-lineage.ts` records regeneration ancestry; `turn-watchdog.ts` bounds stalled turns; `thread-title-port.ts` isolates AI-generated thread naming.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Message/thread types | `src/domain/chat.ts` |
| Thread/message repository | `src/persistence/conversation.ts` |
| Generation state | `src/chat/generation-state.ts` |
| Generation synchronization | `src/chat/generation-sync.ts` |
| Regeneration lineage | `src/chat/turn-lineage.ts` |
| Stalled-turn watchdog | `src/chat/turn-watchdog.ts` |
| Thread naming | `src/chat/thread-title-port.ts` |
| Rendering | `src/app/components/ConversationSurface.tsx` |

## 4. Data and contracts

`ChatMessage` stores text plus optional stable artifact IDs, structured media, execution summary and provider-turn metadata. Provider metadata records Gemini model/interaction identity, timings, usage, generation identity and supersession identity. Binary attachments do not live in messages.

Threads are durable records with title/timestamps/archive state. The `primary` thread cannot be archived or deleted. Thread titles are validated to 1–80 characters. Search currently matches thread titles.

<a id="markdown"></a>
### Markdown

Assistant text uses `MarkdownText.tsx`: GFM is enabled, raw HTML is skipped, the allowed element set is restricted, and links survive only when `safeMarkdownUrl()` accepts HTTPS. Rendering is memoized so unchanged transcript content is not repeatedly parsed.

## 5. Invariants

- Persist user intent before provider execution when durability matters.
- One active generation lineage may win; stale/superseded completions must not overwrite newer state.
- Tool/media/artifact output is structured data, never reconstructed by parsing assistant prose.
- Raw provider event streams are not conversation storage.
- Thought summaries may be surfaced as bounded execution metadata; hidden chain-of-thought is not a chat data model.

## 6. Security and failure semantics

Provider errors are normalized before presentation. Cancellation and timeout are terminal states rather than infinite loading. Markdown ignores raw HTML and rejects non-HTTPS links. Message records never contain API keys, OAuth tokens or artifact binary payloads.

## 7. Verification and tests

Use `src/chat/*.test.ts`, persistence tests, `MarkdownText.test.tsx`, conversation component tests and E2E chat/regeneration flows. Cross-system provider behavior is verified by `SYS-GEM`; storage migrations by `SYS-PERSIST`.

## 8. Known gaps

Search is title-oriented rather than full transcript search. `App.tsx` still coordinates significant chat orchestration. Keep future branching/search/archive UX inside this boundary without creating a second conversation store.
