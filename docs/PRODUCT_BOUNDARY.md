# Prompt 2 — Product Boundary

## Purpose

This document defines the exact initial product boundary for Elara Angelic Utility Applet.

The project is a clean-room rebuild. The archived Elara implementation may be consulted for lessons and proven ideas, but its architecture, source layout, compatibility surfaces, and legacy execution paths are not dependencies of this project.

## Product definition

Elara Angelic Utility Applet is a mobile-first AI companion/chat application centered on Google's current Gemini Interactions API.

The primary experience is an Android portrait chat application. Desktop support is a secondary adaptation of the same product, not the design baseline.

## v1 must include

### Chat

- Create and continue conversations.
- Send text messages.
- Receive streamed Gemini responses.
- Display supported Gemini thinking summaries.
- Cancel an in-progress generation.
- Recover cleanly from provider, network, and timeout failures.
- Retry only when the failure is safely retryable.
- Persist completed and recoverable conversation state locally.

### Gemini

- One canonical Gemini provider implementation.
- Current Gemini Interactions API only.
- One normalized internal request contract.
- One normalized internal streaming-event contract.
- Model selection.
- Capability-driven model settings.
- Model-specific generation controls only when supported by the selected model.
- Thinking controls only when supported by the selected model.
- Explicit creative/fictional system context.
- Exact provider error/status preservation at the diagnostic boundary.

### Input

- Mobile multiline text composer.
- Android keyboard-friendly interaction.
- Voice-to-text input.
- Attachment picker.
- Image attachments.
- Supported document attachments, with PDF as a primary target.
- Attachment preview, validation, progress, failure, and removal.

### Character presentation

- Persistent character portrait.
- Default portrait.
- Custom portrait upload.
- Portrait replacement/removal.
- Enlarged portrait viewing.
- Portrait scale from 1x through 3x.

### Appearance

- Light theme.
- Dark theme.
- System theme.
- Custom application background image.
- Background readability treatment for chat content.
- Persisted appearance settings.

### Persistence

- Local authoritative persistence for conversations and settings.
- Explicit schema/version boundary.
- Migration support.
- Corruption-safe recovery.
- No competing persistence authorities.

### Security and configuration

- Central configuration boundary.
- Lockbox classification for secrets/configuration.
- No application-owned Gemini secret embedded in the browser bundle.
- No secrets in logs, analytics, diagnostics, or normal persisted application state.

### Diagnostics and analytics

- Structured request lifecycle state.
- Structured HTTP/provider/network/timeout diagnostics.
- Request IDs where available.
- Timing information.
- Retry information.
- Safe diagnostic export.
- Privacy-conscious product analytics.
- No message-content analytics by default.

## Explicitly out of v1

The following are deliberately excluded from the initial product foundation:

- Long-term memory/consolidation systems.
- Workspace/artifact/revision systems.
- Complex agent/plugin registries.
- Automation scheduling and execution infrastructure.
- Google Workspace integrations.
- Google Keep.
- Multiple Gemini execution paths.
- Legacy GenerateContent runtime.
- A separate Express production server unless a concrete requirement later justifies it.
- Cloudflare Workflows before the normal chat path is proven.
- Multiple databases or replicated browser persistence stores.
- Architectural compatibility layers preserved solely for historical code.
- Large framework-specific abstraction hierarchies.

## Planned later capabilities

After the core chat spine is proven, the product may add the following as independent vertical slices:

1. Google OAuth and Google Calendar.
2. Google Tasks.
3. Google Docs.
4. Google Chat.
5. Gemini-native background interactions and, only if required, additional durable orchestration.
6. More advanced agent/tool capabilities.
7. Long-term memory.
8. Additional companion/character capabilities.

Each later capability must have an explicit owner and must attach to the existing application/provider/persistence boundaries without creating parallel authorities.

## Non-negotiable product rules

### Mobile first

Android portrait is the primary viewport and interaction target.

The composer, keyboard behavior, scrolling, touch targets, safe areas, portrait presentation, attachments, and dialogs must all be designed and tested for narrow portrait screens before desktop adaptation.

### One Gemini path

There is exactly one canonical Gemini API integration.

Do not implement a modern path plus a legacy fallback.

Do not keep an older provider around for compatibility.

Do not let UI code construct Gemini requests directly.

### Capability-driven settings

Gemini settings are determined by model capability metadata.

The UI must not display a control that the selected model cannot use, and the provider adapter must not send unsupported fields.

### One authoritative state per domain

A domain has one authoritative state owner.

Derived UI state, cached projections, and diagnostics may exist, but they must not become competing sources of truth.

### Small modules

Prefer small, focused modules with one responsibility and one reason to change.

Avoid monolithic components, generic managers, generic utility dumping grounds, and cross-domain mutable state.

### Observable failure

A provider or network failure must produce a visible, diagnosable state rather than an indefinite loading state.

### Incremental construction

Features are added one vertical slice at a time.

A later feature must not become a prerequisite for validating the basic chat flow.

## Core v1 success criterion

The first complete success path is:

1. Open Elara on Android portrait.
2. Start a conversation.
3. Select a supported Gemini model.
4. Send a text message.
5. Construct one canonical Interactions request.
6. Stream the response.
7. Display supported thinking summaries.
8. Persist the conversation locally.
9. Close/reopen the application.
10. Recover the conversation and its state without ambiguity.
11. Deliberately trigger a provider/network/timeout failure and receive a useful diagnostic instead of a stuck spinner.

Until this path is reliable, advanced capabilities should not become architectural prerequisites.
