import type { AutonomousEvent, RoutinePolicy, RoutineSuppressionReason } from './contracts';

// ---------------------------------------------------------------------------
// Deterministic autonomy policy.
//
// The agent PROPOSES an event; this module (code, not the model) DECIDES
// whether it becomes a user-visible AutonomousEvent. "Wake → inspect →
// nothing worth surfacing → silence" is a successful outcome, and so is
// "wake → something happened, but policy suppressed it".
// ---------------------------------------------------------------------------

/**
 * Stable novelty fingerprint for dedup. Deterministic, dependency-free
 * (FNV-1a, two lanes): this is a dedup key, not a security primitive, and it
 * must stay computable in any runtime (browser, worker, tests).
 */
export function noveltyFingerprint(routineId: string, title: string, summary: string): string {
  const normalized = `${routineId}\u0000${title.trim()}\u0000${summary.trim()}`.toLocaleLowerCase().replace(/\s+/g, ' ');
  return fnv1a32(normalized, 0x811c9dc5) + fnv1a32(normalized, 0x01000193);
}

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type EventAdmission =
  | { admitted: true }
  | { admitted: false; reason: RoutineSuppressionReason; detail: string };

export interface EventAdmissionInput {
  routineId: string;
  fingerprint: string;
  /** Events created recently enough to matter (caller loads them from the store). */
  recentEvents: ReadonlyArray<Pick<AutonomousEvent, 'routineId' | 'noveltyFingerprint' | 'createdAt'>>;
  policy: RoutinePolicy;
  /** Application-level autonomy settings (rolling-24h event cap). */
  maxEventsPerDay: number;
  now: number;
}

/**
 * Decide whether a proposed event may be created.
 *
 * Order matters and is deliberate: the cheapest, most user-protective checks
 * first — cooldown (same routine spoke recently), duplicate fingerprint (this
 * content was already delivered), then the rolling daily cap.
 */
export function evaluateEventAdmission(input: EventAdmissionInput): EventAdmission {
  const cooldownMs = input.policy.cooldownHours * 3_600_000;

  const cooldownHit = input.recentEvents.find((event) => event.routineId === input.routineId && input.now - event.createdAt < cooldownMs);
  if (cooldownHit) {
    return { admitted: false, reason: 'cooldown', detail: `Another event from this routine was delivered ${formatAge(input.now - cooldownHit.createdAt)} ago (cooldown ${input.policy.cooldownHours} h).` };
  }

  const duplicateHit = input.recentEvents.find((event) => event.noveltyFingerprint === input.fingerprint && input.now - event.createdAt < 7 * 24 * 3_600_000);
  if (duplicateHit) {
    return { admitted: false, reason: 'duplicate', detail: 'This content was already surfaced recently.' };
  }

  const windowStart = input.now - 24 * 3_600_000;
  const recentCount = input.recentEvents.filter((event) => event.createdAt > windowStart).length;
  if (recentCount >= input.maxEventsPerDay) {
    return { admitted: false, reason: 'daily-cap', detail: `The daily event limit (${input.maxEventsPerDay} per rolling 24 h) has been reached.` };
  }

  return { admitted: true };
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}
