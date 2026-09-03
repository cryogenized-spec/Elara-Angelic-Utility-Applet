# UI Pass 5 — Sidebar menu + chat threads

Status: **implementation complete; CI validation pending/authoritative**.

Pass 5 turns the sidebar from a static visual shell into an application-owned conversation surface. Conversation threads are now first-class local records, messages carry their owning conversation ID, and the active thread survives a reload through a small UI preference in localStorage.

## Implemented behavior

The sidebar now provides a New chat action, title search, thread selection, rename, archive, and delete affordances. The presentation layer receives typed `ConversationThread` records and callbacks; it does not import Dexie or provider code. The existing glass/frosted slide-in behavior and portrait-collapse relationship remain intact.

A newly created conversation starts with the metadata title `New conversation`. Its first meaningful user message invokes the `ThreadTitlePort` contract. The current executable slice uses a deterministic local demo implementation because the production Gemini provider is intentionally not yet wired into the runtime. The contract itself is deliberately narrow so the future canonical provider can replace only the title-generation adapter. Generated titles are constrained to 3–10 words in the normal path and are metadata rather than injected chat content.

Dexie now has a version-2 schema with a `threads` table and a `conversationId` message index. Existing version-1 messages are migrated into the primary thread. Thread mutations are transactional with their message ownership changes where applicable.

The application restores the last active thread from localStorage, but conversation records and messages remain authoritative in Dexie. Thread selection, creation, rename, archive, and deletion all flow through the application boundary rather than directly from presentational components into persistence.

## Reliability correction discovered during Pass 5

The previous Pass 4 CI run exposed an accessibility-test regression: the execution summary section no longer had a semantic region name. That contract is now restored with an explicit `aria-label="Execution summary"`, and the toggle has an explicit accessible name matching the Playwright assertion.

## Deferred by design

Production AI thread-title generation still belongs behind the canonical Gemini Interactions provider boundary. It is intentionally not implemented as a second model client or as a UI-side API call. Search currently matches persisted thread titles; message full-text search is not part of this pass. Quick Workspace actions remain Pass 6 work.

## Validation

Required gates: lint, typecheck, unit tests, build, Playwright E2E, and the final repository reliability gate. The authoritative CI run for the Pass 5 implementation must complete successfully before Pass 5 is marked green.
