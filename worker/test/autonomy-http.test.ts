import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, createExecutionContext, createScheduledController, env, reset } from 'cloudflare:test';
import worker from '../src/index';
import { deriveInstallationId } from '../../src/autonomy/protocol';
import type { AutonomyContextRecord } from '../../src/autonomy/context';
import { TOKEN, bearerRead, configPayload, makeRoutine, signedWrite } from './helpers';

// ---------------------------------------------------------------------------
// Worker-level /autonomy/* boundary tests (design §10, §15): authentication,
// pairing, signed writes, replay rejection, generation protection, context
// sync, the cron heartbeat, and the absence of any public wake endpoint.
// These run against the REAL worker (SELF) with the REAL Durable Object.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://cryogenized-spec.github.io';
const CONTEXT_NOW = 1_700_000_000_000;

beforeEach(async () => {
  await reset();
});

async function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`https://worker.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body });
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`https://worker.example${path}`, { method: 'GET', headers: { Origin: ORIGIN, ...headers } });
}

const SAMPLE_RECORDS: AutonomyContextRecord[] = [
  { id: 'memory-1', kind: 'CORE', title: 'Briefing preference', body: 'The user prefers concise morning briefings.', tags: ['preferences'], importance: 0.8, confidence: 0.9, observedAt: CONTEXT_NOW, updatedAt: CONTEXT_NOW },
];

