import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutonomyCloud } from '../../app/components/AutonomyCloud';
import { SCHEDULER_DRY_RUN_CODE } from '../scheduler';
import type { RoutineRunRecord } from '../contracts';
import { saveMemory, updateMemory } from '../../memory/store';
import { saveAutonomyPreferences } from '../../persistence/preferences';
import { clearAutonomyStore, listRuns, saveRoutine } from '../../persistence/autonomy';
import { clearWorkerContext, fullSync, syncConfiguration } from './sync';
import { bumpConfigGeneration, configGeneration, savePairing, type AutonomyPairing } from './pairing';

// ---------------------------------------------------------------------------
// Sync orchestration against a mocked worker boundary: the exact request
// shapes (bearer + HMAC headers), hash-guarded context replacement, stale
// generation adoption, and idempotent cloud-run mirroring into the LOCAL run
// history (the local-first direction — the worker mirror is disposable).
// ---------------------------------------------------------------------------

const PAIRING: AutonomyPairing = {
  workerUrl: 'https://worker.example',
  token: 'orchestration-test-token',
  installationId: 'b'.repeat(32),
  workerVersion: '1.0.0-phase-b',
  schemaVersion: 1,
  pairedAt: 1_700_000_000_000,
  lastSyncedAt: null,
  lastSyncedContextHash: null,
  lastPulledRunsAt: 0,
  lastPulledRunsId: '',
  lastPulledEventsAt: 0,
  lastPulledEventsId: '',
};

