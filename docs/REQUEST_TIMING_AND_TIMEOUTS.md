# Request Timing and Timeout System

## Purpose

Make request timing explicit so the application can distinguish healthy streaming, stalled transport, hard timeout, cancellation, and provider completion.

## Lifecycle timing

A request records monotonic timestamps for:

1. request accepted
2. provider dispatch started
3. first response/event received
4. subsequent stream activity
5. terminal completion/failure/cancellation

Derived metrics include total duration and time-to-first-event.

## Timeout semantics

Timeouts are bounded by the application contract rather than browser UI timers. A timeout produces a normalized `timeout` failure and ends the request state deterministically; it never leaves an infinite spinner.

A streaming request must reset its idle-stall watchdog when meaningful provider events arrive. This is separate from the absolute request deadline so long-running but actively streaming responses are not mistaken for stalled connections.

## Cancellation

Cancellation is explicit and distinct from timeout. The caller owns an `AbortSignal`; provider adapters translate cancellation into the normalized cancelled state. A cancelled request must stop rendering as active and must not silently convert itself into a retry.

## Diagnostics integration

Timing data flows into the diagnostics record without including message content or credentials. The chat layer may display high-level progress, while detailed timing belongs to diagnostics.

## Performance interaction

The timing system measures network/provider work; it must not become a global performance manager. UI render timing, persistence timing, and attachment processing remain owned by the modules that create that work.

## Upstream context

The Interactions API streams over SSE and exposes typed interaction/step events, making time-to-first-event and terminal-event timing meaningful application diagnostics. citeturn901754search1turn901754search0