describe('autonomy boundary — health and pairing', () => {
  it('reports public health with the capability manifest and no secrets', async () => {
    const response = await get('/autonomy/health');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ service: 'elara-gemini' });
    expect((body.autonomy as Record<string, unknown>)).toMatchObject({ configured: true, dryRun: true, schedulerLive: true, agentExecution: false, cron: '0 * * * *' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('pairs with a valid bearer and returns the installation identity', async () => {
    const ok = await post('/autonomy/pair', '', { Authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(200);
    const body = await ok.json() as Record<string, unknown>;
    expect(body.installationId).toBe(await deriveInstallationId(TOKEN));
    expect(body.schemaVersion).toBe(1);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('rejects pairing with a missing or wrong bearer', async () => {
    expect((await post('/autonomy/pair', '')).status).toBe(401);
    expect((await post('/autonomy/pair', '', { Authorization: 'Bearer wrong-token' })).status).toBe(401);
  });
});

describe('autonomy boundary — signed writes', () => {
  it('rejects an unsigned config write', async () => {
    const response = await post('/autonomy/config', configPayload(1, [makeRoutine()]), { Authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe('bad-signature');
  });

  it('rejects a stale timestamp', async () => {
    const request = await signedWrite('/autonomy/config', configPayload(1, [makeRoutine()]), { timestamp: Date.now() - 6 * 60_000 });
    const response = await SELF.fetch(request);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('stale-timestamp');
  });

  it('rejects a tampered body (signature covers the exact bytes)', async () => {
    const signed = await signedWrite('/autonomy/config', configPayload(1, [makeRoutine()]));
    const tampered = new Request(signed.url, { method: 'POST', headers: signed.headers, body: configPayload(1, [makeRoutine({ id: 'routine-tampered' })]) });
    const response = await SELF.fetch(tampered);
    expect(response.status).toBe(401);
  });

  it('rejects an exact replay (same nonce) but accepts a freshly signed duplicate', async () => {
    const body = configPayload(1, [makeRoutine()]);
    const first = await SELF.fetch(await signedWrite('/autonomy/config', body));
    expect(first.status).toBe(200);

    // A re-signed request with a FRESH nonce is a legitimate new request.
    expect((await SELF.fetch(await signedWrite('/autonomy/config', body))).status).toBe(200);

    // An exact replay — same timestamp, nonce, and signature — is rejected by
    // the Durable Object's nonce ledger.
    const signed = await signedWrite('/autonomy/config', body);
    const replayHeaders: Record<string, string> = {};
    signed.headers.forEach((value, key) => { replayHeaders[key] = value; });
    expect((await SELF.fetch(signed)).status).toBe(200); // original delivery
    const replay = new Request(signed.url, { method: 'POST', headers: replayHeaders, body });
    const response = await SELF.fetch(replay);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('replayed-nonce');
  });

  it('accepts a valid config sync and exposes the scheduler state', async () => {
    const response = await SELF.fetch(await signedWrite('/autonomy/config', configPayload(2, [makeRoutine()])));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { accepted: boolean }).accepted).toBe(true);

    const state = await get('/autonomy/state', { Authorization: `Bearer ${TOKEN}` });
    expect(state.status).toBe(200);
    const body = await state.json() as Record<string, any>;
    expect(body.generation).toBe(2);
    expect(body.dryRun).toBe(true);
    expect(body.routines).toHaveLength(1);
    expect(body.routines[0].nextDueAt).toBeGreaterThan(0);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('rejects an older generation even when correctly signed (no last-write-wins by arrival)', async () => {
    await SELF.fetch(await signedWrite('/autonomy/config', configPayload(5, [makeRoutine()])));
    const stale = await SELF.fetch(await signedWrite('/autonomy/config', configPayload(3, [makeRoutine({ id: 'routine-older' })])));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('stale-config');
  });

  it('reads require the bearer token', async () => {
    expect((await get('/autonomy/state')).status).toBe(401);
    expect((await get('/autonomy/state', { Authorization: 'Bearer nope' })).status).toBe(401);
  });
});

describe('autonomy boundary — Autonomy Context sync', () => {
  it('replaces the pack atomically, exposes metadata only, and never echoes content', async () => {
    const pack = JSON.stringify({ contentHash: await hashOf(SAMPLE_RECORDS), records: SAMPLE_RECORDS });
    const replace = await SELF.fetch(await signedWrite('/autonomy/context', pack));
    expect(replace.status).toBe(200);
    const body = await replace.json() as { accepted: boolean; metadata: { recordCount: number; byteSize: number } };
    expect(body.accepted).toBe(true);
    expect(body.metadata.recordCount).toBe(1);

    const metadata = await get('/autonomy/context', { Authorization: `Bearer ${TOKEN}` });
    const meta = ((await metadata.json()) as { context: Record<string, unknown> }).context;
    expect(meta.recordCount).toBe(1);
    expect(meta.stale).toBe(false);
    expect(JSON.stringify(meta)).not.toContain('concise morning briefings'); // content never echoed

    const cleared = await SELF.fetch(await signedWrite('/autonomy/context', JSON.stringify({ clear: true })));
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { metadata: null }).metadata).toBeNull();
  });

  it('rejects a malformed pack', async () => {
    const response = await SELF.fetch(await signedWrite('/autonomy/context', '{"records": "nope"}'));
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('context-invalid');
  });

  it('rejects an oversized pack', async () => {
    const records = Array.from({ length: 40 }, (_, index) => ({ id: `m-${index}`, kind: 'CORE' as const, title: 'T', body: 'x'.repeat(4_000), tags: [], importance: 0.5, confidence: 0.5, observedAt: CONTEXT_NOW, updatedAt: CONTEXT_NOW }));
    const response = await SELF.fetch(await signedWrite('/autonomy/context', JSON.stringify({ contentHash: '0'.repeat(64), records })));
    expect(response.status).toBe(422);
  });

  it('rejects an illegal record kind (MICRO_OBSERVATION cannot travel)', async () => {
    const records = [{ id: 'm', kind: 'MICRO_OBSERVATION', title: 'T', body: 'B', tags: [], importance: 0.5, confidence: 0.5, observedAt: CONTEXT_NOW, updatedAt: CONTEXT_NOW }];
    const response = await SELF.fetch(await signedWrite('/autonomy/context', JSON.stringify({ contentHash: '0'.repeat(64), records })));
    expect(response.status).toBe(422);
  });
});

describe('autonomy boundary — there is no public wake endpoint', () => {
  it('wake, heartbeat, and scheduler ports are not publicly routable', async () => {
    expect((await post('/autonomy/wake', '{}', { Authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    expect((await post('/autonomy/heartbeat', '{}', { Authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    expect((await post('/autonomy/scheduler/ensure', '{}', { Authorization: `Bearer ${TOKEN}` })).status).toBe(404);
  });

  it('the cron scheduled() handler is a heartbeat only: no agent execution, no model calls', async () => {
    // Sync a routine so the heartbeat has real state to sweep.
    await SELF.fetch(await signedWrite('/autonomy/config', configPayload(1, [makeRoutine()])));
    const controller = createScheduledController({ cron: '0 * * * *' });
    const ctx = createExecutionContext();
    await worker.scheduled!(controller, env, ctx);
    await new Promise((resolve) => setTimeout(resolve, 300)); // waitUntil promise settles
    const state = await get('/autonomy/state', { Authorization: `Bearer ${TOKEN}` });
    const body = await state.json() as Record<string, any>;
    expect(body.lastHeartbeatAt).toBeGreaterThan(0);
    expect(body.journal.some((entry: { kind: string }) => entry.kind === 'heartbeat')).toBe(true);
    // The heartbeat ran the sweep — and produced no runs for a future-due routine.
    const runs = await get('/autonomy/runs?since=0', { Authorization: `Bearer ${TOKEN}` });
    expect(((await runs.json()) as { runs: unknown[] }).runs).toHaveLength(0);
  });

  it('scheduled() is a no-op when autonomy is not configured', async () => {
    const controller = createScheduledController({ cron: '0 * * * *' });
    const ctx = createExecutionContext();
    await expect(worker.scheduled!(controller, { GEMINI_API_KEY: 'k' } as typeof env, ctx)).resolves.toBeUndefined();
  });
});

describe('autonomy boundary — installation isolation', () => {
  it('data written through the worker lives only in the token installation\'s DO', async () => {
    await SELF.fetch(await signedWrite('/autonomy/config', configPayload(1, [makeRoutine({ id: 'routine-isolated' })])));

    // The installation DO (token-derived name) holds the mirror…
    const installationId = await deriveInstallationId(TOKEN);
    const own = env.AUTONOMY!.get(env.AUTONOMY!.idFromName(installationId));
    const ownState = await (await own.fetch(await bearerRead('/autonomy/state'))).json() as { routines: unknown[] };
    expect(ownState.routines).toHaveLength(1);

    // …a DIFFERENT Durable Object instance (another installation boundary)
    // cannot see it. Structural isolation: one installation = one DO.
    const other = env.AUTONOMY!.get(env.AUTONOMY!.idFromName('installation-other'));
    const otherState = await (await other.fetch(await bearerRead('/autonomy/state'))).json() as { routines: unknown[] };
    expect(otherState.routines).toHaveLength(0);
  });
});

describe('autonomy boundary — preflight', () => {
  it('allows the Elara auth headers for cross-origin autonomy requests', async () => {
    const response = await SELF.fetch('https://worker.example/autonomy/config', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization, x-elara-signature' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()).toContain('x-elara-signature');
  });

  it('does not grant CORS to unknown origins', async () => {
    const response = await SELF.fetch('https://worker.example/autonomy/config', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

async function hashOf(records: AutonomyContextRecord[]): Promise<string> {
  const { hashAutonomyContext } = await import('../../src/autonomy/context');
  return hashAutonomyContext(records);
}
