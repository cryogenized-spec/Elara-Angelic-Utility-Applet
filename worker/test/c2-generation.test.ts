import { beforeEach, describe, expect, it } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId } from '../../src/autonomy/protocol';
import { STALE_GENERATION_CODE } from '../../src/autonomy/scheduler';
import type { AutonomousEvent, RoutineRunRecord } from '../../src/autonomy/contracts';
import { TOKEN, bearerRead, configPayload, internalDo, makeRoutine, signedWrite } from './helpers';

beforeEach(async () => {
  await reset();
});

type EngineHarness = DurableObjectStub & {
  claimWithoutDispatch(routineId: string, dueAt: number): Promise<{ runKey: string; workflowInstanceId: string; dispatched: boolean }>;
  setConfigGeneration(generation: number): Promise<{ generation: number }>;
  setMasterEnabled(enabled: boolean): Promise<{ enabled: boolean }>;
  disableRoutine(routineId: string): Promise<{ disabled: boolean }>;
  deleteRoutineMirror(routineId: string): Promise<{ deleted: boolean }>;
  holdNextDispatch(): Promise<void>;
  waitUntilDispatchHeld(): Promise<void>;
  releaseHeldDispatch(): Promise<void>;
};

async function stub(): Promise<EngineHarness> {
  const installationId = await deriveInstallationId(TOKEN);
  return env.AUTONOMY!.get(env.AUTONOMY!.idFromName(installationId)) as EngineHarness;
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

const eventResult = {
  disposition: 'event' as const,
  title: 'C2 inbox note',
  summary: 'Must not survive a generation bump.',
  importance: 2 as const,
  confidence: 2 as const,
};

async function complete(runKey: string, workflowInstanceId: string, result = eventResult): Promise<Response> {
  return doFetch(await internalDo('/run/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runKey, workflowInstanceId, result }),
  }));
}

async function dueAt(routineId: string): Promise<number | null> {
  const state = await (await doFetch(await bearerRead('/autonomy/state'))).json() as { routines: Array<{ id: string; nextDueAt: number | null }> };
  return state.routines.find((routine) => routine.id === routineId)?.nextDueAt ?? null;
}

