# Prompt 15 — ChatGPT-Style Composer

## Status

Accepted as the composer interaction contract for the mobile-first chat UI.

## Responsibilities

The composer owns text entry, draft state, submission intent, cancellation affordance, attachment affordance, voice affordance, disabled/loading presentation, and keyboard/focus behavior.

It does not own Gemini requests, persistence, tool execution, or message lifecycle decisions. Submission is handed to the chat/application boundary.

## UX contract

The composer is a multiline input with a compact action row. Enter/newline behavior must be deliberately configurable for touch/physical-keyboard environments; sending should be an explicit, accessible action rather than an accidental keystroke on Android.

While generating, the composer transitions to a cancellation-oriented state without destroying the unsent draft. A cancelled or failed generation must not silently erase the user's message.

The attachment and voice actions are capability-aware. If browser support or permissions are unavailable, the action is disabled with a clear explanation rather than rendered as a broken control.

## Mobile keyboard behavior

The input should grow within bounded limits, then become internally scrollable. The overall page should not jump as the draft grows. Focus remains on the composer after sending only when it does not conflict with the current request lifecycle.

The shell uses visual-viewport/safe-area-aware layout rather than assuming a constant device viewport. Safe-area insets are handled with standards-based CSS environment variables. citeturn339022search3

## Draft ownership

Draft text is ephemeral UI state until submission. Once submitted, the chat/application boundary creates the authoritative user message and persistence commits it. The composer does not write directly to Dexie.

## Error handling

Invalid/empty submissions are blocked locally. Provider/network failures are reported by chat state and remain visible elsewhere in the conversation UI; the composer is not a generic error dispatcher.

## Attachments

The attachment button hands files to the attachment boundary. The composer renders lightweight attachment chips/previews supplied by application state and exposes remove/retry interactions. It does not inspect provider payloads.

The file chooser should use appropriate `accept` values as hints but validation must occur in the attachment boundary because `accept` does not itself validate a selected file. citeturn339022search1turn339022search5

## Voice

The microphone action delegates to the voice-to-text capability boundary. The composer displays recording/listening/error state but does not instantiate recognition APIs itself.

## Future tools and Workspace

Tool calls/results appear in the conversation surface and never become hidden composer actions. Google Workspace side effects remain service/tool concerns and later require explicit confirmation.

## Accessibility

The composer must have a programmatic label, visible focus treatment, clear disabled/busy states, accessible attachment previews/removal controls, and a live status region for recording or send failures where appropriate.

## Prompt 15 completion criterion

The composer has a clear UX/state contract that keeps draft text, attachments, voice input, generation cancellation, keyboard behavior, and accessibility in the UI boundary while delegating application/provider work to the established modular layers.
