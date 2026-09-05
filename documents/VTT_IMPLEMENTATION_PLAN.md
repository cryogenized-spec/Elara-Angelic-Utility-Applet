# Elara VTT — Voice-to-Text Implementation Plan

## Objective

Make Elara's voice-to-text feature reliable and production-ready while preserving the repository's single-provider architecture and the existing protected Gemini Worker boundary.

The user experience is deliberately **record → stop → transcribe → insert**. The microphone signal visualization is local and immediate; Gemini is responsible for transcription, not the animation.

## Architecture decisions

### Keep

- Browser microphone capture through `MediaRecorder`.
- Local Web Audio `AnalyserNode` RMS measurement.
- The existing VTT capability boundary in `src/vtt`.
- The existing Cloudflare Worker as the only place that holds the Gemini API key.
- Gemini `gemini-3.5-transcribe` for recorded/turn-based transcription.
- Gemini Smart transcription mode for natural punctuation, capitalization, disfluency cleanup, and useful formatting.
- Selection-aware insertion into the active composer.
- No automatic chat submission after transcription.
- No audio persistence in Dexie, IndexedDB, localStorage, or application analytics.

### Change / correct

- Replace the current three-bar meter that overlays the microphone icon with a dedicated recording banner above the text editor.
- Use a real animated waveform/oscilloscope-style visualization driven by local RMS/time-domain audio data.
- Show a clear elapsed recording timer in the banner.
- Give the recording state an unambiguous Stop control; the idle microphone remains the start control.
- Make repeated dictation deterministic: after insertion, the caret lands immediately after the inserted transcript so the next recording inserts there.
- Harden browser MIME negotiation and normalize the MIME passed to Gemini instead of blindly forwarding codec parameters that the provider may not require.
- Prefer inline audio in the Worker for short dictation clips, using the Interactions API audio `data` + `mime_type` contract. Use the Files API only if real-world clip sizes require it; this must not create a second provider abstraction.
- Keep recording infrastructure separate from React UI state. Do not introduce a competing React recording subsystem merely as a convenience hook.

### Do not adopt

- Browser `SpeechRecognition` as the transcription engine.
- Gemini Live transcription/WebSocket/PCM architecture for this feature revision. Live transcription is a separate, low-latency product path and would unnecessarily replace the simple recorded-utterance contract.
- A second Gemini SDK/provider path.
- Raw audio logging or persistence.
- A UI-level fake meter disconnected from the real microphone signal.

## User experience

When idle, the composer shows its normal microphone button.

When tapped:

1. Capture the active editor's selection/caret immediately.
2. Request microphone permission when necessary.
3. Start MediaRecorder using a browser-supported voice recording format and a voice-appropriate bitrate target.
4. Insert a dedicated recording banner directly above the text editor.
5. Show an elapsed timer such as `00:14`.
6. Draw a continuously updating local RMS/time-domain waveform from left to right across the banner.
7. Show an unmistakable active-listening state and a Stop button.
8. On Stop, finalize the Blob, release microphone/audio resources, and send only the captured audio to the Worker.
9. Transcribe through `gemini-3.5-transcribe` in Smart mode.
10. Optionally transform the faithful transcript into a clearer `Polish` message or concise `Roleplay` action/narration before insertion.
11. Insert only the returned/transformed text at the original selection/caret, replacing a captured selection where applicable.
12. Place the caret immediately after the inserted text.
13. Return to the normal composer state without sending the message.

The same behavior must work in the compact composer and expanded editor.

## Implementation passes

### Pass 1 — Recording engine and signal foundation

Rework the existing `src/vtt/recording.ts` without creating a parallel microphone implementation.

Deliver:

- capability-driven MediaRecorder MIME selection;
- clear recorder lifecycle and state transitions;
- explicit microphone permission/error handling;
- clean stream/track teardown on stop, cancel, failure, and unmount;
- recording duration accounting;
- maximum recording guard;
- minimum-duration / tiny-capture guard;
- sustained-silence auto-stop safeguard;
- RMS/time-domain signal sampling with a UI-friendly signal data contract rather than only a three-level meter;
- correct audio context/analyser lifecycle;
- cancellation that cannot leave pending promises or live tracks behind;
- haptic feedback where the platform supports it.

Tests:

- MIME capability selection;
- permission denial;
- unsupported microphone APIs;
- start/stop/cancel;
- short/empty capture rejection;
- maximum duration;
- sustained silence;
- analyser cleanup;
- stream track cleanup;
- state transitions.

Pass 1 must not require a Gemini call.

### Pass 2 — Recording banner and waveform UI

Replace the current microphone-button meter with a dedicated `RecordingBanner`-style UI component integrated into the existing composer architecture.

Deliver:

- banner positioned immediately above the text editor;
- responsive mobile-first layout;
- elapsed timer;
- animated canvas waveform using `requestAnimationFrame` and the real local microphone signal;
- restrained Elara pearlescent/iridescent treatment with glass/translucent surfaces;
- clear active-listening indicator;
- large, reliable Stop touch target;
- reduced-motion behavior;
- no waveform overlay on the microphone icon;
- correct layout in both normal and expanded composers;
- accessible status and Stop control labels.

The waveform must be local signal visualization only. It must not imply that Gemini is receiving or decoding audio in real time.

### Pass 3 — Gemini transcription boundary and adapter

Correct the existing Worker transcription path against the current official Gemini Interactions API contract.

