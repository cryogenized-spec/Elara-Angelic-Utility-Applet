# Prompt 20 — Character Portrait

## Status

Accepted as the canonical character-portrait feature boundary.

## Goal

The character portrait is durable presentation state, not chat content and not an attachment-provider concern.

## Responsibilities

`appearance/` owns portrait state and presentation policy:

- built-in default portrait;
- user-selected custom portrait;
- replacement;
- explicit removal/reset to default;
- enlarged viewing;
- 1x–3x display scaling;
- loading/error/fallback states.

The UI renders the portrait through focused appearance interfaces. It does not reach into Dexie tables directly and does not upload the portrait through the Gemini attachment pathway.

## Data model

The logical portrait record should contain only the minimum durable state, such as source kind, stable asset reference, display scale, created/updated timestamps, and optional safe metadata. Binary data may be stored through the selected local asset strategy, but the conversation message model must never own the portrait asset.

## Display scale

Portrait zoom is constrained to an explicit product range of 1x–3x. Scale is presentation state and must not alter source asset data.

The enlarged portrait should use an accessible dialog/lightbox pattern with keyboard/back-button escape, focus management, and a sensible reduced-motion behavior.

## Replacement and removal

Replacing a portrait must be atomic from the UI's perspective: the previous valid portrait remains usable until the new portrait is accepted. Removing a custom portrait restores the default portrait rather than creating an invalid empty state.

## Performance

Portrait assets must be sized and decoded intentionally. Avoid eagerly decoding multiple high-resolution versions. Use appropriately sized derivatives or responsive rendering where supported, and revoke temporary object URLs after replacement/removal when local browser URLs are used.

## Privacy/security

The portrait is user-owned presentation data. It is not sent to Gemini automatically, not included in analytics, and not copied into diagnostics. A future feature could explicitly attach an image, but that would be an explicit user action through the attachment boundary.

## Future character system prompt

The portrait and the character master system instruction are related product concepts but separate technical concerns. The portrait is appearance state; the master prompt is provider request configuration. Neither should be implemented as a hidden field on conversation messages.

## Completion criterion

Elara has a single durable portrait state with default/custom/replacement/removal semantics, bounded 1x–3x scaling, accessible enlargement, and clean separation from Gemini chat attachments and persona prompting.