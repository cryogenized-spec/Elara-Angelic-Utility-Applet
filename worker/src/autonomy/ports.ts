// ---------------------------------------------------------------------------
// SchedulerPort / WakeSource — the architectural seam of design doc §4.4.
//
//   Wake source  →  Scheduler  →  Routine  →  (Phase C) Workflow(runKey)
//   (any timer)     (domain)     (meaning)    (the work)
//
// The seam separates WHEN something should happen (scheduling truth, pure
// domain code in src/autonomy/schedule.ts + scheduler.ts) from WHAT happens
// when it does (execution, Phase C). Swapping the wake mechanism — cron
// trigger → external timer → Workflow sleep → a future Agents SDK schedule —
// rewrites one implementation, never the autonomy model.
//
// Phase B production wiring:
// - WakeSource kind 'cron-trigger': the single hourly cron ("0 * * * *") in
//   wrangler.toml. Cron is the heartbeat/repair clock, NOT the per-routine
//   scheduler; it invokes the Durable Object through the Worker-to-DO binding
//   (no public wake endpoint exists).
// - SchedulerPort is implemented by the Durable Object's SQLite-backed
//   single-alarm multiplexer (see engine.ts): one alarm per DO, armed at the
//   earliest due entry, re-armed after every processing pass.
// ---------------------------------------------------------------------------

/** What wakes the scheduler. The only code that knows what a wake IS lives here. */
export interface WakeSource {
  /**
   * Register interest in the next coarse wake. Today: the cron trigger in
   * wrangler.toml. Tomorrow (if ever): an external timer, a Workflow sleep
   * loop, an Agents SDK schedule.
   */
  readonly kind: 'cron-trigger' | 'external-http' | 'workflow-sleep' | 'agents-sdk';
}

/** The Phase B production wake mechanism: the hourly Cloudflare cron trigger. */
export const PRODUCTION_WAKE_SOURCE: WakeSource = { kind: 'cron-trigger' } as const;

/**
 * The only consumer of wake events. All due-time TRUTH lives behind this
 * port: implementations store due appointments and surface what is due in a
 * window; the pure shared domain (src/autonomy/scheduler.ts) decides what a
 * due occurrence MEANS (identity, classification, dry-run records).
 */
export interface SchedulerPort {
  /** Idempotent by natural key (routineId): repeated registration never multiplies entries. */
  ensureScheduled(routineId: string, dueAt: number): Promise<void>;
  /** Idempotent: cancelling an absent schedule is a no-op. */
  cancel(routineId: string): Promise<void>;
  /** Entries whose due time falls within [fromMs, toMs]. */
  dueWithin(fromMs: number, toMs: number): Promise<Array<{ routineId: string; dueAt: number }>>;
}
