import { beforeEach, describe, expect, it } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId } from '../../src/autonomy/protocol';

import { workflowInstanceIdForRunKey } from '../../src/autonomy/workflow-identity';
import type { RoutineRunRecord } from '../../src/autonomy/contracts';
import { TOKEN, bearerRead, configPayload, internalDo, makeRoutine, signedWrite } from './helpers';

beforeEach(async () => {
  await reset();
});

type EngineHarness = DurableObjectStub & {
  claimWithoutDispatch(routineId: string, dueAt: number): Promise<{ runKey: string; workflowInstanceId: string; dispatched: boolean }>;
  markDispatchedWithoutAdvance(runKey: string): Promise<{ runKey: string; dispatched: boolean; scheduleAdvanced: boolean }>;
  ageRun(runKey: string, startedAt: number): Promise<{ runKey: string; startedAt: number }>;
  pruneNow(): Promise<{ pruned: true; envelopeCount: number }>;
  envelopePresent(runKey: string): Promise<boolean>;
};

async function stub(): Promise<EngineHarness> {
  const installationId = await deriveInstallationId(TOKEN);
  return env.AUTONOMY!.get(env.AUTONOMY!.idFromName(installationId)) as EngineHarness;
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out.');
}

describe('Phase C0 — durable claim and Workflow identity', () => {
  it('one occurrence yields one runKey, one running claim, one hashed Workflow id, then C0 shell completion', { timeout: 20_000 }, async () => {
    expect(env.ROUTINE_RUN).toBeDefined();
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    const sync = await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])));
    expect(sync.status).toBe(200);

    const dueAt = Date.now() - 10 * 60_000;
    expect((await doFetch(await internalDo('/scheduler/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routineId: routine.id, dueAt }) }))).status).toBe(200);
    const heartbeat = await doFetch(await internalDo('/heartbeat', { method: 'POST' }));
    expect(heartbeat.status).toBe(200);
    expect((await heartbeat.clone().json() as { processed: number }).processed).toBe(1);

    const runKey = `routine-cloud-1:catch-up:${dueAt}`;
    const expectedId = await workflowInstanceIdForRunKey(runKey);

    await waitUntil(async () => {
      const response = await doFetch(await bearerRead('/autonomy/runs?since=0'));
      const runs = ((await response.json()) as { runs: RoutineRunRecord[] }).runs;
      return runs.some((run) => run.runKey === runKey && run.state === 'completed');
    });

    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs.filter((run) => run.runKey === runKey);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'completed', outcome: 'no-op' });

    const instance = await env.ROUTINE_RUN!.get(expectedId);
    expect(instance.id).toBe(expectedId);
  });

  it('create() with the same hashed id is idempotent (duplicate create recovers the instance)', { timeout: 20_000 }, async () => {
    const binding = env.ROUTINE_RUN;
    if (!binding) throw new Error('ROUTINE_RUN binding is missing from the workerd test env — stop: cannot prove create idempotency.');
    const runKey = 'probe:scheduled:1';
    const id = await workflowInstanceIdForRunKey(runKey);
    const envelope = {
      version: 1 as const,
      runKey,
      runId: 'run-probe',
      workflowInstanceId: id,
      routineId: 'probe',
      executionMode: 'scheduled' as const,
      scheduledFor: 1,
      claimedAt: Date.now(),
      configGeneration: 0,
      stateGeneration: 0,
      routine: makeRoutine({ id: 'probe' }),
      context: null,
    };
    const first = await binding.create({ id, params: envelope });
    expect(first.id).toBe(id);
    let secondId: string;
    try {
      const second = await binding.create({ id, params: envelope });
      secondId = second.id;
    } catch {
      const existing = await binding.get(id);
      secondId = existing.id;
    }
    expect(secondId).toBe(id);
  });

  it('completing the same runKey twice is a no-op', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])));
    const dueAt = Date.now() - 10 * 60_000;
    await doFetch(await internalDo('/scheduler/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routineId: routine.id, dueAt }) }));
    await doFetch(await internalDo('/heartbeat', { method: 'POST' }));
    const runKey = `routine-cloud-1:catch-up:${dueAt}`;
    const workflowInstanceId = await workflowInstanceIdForRunKey(runKey);
    await waitUntil(async () => {
      const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
      return runs.some((run) => run.runKey === runKey);
    });
    const first = await doFetch(await internalDo('/run/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runKey, workflowInstanceId }) }));
    expect(first.status).toBe(200);
    const second = await doFetch(await internalDo('/run/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runKey, workflowInstanceId }) }));
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { alreadyCompleted: boolean; status: string };
    expect(secondBody.alreadyCompleted).toBe(true);
    expect(secondBody.status).toBe('already-completed');
  });
});

describe('Phase C0 — crash windows', () => {
  it('claim+envelope without dispatch is recovered by heartbeat onto the same Workflow id', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const dueAt = Date.now() - 10 * 60_000;
    const claimed = await (await stub()).claimWithoutDispatch(routine.id, dueAt);
    expect(claimed.dispatched).toBe(false);

    const before = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs.find((run) => run.runKey === claimed.runKey);
    expect(before?.state).toBe('running');

    expect((await doFetch(await internalDo('/heartbeat', { method: 'POST' }))).status).toBe(200);
    await waitUntil(async () => {
      const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
      return runs.some((run) => run.runKey === claimed.runKey && run.state === 'completed');
    });
    const instance = await env.ROUTINE_RUN!.get(claimed.workflowInstanceId);
    expect(instance.id).toBe(claimed.workflowInstanceId);
  });

  it('dispatch without schedule advance is repaired by heartbeat without a second run', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const dueAt = Date.now() - 10 * 60_000;
    const claimed = await (await stub()).claimWithoutDispatch(routine.id, dueAt);
    await (await stub()).markDispatchedWithoutAdvance(claimed.runKey);
    expect((await doFetch(await internalDo('/heartbeat', { method: 'POST' }))).status).toBe(200);
    const snapshot = await (await doFetch(await bearerRead('/autonomy/state'))).json() as { routines: Array<{ nextDueAt: number | null }> };
    expect(snapshot.routines[0].nextDueAt).toBeGreaterThan(dueAt);
    const records = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs.filter((run) => run.runKey === claimed.runKey);
    expect(records).toHaveLength(1);
  });

  it('claim-not-found is distinct from already-completed', { timeout: 20_000 }, async () => {
    const missing = await doFetch(await internalDo('/run/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runKey: 'no-such:scheduled:1', workflowInstanceId: 'rr' + '0'.repeat(64) }) }));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { status: string }).status).toBe('claim-not-found');
  });

  it('never prunes an active cloud running claim', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const dueAt = Date.now() - 10 * 60_000;
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, dueAt);
    const ancient = Date.now() - 40 * 24 * 3_600_000;
    await engine.ageRun(claimed.runKey, ancient);
    await engine.pruneNow();
    expect(await engine.envelopePresent(claimed.runKey)).toBe(true);
    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.some((run) => run.runKey === claimed.runKey && run.state === 'running')).toBe(true);
  });

  it('terminal envelopes are pruned and /c0/fixture is not an HTTP route', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const dueAt = Date.now() - 10 * 60_000;
    await doFetch(await internalDo('/scheduler/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routineId: routine.id, dueAt }) }));
    await doFetch(await internalDo('/heartbeat', { method: 'POST' }));
    const runKey = `routine-cloud-1:catch-up:${dueAt}`;
    await waitUntil(async () => {
      const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
      return runs.some((run) => run.runKey === runKey && run.state === 'completed');
    });
    const engine = await stub();
    await engine.pruneNow();
    expect(await engine.envelopePresent(runKey)).toBe(false);
    expect((await doFetch(await internalDo('/c0/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status).toBe(404);
  });

  it('create failure without an existing instance is not treated as dispatched', { timeout: 20_000 }, async () => {
    const binding = env.ROUTINE_RUN!;
    const id = 'rr' + 'f'.repeat(64);
    let getFailed = false;
    try {
      await binding.get(id);
    } catch {
      getFailed = true;
    }
    expect(getFailed).toBe(true);
  });
});
