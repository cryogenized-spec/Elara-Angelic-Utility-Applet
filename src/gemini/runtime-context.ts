/**
 * Interactive-chat runtime context: a volatile wall-clock block plus stable
 * roleplay/world framing.
 *
 * Freshness policy (NOT a generation watchdog — see DEFAULT_IDLE_STALL_TIMEOUT_MS
 * / DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS for those): runtime wall-clock context
 * is refreshed lazily on model invocation. A refresh is required on initial
 * runtime establishment and whenever >=30 minutes have elapsed since fresh
 * runtime context was last established for an invocation. Normal invocations
 * do not reset that
 * freshness window. The application-level refresh timestamp is tracked by
 * runtime-context-freshness.ts (localStorage bookkeeping only — never durable
 * memory, world state, or conversation content), so app suspension/restart is
 * handled naturally by the persisted timestamp.
 */

/** Freshness lifetime of an established runtime clock; the next invocation at or past it refreshes. */
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
   * guidance. Defaults to true (initial establishment / stale freshness).
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
 * Pure freshness predicate over `nowMs - lastRefreshAt`: no recorded refresh
 * always refreshes (initial runtime establishment); otherwise the boundary is
 * `>=` 30 minutes since the last REAL refresh. A clock that moved backwards
 * never forces a refresh.
 */
export function shouldRefreshRuntimeContext(
  lastRefreshAt: number | null | undefined,
  nowMs: number,
  staleAfterMs: number = RUNTIME_CONTEXT_STALE_AFTER_MS,
): boolean {
  if (typeof lastRefreshAt !== 'number' || !Number.isFinite(lastRefreshAt)) return true;
  if (!Number.isFinite(nowMs)) return true;
  return nowMs - lastRefreshAt >= staleAfterMs;
}
