# Prompt 1 — Repository Forensics

## Scope

This document records the clean-room assessment of the archived `Elara-Companion-current` repository. It is reference material only. No source code is being migrated into this repository.

## What the archived application became

The archived application is a mature React/Vite application centered on Gemini chat, but it now contains many additional domains and infrastructure layers: conversations, local Workspace, structured memory, revision history, agent tooling, Google authorization and Workspace integrations, server/runtime abstractions, background execution, Cloudflare Worker/Workflow infrastructure, diagnostics, resilience/failover, automation infrastructure, and architectural verification.

Its package configuration combines a Vite frontend, an optional Node/Express production server, and a separate background-runtime package. This creates several deployment and execution concerns around what is fundamentally a chat client.

## Functionality worth carrying forward

- Mobile-first chat experience and composer concepts.
- Streaming Gemini responses.
- Visible thinking/reasoning summaries when the provider supplies them.
- Model selection and model-sensitive settings.
- Character portrait presentation and adjustable size.
- Custom background/appearance controls.
- Local conversation persistence.
- Attachment concepts for multimodal input.
- Structured error/diagnostic thinking.
- Google Workspace capability model and incremental authorization concept.
- Lockbox/secret classification concept.
- Durable background execution as a later capability.

## Functionality deliberately deferred from the initial foundation

- Long-term memory and consolidation.
- Workspace/artifact/revision systems.
- Complex multi-plugin agent registries.
- Google Keep.
- Automation scheduling/dispatch/execution infrastructure.
- Separate Express production server unless a concrete requirement emerges.
- Multiple background runtimes or orchestration layers.
- Compatibility facades retained solely for historical callers.
- Large architectural test suites that encode implementation structure instead of behavior.

These may return later as independent vertical slices, but they must not become prerequisites for the basic chat path.

## Architectural problems to avoid

### Multiple execution paths

The archived project accumulated browser, server, and background execution paths. A migration could therefore appear correct while a test, route, or component was still targeting an obsolete path.

New rule: one canonical Gemini provider implementation and one canonical application execution path for normal chat.

### Provider/API duplication

The archived code contains both generic Gemini runtime infrastructure and an Interactions-specific implementation, with compatibility/testing surfaces around them.

New rule: pin one supported Gemini SDK/API version and build one provider boundary around the current Interactions API. No legacy GenerateContent implementation should remain as a fallback execution mechanism.

### Too many boundaries for simple responsibilities

The archived project contains application, service, runtime, infrastructure, compatibility, and historical layers for many concerns. Boundaries are valuable only when they isolate an actual responsibility.

New rule: each module gets one clear responsibility and one reason to change.

### Deployment architecture grew faster than product value

The project includes an Express server and separate Cloudflare Worker/Workflow infrastructure. This can make local debugging and static deployment confusing, especially when browser and server routes diverge.

New rule: begin with the smallest deployment architecture that securely supports the product. Add durable background infrastructure only after normal chat is proven.

### Tests became architectural baggage

The archived repository contains a large production verification suite. Some failures arose because tests described an older runtime contract after the implementation had intentionally moved on.

New rule: prioritize behavior, boundary contracts, provider request-shape tests, and a small number of high-value end-to-end tests. Avoid tests that exist primarily to enforce historical module topology.

## Gemini-specific findings

The archived Interactions translator correctly moved provider generation fields to the Interactions request contract and added thinking-summary configuration. It also discovered an important API distinction: the Interactions API must not be assumed to support every safety field accepted by other Gemini API surfaces.

New rule: the provider adapter must be written against the exact pinned SDK/API contract and tested directly. Unsupported fields must be omitted rather than guessed.

The creative-roleplay system framing should remain centralized and explicit, but it must be treated as application context rather than a mechanism for bypassing provider policy.

## Google integration findings

The archived Google authorization implementation demonstrates a useful pattern: one browser-side OAuth authority, persisted granted-scope metadata, and incremental capability authorization using Google Identity Services.

New rule: keep one OAuth authority and a centralized scope registry. Start with identity scopes and request Calendar, Tasks, Docs, and Chat capability scopes only when the corresponding features are actually used. Google Keep is out of scope.

## Performance observations

The archived codebase has accumulated many dependencies and feature modules. The new project should keep the initial bundle small and avoid expensive subsystems until required.

Mobile Android portrait behavior should be treated as the primary runtime rather than a responsive afterthought.

## Clean-room architecture conclusion

The new Elara application should be constructed from a minimal vertical slice:

Android portrait UI
→ conversation state
→ canonical Gemini Interactions provider
→ normalized streaming events
→ local persistence

Everything else must attach to this spine as an independent, testable capability.

The first success criterion is deliberately boring: type a message, receive a streamed Gemini response, see supported thinking summaries, refresh/close/reopen the application, and recover the conversation without ambiguity.
