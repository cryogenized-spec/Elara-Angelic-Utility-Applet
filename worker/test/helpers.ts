import { newNonce, signWrite } from '../../src/autonomy/protocol';
import type { ElaraRoutine } from '../../src/autonomy/contracts';

// Shared fixtures for the workers-pool tests: signed request construction and
// valid routine payloads for config sync.

export const TOKEN = 'test-installation-token-please-ignore';
const ORIGIN = 'https://cryogenized-spec.github.io';

export function makeRoutine(overrides: Partial<ElaraRoutine> = {}): ElaraRoutine {
  return {
    id: 'routine-cloud-1',
    name: 'Morning brief',
    enabled: true,
    instruction: 'Summarize anything that changed overnight.',
    schedule: { kind: 'daily', time: '09:00', days: 'every' },
    timezone: 'UTC',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function configPayload(generation: number, routines: ElaraRoutine[], enabled = true) {
  return JSON.stringify({ generation, enabled, maxEventsPerDay: 10, routines });
}

/** A fully signed write request exactly the way the app client signs it. */
export async function signedWrite(path: string, body: string, overrides: { timestamp?: number; nonce?: string; signature?: string; token?: string } = {}): Promise<Request> {
  const timestamp = overrides.timestamp ?? Date.now();
  const nonce = overrides.nonce ?? newNonce();
  const signature = overrides.signature ?? await signWrite(overrides.token ?? TOKEN, 'POST', path, timestamp, nonce, body);
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Authorization: `Bearer ${overrides.token ?? TOKEN}`,
      'X-Elara-Timestamp': String(timestamp),
      'X-Elara-Nonce': nonce,
      'X-Elara-Signature': signature,
    },
    body,
  });
}

export async function bearerRead(path: string, token: string = TOKEN): Promise<Request> {
  return new Request(`https://worker.example${path}`, {
    method: 'GET',
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
  });
}

/** Binding-internal DO request (cron heartbeat / SchedulerPort). */
export async function internalDo(path: string, init: RequestInit = {}): Promise<Request> {
  const { internalWakeMarker } = await import('../../src/autonomy/protocol');
  return new Request(`https://autonomy-engine${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Elara-Internal': await internalWakeMarker(TOKEN) },
  });
}
