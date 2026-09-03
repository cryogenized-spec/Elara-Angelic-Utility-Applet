# Prompt 21 — Appearance System

## Status

Accepted as the single appearance/presentation state boundary.

## Supported modes

Elara supports three theme modes:

- `light`
- `dark`
- `system`

The effective theme is derived from the persisted user preference plus the operating-system preference when `system` is selected. Components consume effective appearance state; they do not each implement their own theme detection.

## Background image

A user may choose a custom background image. The appearance domain owns the source reference, enabled/disabled state, readability treatment, and safe loading/fallback behavior.

Background images are presentation assets, not Gemini attachments. Choosing a background must never cause a provider request.

## Readability layer

The chat surface must support a dedicated readability treatment between the background and foreground content. The treatment can adapt to light/dark mode while remaining visually subordinate to the conversation.

The implementation should prefer CSS compositing and inexpensive opacity/gradient layers over per-message image processing.

## Persistence

Appearance preference, background reference, readability setting, and portrait display scale are persisted through the single authoritative persistence boundary. UI components do not open storage directly.

## Mobile-first behavior

Android portrait remains the baseline. Appearance surfaces must respect safe areas and not create horizontal overflow when system UI, keyboard, or browser chrome changes the available viewport.

## Accessibility

Theme changes must preserve readable contrast and visible focus. A background image may never reduce text/action legibility below the product's accessibility target. Motion-heavy transitions must honor the user's reduced-motion preference.

## Loading/failure

An unavailable background asset falls back to the default appearance without breaking the chat screen. A failed portrait asset uses the default portrait path. Appearance failures remain isolated to presentation state and do not alter conversation/provider state.

## Ownership

Appearance owns theme, background, readability, and portrait presentation state. It does not own chat messages, Gemini configuration, provider calls, attachment transfer, OAuth, or tool execution.

## Future compatibility

The character's master system instruction is not appearance state and must remain outside this module. Likewise, a future memory/notes system may influence conversation context but must not control the visual appearance domain.

## Completion criterion

Theme, background, readability, and portrait presentation are controlled by one small appearance boundary with persisted preferences, failure-safe fallbacks, and no provider/storage logic leaking into UI components.