# VTT Pass 4 — Cursor-Aware Composer Integration

## Status

Implemented on 2026-09-05.

Pass 4 connects the existing recording engine, recording banner, protected Worker transcription boundary, and selection-aware draft insertion helper into one deterministic composer flow.

## Completed

- The active editor's selection/caret is captured before microphone permission and recording begin.
- Transcription is inserted at the captured location without automatically sending the chat message.
- Selected text is replaced rather than appended around.
- Existing whitespace and intentional newlines are preserved by the insertion helper.
- The caret is restored immediately after the inserted transcript.
- Consecutive dictation uses that restored caret so additional transcripts continue from the insertion point.
- Compact and expanded composers use the same VTT insertion path.
- In-flight transcription cancellation leaves the existing draft unchanged.
- New tests cover newline preservation and deterministic second/third insertion using the returned caret contract.

## Verification coverage

The E2E suite already covers compact cursor insertion, selection replacement, expanded-editor insertion and focus restoration, provider failure recovery, cancellation, and no automatic send. Unit coverage now explicitly locks the cursor contract used by consecutive dictation.

The remaining VTT work is Pass 5 reliability/security edge-case hardening followed by Pass 6 Android/PWA validation, including physical-device verification for microphone permissions, MediaRecorder behavior, audio routing, PWA lifecycle, vibration support, and browser MIME compatibility.

## Architectural boundary

No second recording subsystem or second provider abstraction was introduced. Recording remains in `src/vtt`, the browser continues to send audio only through `/api/transcribe`, and the Gemini API key remains behind the protected Worker boundary.
