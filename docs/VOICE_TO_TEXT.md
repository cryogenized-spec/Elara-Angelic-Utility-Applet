# Prompt 16 — Voice-to-Text

## Status

Accepted as the browser voice-input contract.

## Capability boundary

Voice input is an optional browser capability. The voice module owns feature detection, recognition lifecycle, permission-related failures, interim/final transcript handling, and cleanup.

The composer consumes a small interface such as:

```ts
interface VoiceInputController {
  start(): void;
  stop(): void;
  cancel(): void;
  readonly state: 'unsupported' | 'idle' | 'listening' | 'stopping' | 'error';
  onTranscript(listener: (text: string, final: boolean) => void): () => void;
}
```

This is an architectural shape; exact runtime types belong in the application scaffold.

## Browser support

`SpeechRecognition` is not a universally available baseline feature. MDN currently marks it as limited availability, and on some browsers recognition uses a server-based speech service rather than working offline. citeturn957008search8

Therefore Elara must perform runtime capability detection and must never assume Android browsers all expose the API.

## User experience

The microphone control has explicit idle/listening/stopping/error states. Starting recognition gives immediate feedback. Stopping recognition preserves the last final transcript; cancellation discards the active recognition session without losing the existing text draft.

Interim transcripts may update the composer while recognition is active, but only finalized text is treated as committed voice input. The voice layer does not submit messages directly.

## Permissions and privacy

Permission failures are user-visible but should not expose browser exception internals. No audio recording is persisted by this capability. Voice transcript content remains composer draft data until the user explicitly submits it.

## Error semantics

Handle unsupported browser, permission denied, recognition unavailable, aborted session, and unexpected recognition error as distinct capability states. Never leave the microphone control in a permanent listening state after recognition ends or fails.

## Cleanup

Recognition listeners are detached when the controller stops, cancels, errors, or unmounts. Repeated start/stop cycles must not accumulate event listeners.

## Future architecture

Voice input is an input modality, not an AI provider. It does not call Gemini, create tool calls, access Google Workspace, or write memory notes. Final transcript enters the normal composer → chat → provider pipeline.

## Prompt 16 completion criterion

Voice-to-text has a capability-detected, failure-aware browser boundary that can plug into the composer without coupling speech recognition to Gemini, persistence, tools, Workspace, or memory systems.
