---
id: SYS-VTT
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: microphone capture, transcription and draft transformation
paths: [src/vtt, src/app/components/Composer.tsx]
keywords: [voice, vtt, microphone, transcription, polish, roleplay]
---

# Voice-to-text

## 1. Purpose and boundary

`SYS-VTT` turns an explicit microphone capture into composer text. It owns browser audio capture, signal/silence handling, direct Gemini transcription, optional draft transformation and insertion. It does not submit chat messages automatically and does not create a second character/persona layer.

## 2. Runtime architecture

```text
Composer long-press/voice action
-> VttRecorder
-> audio Blob
-> transcribeVttCapture()
-> raw transcript
-> optional raw | polish | roleplay transform
-> draft insertion at captured selection
-> user reviews/submits
```

Transcription uses the local Gemini Lockbox credential directly with `gemini-3.5-transcribe`, `store:false`, and a 30-second application timeout. Polish/roleplay transformation uses the canonical `geminiTurnPort` and forwards the active Character Master system instruction unchanged.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Capture/metering | `src/vtt/recording.ts` |
| Transcription | `src/vtt/transcription.ts` |
| Transform modes | `src/vtt/transformation.ts` |
| Selection insertion | `src/vtt/draft-insertion.ts` |
| UI integration | `src/app/components/Composer.tsx` |

Each source module has focused unit coverage in `src/vtt/*.test.ts`.

## 4. Data and contracts

Recording states are `idle`, `requesting`, `recording`, `processing`, `cancelled`, `empty`, `failed`. `VttCapture` contains `Blob`, MIME type, duration and the composer selection captured at start.

Supported recording formats are WebM/Ogg with Opus where the browser provides them. Current bounds: 32 kbps, minimum 2,048-byte blob, minimum 500 ms speech, default four seconds of silence to stop, hard 60-second capture maximum. RMS metering drives a four-level signal indicator.

Transform modes are `raw`, `polish`, `roleplay`. Raw returns the transcript unchanged apart from trim. The two transforms use a bounded task prompt and `maxOutputTokens: 500`; they return only transformed draft text.

## 5. Invariants

- Microphone access occurs only after a user action.
- Voice output becomes a draft; VTT never presses Send for the user.
- Transformation instructions are user-task input, not another system instruction.
- The active Character Master, when supplied, is forwarded verbatim.
- Recording tracks, timers and AudioContext resources are cleaned up on stop/cancel/failure.
- VTT does not use the Cloudflare Worker for current transcription.

## 6. Security and failure semantics

Audio is transient input and is not conversation persistence. Errors distinguish configuration, empty speech, timeout, cancellation and provider failure. Unsupported browser APIs and microphone denial fail visibly. Cancellation terminates capture/provider work and must not overwrite the existing draft.

## 7. Verification and tests

Run `src/vtt/*.test.ts`, `Composer.test.tsx`, composer layout tests and relevant Android E2E. Physical handset testing remains important for microphone permissions, haptics and browser recording-codec behavior.

## 8. Known gaps

Browser codec and permission behavior varies by device. Any future offline/on-device transcription would be an alternate VTT implementation behind this boundary, not a reason to fork chat/provider architecture.
