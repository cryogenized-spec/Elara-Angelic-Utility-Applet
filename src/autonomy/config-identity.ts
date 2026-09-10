import type { ElaraRoutine } from './contracts';

// Canonical hash of an autonomy configuration payload. Equal configGeneration
// is only an idempotent replay when this hash matches the last accepted body.

export async function hashConfigPayload(payload: {
  enabled: boolean;
  maxEventsPerDay: number;
  routines: readonly ElaraRoutine[];
}): Promise<string> {
  const routines = [...payload.routines]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((routine) => JSON.parse(JSON.stringify(routine)) as ElaraRoutine);
  const canonical = JSON.stringify({
    enabled: payload.enabled,
    maxEventsPerDay: payload.maxEventsPerDay,
    routines,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
