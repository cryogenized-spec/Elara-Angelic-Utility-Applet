# Prompt 22 — Performance Budget

## Status

Accepted as the baseline performance contract for the Android-portrait-first application.

## Principle

Performance is a product constraint, not a later optimization pass. The implementation should keep the first useful chat surface fast on constrained mobile hardware while preserving streaming responsiveness.

## User-facing targets

For representative production mobile traffic, the initial target is:

| Metric | Target |
|---|---:|
| LCP | ≤ 2.5 s at p75 |
| INP | ≤ 200 ms at p75 |
| CLS | ≤ 0.10 at p75 |
| Initial JS transferred | ≤ 200 KB compressed for the core shell target |
| Core shell startup work | Avoid long main-thread tasks during first interaction |
| Streaming render batching | Coalesce rapid provider deltas rather than forcing one render per token |

The Core Web Vitals thresholds are aligned with Google's current recommended “good” thresholds for LCP, INP, and CLS. citeturn646477search1

The 200 KB initial-JS figure is an Elara engineering budget rather than a web-standard pass/fail threshold. It is intentionally strict for an Android-first chat application and may be revised using real device measurements.

## Bundle policy

Do not add a dependency solely for a convenience function that can be implemented locally with a small focused module. Every significant dependency must have a concrete feature owner.

Avoid importing entire libraries into the initial route when a narrow import or lazy boundary is available.

Developer diagnostics, advanced settings, large attachment processors, and non-core Google services should be lazy-loaded when their eventual implementation makes that useful.

## Startup policy

The initial shell should render the conversation frame before non-critical secondary work. IndexedDB opening/migration, portrait/background loading, analytics initialization, and capability detection must not block the first paint longer than necessary.

Do not perform full conversation-history transformation on the critical startup path. Load only what is required for the visible conversation and use focused repository operations.

## Streaming performance

Streaming text updates can arrive faster than the screen needs to repaint. The chat layer should batch/coalesce deltas into animation-frame or similarly bounded updates while preserving exact final text.

Thought summaries and tool-call activity should follow the same bounded update strategy. A single provider event must never imply a mandatory synchronous React tree-wide render.

Persistence checkpoints must also be throttled/controlled. Every token does not require an IndexedDB transaction.

## Memory/attachment policy

Do not keep duplicate copies of large image/PDF payloads in UI state, chat state, and persistence at the same time. Attachment records hold references/metadata; binary handling stays in the attachment subsystem.

Use bounded previews and release temporary object URLs/resources when they are no longer required.

Future long-term memory retrieval must return a bounded context payload rather than loading an unbounded historical corpus into every request.

## Layout stability

Reserve space for images, portrait containers, attachment cards, and asynchronous UI surfaces before their content finishes loading. Avoid layout shifts caused by late-loading assets.

The appearance system must not resize the entire chat viewport unexpectedly when a background or portrait loads.

## Measurement

Once runtime code exists, measure on representative Android-class devices and slow-network profiles. Track shell startup, first render, interaction latency, memory pressure, stream render frequency, persistence time, attachment processing time, and error recovery time.

Core Web Vitals should be evaluated at the 75th percentile across mobile traffic where field measurement is available. citeturn646477search1

## Performance ownership

`chat/` owns stream-update scheduling policy.

`persistence/` owns efficient batched writes and transaction scope.

`attachments/` owns bounded file processing.

`appearance/` owns efficient asset loading and fallback.

`ui/` owns DOM/render efficiency and avoids unnecessary component-wide updates.

No generic “PerformanceManager” should be introduced. Performance is enforced by the modules that create the relevant work.

## Failure policy

A performance optimization must never weaken correctness. In particular:

- final streamed content must remain exact;
- persistence may not be skipped indefinitely;
- cancelled/failed operations must still settle deterministically;
- attachment bytes may not be silently dropped;
- accessibility and readable layout remain non-negotiable.

## Completion criterion

Elara has explicit mobile performance budgets and ownership rules covering startup, bundle cost, streaming, persistence, attachments, memory, and visual stability. The budgets become enforceable CI/field-test gates when the runtime scaffold exists.