# Elara VTT — Voice-to-Text Implementation Plan

## Status

Implementation started on 2026-09-04.

VTT means **Voice-to-Text**. It is a composer capability that records a short microphone utterance, sends only that audio to the controlled Worker transcription boundary, receives a Gemini transcription, and inserts the result into the existing draft. VTT never sends the resulting text automatically.

## Current Gemini/API choice

The implementation uses Google's current **Gemini Interactions API** through the existing `@google/genai` dependency. The repository is currently pinned to `@google/genai` **2.21.0**, which is the npm `latest` release checked on 2026-09-04. The canonical Worker already selects API version **`v1`** for `GoogleGenAI`; VTT will follow that same API-version policy rather than introducing another SDK or API family.

The transcription model is **`gemini-3.5-transcribe`** for recorded/turn-based transcription. Google documents a separate **`gemini-3.5-transcribe-live`** Live API model for low-latency streaming transcription; that is intentionally a later VTT mode because it requires a different raw-PCM/WebSocket audio pipeline. The first implementation therefore remains a short recording → transcription → draft insertion flow.

For small voice clips, the Gemini API supports inline audio input under the documented request-size limit. This makes a short VTT clip a reasonable fit for the controlled Worker boundary. The Files API remains the expansion path for larger recordings and is not needed for the initial dictation path.

## Architecture rule

VTT remains a separate capability boundary while preserving Elara's one-provider architecture:

```text
Android/PWA Composer
    ↓
VTT recorder + local metering/VAD
    ↓
validated /api/transcribe request
    ↓
Cloudflare Worker
    ↓
@google/genai / Gemini Interactions API
    ↓
gemini-3.5-transcribe
    ↓
validated transcript response
    ↓
composer draft insertion at captured selection
```

The browser never receives the Gemini API key. The normal chat endpoint `/api/gemini` remains unchanged. VTT is transcription, not a second conversational execution path.

## Product behavior

When the user taps the microphone:

1. Request microphone permission if needed.
2. Capture the active text control's `selectionStart` and `selectionEnd` before recording begins.
3. Start the microphone recorder at a voice-appropriate target bitrate of **32 kbps**.
4. Show an active recording state and a compact three-bar microphone signal meter.
5. Provide tactile start feedback using `navigator.vibrate(20)` where the browser/device supports vibration.
6. Monitor RMS microphone level locally.
7. Auto-stop after approximately **4 seconds of sustained silence**, subject to a minimum recording guard.
8. Stop/cancel cleanly and release microphone/audio resources.
9. On stop, use `navigator.vibrate([15, 30, 15])` where supported.
10. Reject obviously empty captures before any network/API call (`<2 KB` or `<500 ms`).
11. Send the accepted recording to the Worker transcription endpoint.
12. Validate the Worker response and extract only the returned transcript.
13. Insert that transcript at the original selection/cursor location, replacing a captured selection when present.
14. Do not send the chat message automatically.

## Pass structure

### Pass 1 — Microphone capture boundary

Implement and test the browser-side VTT recording foundation:

- supported `MediaRecorder` MIME-type selection;
- 32 kbps `audioBitsPerSecond` target;
- explicit VTT recording state machine;
- microphone permission/error handling;
- clean stream/track teardown;
- recording start/stop/cancel lifecycle;
- captured selection range;
- haptic feedback;
- `AnalyserNode` RMS metering;
- three-bar signal level contract;
- four-second silence auto-stop;
- minimum-duration/empty-capture guardrails;
- maximum recording duration;
- pure draft insertion helper with exact cursor/selection semantics.

Pass 1 must not call Gemini and must not persist audio. It proves that capture is bounded and deterministic before an API is involved.

### Pass 2 — Worker transcription boundary

Add `POST /api/transcribe` to the Cloudflare Worker with:

- strict origin validation matching the existing Worker policy;
- explicit request-size ceiling for VTT clips;
- MIME validation against supported audio types;
- safe request parsing;
- no arbitrary upstream target/URL support;
- Gemini credential use only inside the Worker;
- Interactions API request using `gemini-3.5-transcribe`;
- `generation_config.transcription_config.mode` set to `smart` for ordinary dictation;
- normalized JSON response containing transcript and safe metadata only;
- no message text or raw audio in diagnostics beyond what is necessary for operation;
- clean provider/network error normalization;
- explicit timeout/abort behavior.

For the initial clip size, the implementation may use inline audio data in the Interactions request. This avoids adding a second provider abstraction solely for Files API uploads. The Worker must nevertheless enforce a much smaller VTT-specific body limit than Gemini's general multimodal ceiling. If that limit proves insufficient for real-world dictation, a follow-up pass can move the upload leg to the Files API without changing the browser-facing contract.

### Pass 3 — Gemini transcription adapter

Wire the Worker transcription boundary to the current `@google/genai` SDK:

```ts
const ai = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
  apiVersion: 'v1',
});

const interaction = await ai.interactions.create({
  model: 'gemini-3.5-transcribe',
  input: [{
    type: 'audio',
    data: base64Audio,
    mime_type: mimeType,
  }],
  generation_config: {
    transcription_config: {
      mode: 'smart',
    },
  },
});
```

