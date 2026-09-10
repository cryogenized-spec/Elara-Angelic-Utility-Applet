/**
 * Interactive-chat runtime context: a volatile wall-clock block plus stable
 * roleplay/world framing.
 *
 * Freshness policy (NOT a generation watchdog — see DEFAULT_IDLE_STALL_TIMEOUT_MS
 * / DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS for those): a NEW thread establishes fresh
 * wall-clock context on its first invocation; an EXISTING thread re-establishes
 * it only on the first invocation after >=30 continuous minutes of thread
 * inactivity. Normal consecutive turns keep the stable guidance but omit the
 * clock. Per-thread last-invocation activity is tracked by
 * runtime-context-activity.ts (session-level localStorage, never durable
 * memory or world state).
 */

/** Continuous thread inactivity after which the next invocation refreshes the clock. */
export const RUNTIME_CONTEXT_STALE_AFTER_MS = 30 * 60 * 1000;

const RUNTIME_CLOCK_HEADER = 'Application runtime context:';

/**
 * Stable per-turn framing. Always included — including on turns that skip the
 * clock — so roleplay/world/confirmation guidance never depends on freshness.
 */
const STABLE_GUIDANCE_LINES = [
  'When Roleplay Mode is active:',
  '- Treat the persistent World Canvas as authoritative setting context.',
  '- Use roleplay_setting tools to inspect or change persistent world entities when appropriate.',
  '- Persistent world mutations require user confirmation before they are committed.',
  '- Do not store current date, time, weekday, or timezone as persistent world facts.',
  '- Always establish or mention a physical setting when roleplaying.',
  '- Use the current runtime time as dynamic context and use initiative to choose a logical existing location when the narrative calls for one.',
  '- Physical action and scene narration use italics; spoken dialogue uses ordinary text.',
] as const;

export interface RuntimeContextOptions {
  /** Clock reading for the volatile block. Defaults to `new Date()`. Injectable for tests. */
  readonly now?: Date;
  /** IANA timezone for formatting. Defaults to the runtime's resolved timezone. */
  readonly timeZone?: string;
  /**
   * When false, omit the volatile wall-clock block but keep the stable
   * guidance. Defaults to true (new-thread / stale-thread behaviour).
   */
  readonly includeClock?: boolean;
}

function formatRuntimeClock(now: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone }).format(now);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone }).format(now);
  return [
    RUNTIME_CLOCK_HEADER,
    `- Current local date: ${date}`,
    `- Current local time: ${time}`,
    `- Current weekday: ${weekday}`,
    `- Local timezone: ${timeZone}`,
  ].join('\n');
}

export function withRuntimeContext(systemInstruction: string | undefined, options: RuntimeContextOptions = {}): string {
  const includeClock = options.includeClock ?? true;
  const sections: string[] = [];
  if (includeClock) {
    const now = options.now ?? new Date();
    const timeZone = options.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    sections.push(formatRuntimeClock(now, timeZone));
  }
  sections.push(STABLE_GUIDANCE_LINES.join('\n'));
  const runtime = sections.join('\n\n');
  const base = systemInstruction?.trim();
  return base ? `${base}\n\n${runtime}` : runtime;
}

/**
 * Pure freshness predicate. A thread with no recorded invocation activity is
 * new and always refreshes; otherwise the boundary is `>=` 30 minutes of
 * inactivity. A clock that moved backwards never forces a refresh.
 */
export function shouldRefreshRuntimeContext(
  lastActivityAt: number | null | undefined,
  nowMs: number,
  staleAfterMs: number = RUNTIME_CONTEXT_STALE_AFTER_MS,
): boolean {
  if (typeof lastActivityAt !== 'number' || !Number.isFinite(lastActivityAt)) return true;
  if (!Number.isFinite(nowMs)) return true;
  return nowMs - lastActivityAt >= staleAfterMs;
}
