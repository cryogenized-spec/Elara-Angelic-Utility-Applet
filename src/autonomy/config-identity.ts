import type { ElaraRoutine, RoutineSchedule } from './contracts';

// Canonical hash of an autonomy configuration payload. Equal configGeneration
// is only an idempotent replay when this hash matches the last accepted body.
// Field order is explicit — never JavaScript insertion order.

function canonicalSchedule(schedule: RoutineSchedule): unknown {
  if (schedule.kind === 'daily') {
    const days = Array.isArray(schedule.days) ? [...schedule.days].sort((a, b) => a - b) : schedule.days;
    return { kind: 'daily', time: schedule.time, days };
  }
  return {
    kind: 'interval',
    everyMinutes: schedule.everyMinutes,
    ...(schedule.between ? { between: { start: schedule.between.start, end: schedule.between.end } } : {}),
  };
}

function canonicalRoutine(routine: ElaraRoutine): unknown {
  return {
    id: routine.id,
    name: routine.name,
    enabled: routine.enabled,
    instruction: routine.instruction,
    schedule: canonicalSchedule(routine.schedule),
    timezone: routine.timezone,
    permissions: {
      memory: routine.permissions.memory,
      google: [...routine.permissions.google].sort(),
    },
    delivery: {
      inbox: routine.delivery.inbox,
      push: routine.delivery.push,
      minImportanceForPush: routine.delivery.minImportanceForPush,
    },
    policy: {
      cooldownHours: routine.policy.cooldownHours,
      maxToolCalls: routine.policy.maxToolCalls,
      maxRunsPerDay: routine.policy.maxRunsPerDay,
    },
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
    ...(routine.lastRunAt !== undefined ? { lastRunAt: routine.lastRunAt } : {}),
    ...(routine.lastResult
      ? {
          lastResult: {
            at: routine.lastResult.at,
            state: routine.lastResult.state,
            ...(routine.lastResult.outcome !== undefined ? { outcome: routine.lastResult.outcome } : {}),
            ...(routine.lastResult.eventId !== undefined ? { eventId: routine.lastResult.eventId } : {}),
          },
        }
      : {}),
  };
}

export function canonicalizeConfigPayload(payload: {
  enabled: boolean;
  maxEventsPerDay: number;
  routines: readonly ElaraRoutine[];
}): string {
  const routines = [...payload.routines]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((routine) => canonicalRoutine(routine));
  return JSON.stringify({
    enabled: payload.enabled,
    maxEventsPerDay: payload.maxEventsPerDay,
    routines,
  });
}

export async function hashConfigPayload(payload: {
  enabled: boolean;
  maxEventsPerDay: number;
  routines: readonly ElaraRoutine[];
}): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeConfigPayload(payload)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
