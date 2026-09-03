# Elara Angelic Utility Applet

A clean-room rebuild of Elara: a mobile-first AI companion/chat application centered on Google's current Gemini Interactions API.

This repository is intentionally independent of the archived Elara repositories. The archived implementation may be referenced for lessons, feature history, and proven UX ideas, but it is not a code migration source and legacy execution paths must not be carried forward.

## Initial product direction

The first release is a focused Android-portrait-first chat application with:

- Gemini-powered conversational chat
- one canonical Gemini provider/API path
- streamed text responses
- supported Gemini thinking summaries
- model-aware generation settings
- voice-to-text input
- image and document attachments
- character portrait and portrait scaling
- customizable application background
- light, dark, and system appearance
- local conversation persistence
- secure configuration and secret handling through a Lockbox boundary
- structured diagnostics for HTTP, provider, network, and timeout failures
- privacy-conscious analytics

Google Workspace integrations (Calendar, Tasks, Docs, and Chat) are planned capabilities, not a reason to complicate the initial chat foundation. Google Keep is explicitly out of scope.

Background/durable execution will be introduced only after the normal chat path is stable and will prefer Gemini's native Interactions background execution where it is sufficient.

## Architectural principles

1. One owner per responsibility.
2. One Gemini API method. No legacy GenerateContent fallback and no duplicate provider clients.
3. Model capabilities are data-driven; the UI must never expose unsupported settings.
4. Mobile portrait is the primary design target. Desktop is an adaptation.
5. UI components do not own database, provider, OAuth, or secret-management internals.
6. Modules stay small and responsibility-focused. Avoid monolithic components and generic manager/util layers.
7. External inputs are validated at boundaries.
8. Errors are first-class data with safe diagnostics, request IDs, timing, retryability, and HTTP/provider status where available.
9. Persisted state has one authoritative store and an explicit migration/recovery strategy.
10. Advanced features are added as vertical slices after the core chat spine is proven.

## Reference repository

The archived `Elara-Companion-current` repository is a reference specimen only. It demonstrated useful functionality, but also accumulated substantial complexity across multiple runtime paths, Express/server infrastructure, background execution, memory, Workspace, Google integrations, compatibility surfaces, and architectural enforcement. The new repository deliberately starts smaller.

## Prompt-driven build process

Development is being conducted through numbered implementation prompts. Each prompt should make a small, verifiable change and leave the repository in a working state.

Prompt 1 established the clean-room repository forensics and architectural direction.
Prompt 2 defines the exact initial product boundary in `docs/PRODUCT_BOUNDARY.md`.

The first implementation phase is the minimal vertical chat slice. Large subsystems must not be introduced before the core request/stream/persistence path is proven.

## Gemini safety and creative context

The application is intended for legal fictional and creative writing/roleplay. The Gemini integration must follow the exact safety capabilities of the pinned Interactions API/SDK version. Where configurable Gemini safety settings are supported, the application's intended policy is `BLOCK_NONE` for the supported configurable categories. The implementation must never send unsupported safety fields simply because another Gemini API surface accepts them.

A single centralized system instruction will explicitly establish the fictional/creative context without attempting to override provider safety policy.

## Product boundary

The authoritative v1 product scope is documented in [`docs/PRODUCT_BOUNDARY.md`](docs/PRODUCT_BOUNDARY.md). New implementation work must be checked against that document before adding scope.

The v1 success criterion is deliberately simple: open Elara on Android portrait, start a conversation, send a message, receive a streamed Gemini response with supported thinking summaries, persist it, close/reopen the app, recover the conversation, and receive useful diagnostics rather than an indefinite spinner when network/provider/timeout failures occur.
