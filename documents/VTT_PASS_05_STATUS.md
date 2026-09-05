# VTT Pass 5 — Reliability, Security & Edge-Case Hardening

## Status

Implemented on 2026-09-05.

Pass 5 hardens the VTT lifecycle around failure, cancellation, timeout, unsupported environments, and repeated sessions while preserving the Pass 4 cursor/insertion contract.

## Completed

- Microphone permission denial remains a non-destructive failure: the existing draft is preserved and the composer returns to an actionable idle state.
- Unsupported MediaRecorder formats fail before microphone access is requested.
- Tiny captures remain blocked both in the browser pre-flight check and at the Worker boundary.
- Empty transcription responses remain non-destructive and report a clear status message.
- Manual stop, sustained-silence auto-stop, and maximum recording duration continue to share the single recording engine.
- Caller cancellation is distinguished from transcription timeout; timeout is typed as `VttTranscriptionError('timeout', ...)`.
- Client-side transcription is bounded to 30 seconds and always removes its timer/listener after completion.
- Processing cancellation invalidates the current VTT session so a subsequent dictation cannot be overwritten by stale completion/finally handlers.
- Composer unmount invalidates the current session, cancels active recording, aborts in-flight transcription, and prevents late async state updates from the VTT flow.
- Worker request validation remains strict on origin, MIME type, and 2 MiB capture size; accepted captures continue to use `gemini-3.5-transcribe` Smart mode and are deleted from Gemini storage in a `finally` cleanup path.
- No raw audio or credentials are persisted or exposed through the browser diagnostics boundary.

## Verification coverage

Unit tests cover MIME selection, minimum capture thresholds, deterministic RMS levels, Worker-boundary transcription, empty responses, caller cancellation, and the timeout contract.

E2E tests cover compact and expanded insertion, selection replacement, consecutive dictation, newline preservation, microphone denial, unsupported recorder format, empty transcript, silence auto-stop, provider failure/recovery, and in-flight transcription cancellation.

## Architectural boundary

Recording remains exclusively in `src/vtt`; browser transcription remains exclusively `/api/transcribe`; the Gemini credential remains exclusively in the Cloudflare Worker. No alternate browser speech-recognition path or second provider path was introduced.

## Remaining Pass 6 work

Pass 6 is validation rather than another VTT architecture change: full automated E2E/reliability verification plus physical Android/PWA verification for microphone permissions, MediaRecorder MIME behavior, audio routing, PWA lifecycle/resume, vibration support, and portrait/mobile geometry.