describe('Phase C2 — generation enforcement', () => {
  it('generation N completes while N is current: event admitted, schedule may advance', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    const beforeDue = await dueAt(routine.id);
    const response = await complete(claimed.runKey, claimed.workflowInstanceId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe('completed');
    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events.filter((event) => event.runKey === claimed.runKey)).toHaveLength(1);
    const afterDue = await dueAt(routine.id);
    expect(afterDue).not.toBe(beforeDue);
  });

  it('generation N is rejected after config becomes N+1: no event, no schedule advance, retry idempotent', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const due = Date.now() - 10 * 60_000;
    const claimed = await engine.claimWithoutDispatch(routine.id, due);
    const beforeDue = await dueAt(routine.id);
    await engine.setConfigGeneration(2);
    const afterBumpDue = await dueAt(routine.id);

    const first = await complete(claimed.runKey, claimed.workflowInstanceId);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { status: string }).status).toBe('stale');

    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.find((run) => run.runKey === claimed.runKey)).toMatchObject({ state: 'failed', errorCode: STALE_GENERATION_CODE });
    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events.filter((event) => event.runKey === claimed.runKey)).toHaveLength(0);
    expect(await dueAt(routine.id)).toBe(afterBumpDue);
    expect(beforeDue).toBe(due);

    const retry = await complete(claimed.runKey, claimed.workflowInstanceId, { ...eventResult, title: 'Retry payload' });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe('already-completed');
    const afterRetry = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(afterRetry.filter((event) => event.runKey === claimed.runKey)).toHaveLength(0);
  });

  it('master-off without a generation bump is cancelled-admission: no event, no schedule advance', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    const beforeDue = await dueAt(routine.id);
    await engine.setMasterEnabled(false);
    const response = await complete(claimed.runKey, claimed.workflowInstanceId);
    expect(((await response.json()) as { status: string }).status).toBe('cancelled');
    expect(((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events).toHaveLength(0);
    expect(await dueAt(routine.id)).toBe(beforeDue);
  });

  it('routine disablement without a generation bump is cancelled-admission', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    const beforeDue = await dueAt(routine.id);
    await engine.disableRoutine(routine.id);
    const response = await complete(claimed.runKey, claimed.workflowInstanceId);
    expect(((await response.json()) as { status: string }).status).toBe('cancelled');
    expect(((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events).toHaveLength(0);
    expect(await dueAt(routine.id)).toBe(beforeDue);
  });

  it('routine deletion without a generation bump is cancelled-admission', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    await engine.deleteRoutineMirror(routine.id);
    const response = await complete(claimed.runKey, claimed.workflowInstanceId);
    expect(((await response.json()) as { status: string }).status).toBe('cancelled');
    expect(((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events).toHaveLength(0);
  });

  it('a current-generation claim is unaffected by an older stale claim', { timeout: 20_000 }, async () => {
    const first = makeRoutine({ id: 'routine-stale-a', schedule: { kind: 'interval', everyMinutes: 30 } });
    const second = makeRoutine({ id: 'routine-fresh-b', name: 'Fresh brief', schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [first, second])))).status).toBe(200);
    const engine = await stub();
    const staleClaim = await engine.claimWithoutDispatch(first.id, Date.now() - 20 * 60_000);
    await engine.setConfigGeneration(2);
    const freshClaim = await engine.claimWithoutDispatch(second.id, Date.now() - 10 * 60_000);

    const staleResponse = await complete(staleClaim.runKey, staleClaim.workflowInstanceId);
    expect(((await staleResponse.json()) as { status: string }).status).toBe('stale');
    const freshResponse = await complete(freshClaim.runKey, freshClaim.workflowInstanceId, { ...eventResult, title: 'Fresh note', summary: 'Claimed after the bump.' });
    expect(((await freshResponse.json()) as { status: string }).status).toBe('completed');

    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events.map((event) => event.runKey).sort()).toEqual([freshClaim.runKey]);
  });

  it('racing completeClaims cannot admit a stale result', { timeout: 20_000 }, async () => {
    const first = makeRoutine({ id: 'routine-race-stale', schedule: { kind: 'interval', everyMinutes: 30 } });
    const second = makeRoutine({ id: 'routine-race-fresh', name: 'Race fresh', schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [first, second])))).status).toBe(200);
    const engine = await stub();
    const staleClaim = await engine.claimWithoutDispatch(first.id, Date.now() - 20 * 60_000);
    await engine.setConfigGeneration(2);
    const freshClaim = await engine.claimWithoutDispatch(second.id, Date.now() - 10 * 60_000);

    const responses = await Promise.all([
      complete(staleClaim.runKey, staleClaim.workflowInstanceId, { ...eventResult, title: 'Stale racer' }),
      complete(freshClaim.runKey, freshClaim.workflowInstanceId, { ...eventResult, title: 'Fresh racer', summary: 'Current generation.' }),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const statuses = (await Promise.all(responses.map(async (response) => ((await response.json()) as { status: string }).status))).sort();
    expect(statuses).toEqual(['completed', 'stale']);
    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0].runKey).toBe(freshClaim.runKey);
    expect(events[0].title).toBe('Fresh racer');
  });

  it('real config sync to N+1 terminalizes an in-flight claim without resurrecting its schedule', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const due = Date.now() - 10 * 60_000;
    const claimed = await engine.claimWithoutDispatch(routine.id, due);
    const disabled = { ...routine, enabled: false };
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(2, [disabled])))).status).toBe(200);
    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.find((run) => run.runKey === claimed.runKey)).toMatchObject({ state: 'failed', errorCode: STALE_GENERATION_CODE });
    expect(((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events).toHaveLength(0);
    expect(await dueAt(routine.id)).toBeNull();
  });

  it('cannot_act is persisted as cannot_act, not no-op', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    const response = await complete(claimed.runKey, claimed.workflowInstanceId, { disposition: 'cannot_act', reason: 'frozen context is empty' } as never);
    expect(((await response.json()) as { status: string }).status).toBe('completed');
    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.find((run) => run.runKey === claimed.runKey)).toMatchObject({ state: 'completed', outcome: 'cannot_act', reason: 'frozen context is empty' });
  });

  it('config change during held dispatch cannot advance the stale schedule', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const due = Date.now() - 10 * 60_000;
    const claimed = await engine.claimWithoutDispatch(routine.id, due);
    await engine.holdNextDispatch();
    const heartbeat = doFetch(await internalDo('/heartbeat', { method: 'POST' }));
    await engine.waitUntilDispatchHeld();
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(2, [{ ...routine, enabled: false }])))).status).toBe(200);
    await engine.releaseHeldDispatch();
    expect((await heartbeat).status).toBe(200);
    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.find((run) => run.runKey === claimed.runKey)).toMatchObject({ state: 'failed', errorCode: STALE_GENERATION_CODE });
    expect(await dueAt(routine.id)).toBeNull();
  });

  it('wrong workflow identity is 409 even when the run is also stale', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const engine = await stub();
    const claimed = await engine.claimWithoutDispatch(routine.id, Date.now() - 10 * 60_000);
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(2, [routine])))).status).toBe(200);
    const mismatch = await complete(claimed.runKey, 'rr' + '0'.repeat(64));
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { status: string }).status).toBe('identity-mismatch');
    expect(((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events).toHaveLength(0);
  });
});