const CONTEXT_NOW = 1_700_000_000_000;

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function makeRoutineFixture() {
  return {
    id: 'routine-sync-1',
    name: 'Synced brief',
    enabled: true,
    instruction: 'Summarize the morning.',
    schedule: { kind: 'daily' as const, time: '09:00', days: 'every' as const },
    timezone: 'UTC',
    permissions: { memory: false, google: [] },
    delivery: { inbox: true, push: false, minImportanceForPush: 2 as const },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function cloudDryRunRecord(id: string, startedAt: number): RoutineRunRecord {
  return {
    id,
    runKey: `routine-sync-1:scheduled:${startedAt}`,
    routineId: 'routine-sync-1',
    routineName: 'Synced brief',
    executionMode: 'scheduled',
    scheduledFor: startedAt - 1_000,
    startedAt,
    completedAt: startedAt,
    state: 'skipped',
    outcome: 'skipped',
    errorCode: SCHEDULER_DRY_RUN_CODE,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let requests: CapturedRequest[];
let contextReplacements: number;
let storedContextHash: string | null;

beforeEach(async () => {
  window.localStorage.clear();
  await clearAutonomyStore();
  requests = [];
  contextReplacements = 0;
  storedContextHash = null;
  await saveAutonomyPreferences({ enabled: true, maxEventsPerDay: 10 });
  await saveMemory({ kind: 'CORE', title: 'Consented preference', body: 'Brief and factual.' }).then((memory) => updateMemory(memory.id, { autonomyContext: true }));
  await saveMemory({ kind: 'CONTEXTUAL', title: 'Unconsented', body: 'Stays local.' });
  await saveRoutine(makeRoutineFixture());
  savePairing(PAIRING);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type RouteHandler = (request: CapturedRequest) => Response | Promise<Response>;

function mockWorker(routes: Record<string, RouteHandler>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined)).forEach((value, key) => { headers[key] = value; });
    const captured: CapturedRequest = { method, path: `${url.pathname}${url.search}`, headers, body };
    requests.push(captured);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return jsonResponse({ code: 'not_found', message: `No route for ${method} ${url.pathname}` }, 404);
    return handler(captured);
  }));
}

describe('fullSync', () => {
  it('mirrors configuration with signed writes, syncs the consented context once, and lands cloud runs in local history', async () => {
    const run = cloudDryRunRecord('cloud-run-1', 1_700_000_100_000);
    mockWorker({
      'POST /autonomy/config': () => jsonResponse({ accepted: true, stateGeneration: 1 }),
      'GET /autonomy/state': () => jsonResponse({
        paired: true, dryRun: true, generation: configGeneration(), stateGeneration: 1, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: 1, lastSyncedAt: 1, nextAlarmAt: 2,
        routines: [{ id: 'routine-sync-1', name: 'Synced brief', enabled: true, locus: 'cloud', schedule: {}, timezone: 'UTC', nextDueAt: 3 }],
        context: storedContextHash ? { contentHash: storedContextHash, syncedAt: 1, generation: 1, recordCount: 1, byteSize: 120, stale: false } : null,
        journal: [],
      }),
      'POST /autonomy/context': () => {
        contextReplacements += 1;
        storedContextHash = JSON.parse(requests.at(-1)!.body).contentHash;
        return jsonResponse({ accepted: true, metadata: { recordCount: 1, byteSize: 120 } });
      },
      'GET /autonomy/runs': () => jsonResponse({ runs: [run], next: null, limit: 200 }),
      'GET /autonomy/events': () => jsonResponse({ events: [], next: null, limit: 200 }),
    });

    const result = await fullSync({ ...PAIRING });
    expect(result.contextSynced).toBe(true);
    expect(result.pulledRuns).toBe(1);

    // The configuration write was signed and carried the full local truth.
    const config = requests.find((request) => request.path === '/autonomy/config')!;
    expect(config.headers.authorization).toBe(`Bearer ${PAIRING.token}`);
    expect(config.headers['x-elara-signature']).toBeTruthy();
    expect(config.headers['x-elara-nonce']).toBeTruthy();
    const payload = JSON.parse(config.body) as { generation: number; enabled: boolean; maxEventsPerDay: number; routines: Array<{ id: string }> };
    expect(payload.enabled).toBe(true);
    expect(payload.routines.map((routine) => routine.id)).toEqual(['routine-sync-1']);

    // The context pack contains ONLY the consented memory.
    const context = requests.find((request) => request.path === '/autonomy/context')!;
    const pack = JSON.parse(context.body) as { records: Array<{ title: string }> };
    expect(pack.records.map((record) => record.title)).toEqual(['Consented preference']);

    // The cloud observation is in the LOCAL run history exactly once.
    expect((await listRuns(20)).filter((record) => record.runKey === run.runKey)).toHaveLength(1);

    // Second sync: hash matches → no context replacement; runs already pulled.
    const second = await fullSync({ ...PAIRING, lastSyncedContextHash: storedContextHash });
    expect(second.contextSynced).toBe(false);
    expect(contextReplacements).toBe(1);
    expect((await listRuns(20)).filter((record) => record.runKey === run.runKey)).toHaveLength(1);
  });

  it('reports a stale configuration rejection and adopts the worker generation instead of re-pushing older config', async () => {
    bumpConfigGeneration();
    bumpConfigGeneration();
    mockWorker({
      'POST /autonomy/config': () => jsonResponse({ code: 'stale-config', message: 'older', generation: 9 }, 409),
      'GET /autonomy/state': () => jsonResponse({
        paired: true, dryRun: true, generation: 9, stateGeneration: 9, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: 1, lastSyncedAt: 1, nextAlarmAt: null, routines: [], context: null, journal: [],
      }),
    });

    const result = await syncConfiguration(PAIRING);
    expect(result.staleRejected).toBe(true);
    expect(configGeneration()).toBe(9); // adopted for the NEXT local change

    const pushes = requests.filter((request) => request.path === '/autonomy/config');
    expect(pushes).toHaveLength(1); // never blindly re-pushed the older payload
  });

  it('equal-generation config-conflict adopts the worker generation and does not replay', async () => {
    bumpConfigGeneration();
    mockWorker({
      'POST /autonomy/config': () => jsonResponse({ code: 'config-conflict', message: 'same gen different body', generation: 4 }, 409),
      'GET /autonomy/state': () => jsonResponse({
        paired: true, dryRun: false, generation: 4, stateGeneration: 4, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: 1, lastSyncedAt: 1, nextAlarmAt: null, routines: [], context: null, journal: [],
      }),
    });
    const result = await syncConfiguration(PAIRING);
    expect(result.staleRejected).toBe(true);
    expect(configGeneration()).toBe(4);
    expect(requests.filter((request) => request.path === '/autonomy/config')).toHaveLength(1);
  });

  it('walks keyset run pages without skipping older records', async () => {
    const pages = [
      Array.from({ length: 2 }, (_, index) => cloudDryRunRecord(`run-${index}`, 1_700_000_000_100 + index)),
      [cloudDryRunRecord('run-2', 1_700_000_000_200)],
    ];
    let runCalls = 0;
    mockWorker({
      'POST /autonomy/config': () => jsonResponse({ accepted: true, stateGeneration: 1 }),
      'GET /autonomy/state': () => jsonResponse({
        paired: true, dryRun: false, generation: 0, stateGeneration: 1, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: 1, lastSyncedAt: 1, nextAlarmAt: 2, routines: [], context: null, journal: [],
      }),
      'POST /autonomy/context': () => jsonResponse({ accepted: true, metadata: { recordCount: 0, byteSize: 2 } }),
      'GET /autonomy/runs': (request) => {
        const params = new URLSearchParams(request.path.split('?')[1] ?? '');
        const afterAt = Number(params.get('afterAt') ?? '0');
        const afterId = params.get('afterId') ?? '';
        const page = runCalls === 0 ? pages[0]! : pages[1]!;
        runCalls += 1;
        if (runCalls === 1) expect(afterAt).toBe(0);
        if (runCalls === 2) expect(afterId).toBe('run-1');
        return jsonResponse({ runs: page, next: runCalls === 1 ? { at: page[page.length - 1]!.startedAt, id: page[page.length - 1]!.id } : null, limit: 2 });
      },
      'GET /autonomy/events': () => jsonResponse({ events: [], next: null, limit: 200 }),
    });
    const result = await fullSync({ ...PAIRING });
    expect(result.pulledRuns).toBe(3);
    expect(runCalls).toBe(2);
    expect((await listRuns(20)).map((run) => run.id).sort()).toEqual(['run-0', 'run-1', 'run-2']);
  });

  it('clears the worker-side pack immediately', async () => {
    mockWorker({
      'POST /autonomy/context': () => jsonResponse({ accepted: true, metadata: null }),
      'GET /autonomy/state': () => jsonResponse({
        paired: true, dryRun: true, generation: 0, stateGeneration: 0, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: null, lastSyncedAt: null, nextAlarmAt: null, routines: [], context: null, journal: [],
      }),
    });
    await clearWorkerContext(PAIRING);
    const clear = requests.find((request) => request.path === '/autonomy/context')!;
    expect(JSON.parse(clear.body)).toEqual({ clear: true });
  });
});

describe('AutonomyCloud (unpaired render)', () => {
  it('shows the honest not-connected state — never a fake connected badge', () => {
    window.localStorage.clear();
    const html = renderToStaticMarkup(<AutonomyCloud onNotice={() => undefined} />);
    expect(html).toContain('Cloud scheduler — not connected');
    expect(html).toContain('Cloudflare worker');
    expect(html).not.toContain('Connected to');
  });
});