The exact request/response shape will be verified against the installed SDK typings and the current Google documentation before the implementation is considered complete.

### Pass 4 — Composer integration

Turn the existing microphone icon into the real VTT control.

Required UX:

- same VTT control in the normal composer and expanded editor;
- idle / requesting / recording / processing / success / error presentation;
- signal meter while recording;
- explicit stop interaction;
- disabled composer controls while transcription is processing where necessary;
- no automatic message submission;
- no accidental loss of a draft while VTT is active;
- cursor/selection insertion into the exact composer that was active when VTT started.

When the expanded editor is active, insertion must target the expanded textarea rather than the compact textarea.

### Pass 5 — Reliability, diagnostics, and security

Add unit tests and Worker contract tests for:

- MIME allow-listing;
- oversized request rejection;
- malformed payload rejection;
- tiny/short capture rejection;
- transcript response validation;
- provider error mapping;
- origin/CORS behavior;
- no secret leakage;
- audio resource teardown;
- cancellation during recording and during transcription;
- selection-aware insertion with empty, collapsed, and selected ranges;
- whitespace padding without damaging intentional newlines.

The VTT path must never log raw microphone data, credentials, OAuth tokens, or arbitrary provider payloads.

### Pass 6 — Android/PWA E2E validation

Extend Playwright coverage for Android portrait and desktop Chromium:

- microphone permission mocked/controlled;
- start/stop flow;
- signal meter state;
- auto-stop after sustained silence;
- no-speech guard;
- cursor insertion;
- selection replacement;
- expanded-editor insertion;
- cancellation;
- error recovery;
- accessibility labels and keyboard focus;
- reduced-motion behavior.

A real Android physical-device validation remains required before calling VTT production-ready because microphone permissions, PWA lifecycle, vibration support, MediaRecorder MIME support, and audio device routing are all browser/device dependent.

## Audio policy

The first implementation targets **32 kbps** recording with a browser-supported Opus/WebM format where available. MediaRecorder configuration remains capability-driven: the browser's `MediaRecorder.isTypeSupported()` result is authoritative.

The product does not transcode audio in the browser merely to satisfy a preferred format. The selected recording MIME type is sent to the Worker and validated before the Gemini request.

## Cursor-aware insertion policy

The selection range is captured before microphone recording starts because focus can move while permission prompts, recording, and network processing occur.

Insertion behavior:

```text
prefix + separator + transcript + separator + suffix
```

The helper must avoid doubled whitespace at natural boundaries while still preventing accidental word concatenation. A selected range is replaced. A collapsed selection inserts at the cursor. The final draft remains a normal user-editable string.

## Silence/VAD policy

RMS is calculated from an `AnalyserNode` locally. The VAD layer is an interaction safeguard, not a claim of speech recognition accuracy.

The recorder must:

- tolerate brief pauses;
- avoid stopping immediately after start;
- accumulate sustained-silence duration;
- stop after approximately four seconds below threshold;
- stop at the hard maximum duration even if audio is continuously active.

The exact RMS threshold will be empirically tuned during Android testing rather than baked into the UI layer.

## State model

The VTT state machine is:

`idle → requesting → recording → processing → idle`

with explicit terminal/recoverable conditions:

`permission-denied`, `unsupported`, `cancelled`, `empty`, and `failed`.

No state should leave the microphone stream live after completion, failure, cancellation, or unmount.

## Transcript semantics

Gemini Smart transcription is the initial mode because ordinary dictation benefits from removal of disfluencies, punctuation, casing, and structure. Google documents Smart mode as incompatible with word timestamps and speaker diarization; neither feature is required by VTT-1.

Automatic language detection is the default. Explicit language codes and custom vocabulary are deferred until there is a concrete product requirement.

## Privacy

Recorded audio exists only for the duration required to obtain its transcript. VTT does not persist recordings to Dexie, localStorage, IndexedDB, or application analytics. Gemini-side temporary storage follows Google's documented API behavior when the Files API is used in a later expansion; the initial inline-audio path avoids storing a Gemini File resource for ordinary short dictation.

## Current official references checked 2026-09-04

- Gemini audio transcription: https://ai.google.dev/gemini-api/docs/transcribe
- Gemini file input methods: https://ai.google.dev/gemini-api/docs/file-input-methods
- Gemini Files API: https://ai.google.dev/gemini-api/docs/files
- Gemini Live transcription: https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- Gemini API versioning: https://ai.google.dev/gemini-api/docs/api-versions
- Interactions API overview: https://ai.google.dev/gemini-api/docs/interactions-overview
- `@google/genai` npm release state: https://www.npmjs.com/package/@google/genai

## Implementation invariant

The VTT feature is complete only when the microphone is a real composer capability, transcription uses the current Gemini API through the existing protected Worker boundary, the transcript is inserted exactly where the user left the cursor/selection, no automatic send occurs, no audio is persisted, and all repository reliability gates remain green.