Deliver:

- validated `/api/transcribe` request boundary;
- strict origin policy consistent with the existing Worker;
- explicit VTT request-size ceiling;
- supported audio MIME validation;
- inline audio submission for ordinary short clips;
- `gemini-3.5-transcribe` model;
- Smart transcription mode;
- concise transcription instruction requiring only the direct transcript, with no meta-commentary;
- normalized JSON response containing only safe transcript data;
- provider/network error normalization;
- no secret/audio leakage in diagnostics;
- explicit cleanup for any temporary provider resource if Files API is ever required.

The browser must never receive the Gemini API key.

### Pass 4 — Cursor-aware composer integration

Connect the recorder, banner, Worker adapter, and existing draft insertion helper.

Deliver:

- capture selection before permission/recording starts;
- insertion at the original selection/caret;
- replacement of selected text;
- whitespace handling without concatenating words or destroying intentional newlines;
- caret placement immediately after inserted transcript;
- second/third consecutive dictation inserted at the new caret;
- compact and expanded editor parity;
- no automatic send;
- no accidental draft loss while recording or processing.

### Pass 5 — Reliability, security and edge cases

Exercise all failure paths and harden recovery:

- microphone denied/unavailable;
- unsupported MediaRecorder format;
- no speech / near-empty capture;
- silence auto-stop;
- maximum duration;
- manual stop;
- cancellation while recording;
- cancellation while transcribing;
- provider failure;
- network failure;
- timeout;
- empty transcript;
- component unmount during recording/transcription;
- repeated recording sessions;
- expanded-editor state changes;
- no credential/raw-audio logging;
- correct CORS and request validation.

### Pass 6 — E2E and Android/PWA validation

Extend Playwright coverage for desktop Chromium and Android portrait geometry.

Verify:

- microphone permission flow;
- banner appearance/disappearance;
- timer updates;
- waveform activity;
- Stop action;
- successful transcript insertion;
- cursor placement;
- selected-text replacement;
- repeated dictation;
- expanded editor;
- auto-stop;
- cancellation;
- error recovery;
- accessibility labels;
- reduced-motion behavior;
- PWA/service-worker environment compatibility.

A real Android physical-device test remains the final production-readiness check because microphone permissions, PWA lifecycle, MediaRecorder implementation, vibration support, audio routing, and browser MIME support are device-dependent.

### Pass 7 — Intentful VTT draft transformation

Add optional post-transcription transformation while preserving the faithful transcription as the fallback source.

Deliver:

- `Raw` mode: insert the transcript unchanged apart from safe trimming;
- `Polish` mode: rewrite into a clear, straightforward message while preserving meaning, facts, names, sequence, intent, and useful specificity;
- `Roleplay` mode: convert the transcript into concise third-person present-tense action/narration using asterisks, without inventing actions, dialogue, motivations, settings, or other details;
- transformation routed through the existing canonical Gemini provider boundary;
- configured Character Master System Prompt remains authoritative and is combined with the VTT task instruction rather than replaced by it;
- transformation failure falls back to the faithful raw transcript instead of losing user input;
- compact and expanded composer parity;
- no automatic send.

Verification includes unit coverage for all modes and Playwright coverage proving that the transformation request reaches `/api/gemini`, carries the configured Character Master Prompt, inserts the transformed result, and falls back safely on provider failure.

## Current repository observations entering Pass 1

The repository already contains a substantial VTT foundation in `src/vtt/recording.ts`, including MediaRecorder capture, an `AnalyserNode`, RMS calculation, silence detection, maximum duration, and stream cleanup. The current weakness is that the implementation exposes only a three-level UI meter and is tightly coupled to the existing button presentation.

The current Composer places that meter absolutely inside the microphone button, which is the UI behavior this plan replaces.

The current Worker exposes `/api/transcribe` and already protects the Gemini key behind the Worker boundary. Its transcription implementation currently uses a temporary Gemini File upload before creating a `gemini-3.5-transcribe` interaction. Pass 3 will verify and correct this against the current official SDK/API contract rather than preserving that path by default.

The existing draft insertion helper already captures a selection range and returns the resulting cursor index. It will be retained and hardened rather than replaced by a second insertion mechanism.

## Completion criteria

VTT is complete only when:

- microphone capture works on the target Android/PWA environment;
- the recording banner visibly and correctly reflects live local microphone activity;
- Stop reliably finalizes and submits the audio;
- Gemini returns usable transcription through the protected Worker;
- optional Raw / Polish / Roleplay transformation behaves deterministically and preserves the faithful transcript as a fallback;
- the configured Character Master System Prompt remains authoritative during VTT transformation;
- the transcript/transformed text is inserted exactly at the intended location;
- repeated dictation works without overwriting or losing the draft;
- no microphone/audio resources remain live after completion or failure;
- no raw audio or credentials are persisted or leaked;
- all unit, Worker contract, E2E, build, lint, typecheck, and repository reliability gates pass.

## Official references

- Gemini audio transcription: https://ai.google.dev/gemini-api/docs/transcribe
- Gemini Interactions API: https://ai.google.dev/api/interactions-api-v1
- Gemini audio/file input: https://ai.google.dev/gemini-api/docs/file-input-methods
- Gemini Live transcription: https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- Gemini API versioning: https://ai.google.dev/gemini-api/docs/api-versions
- `@google/genai`: https://www.npmjs.com/package/@google/genai
