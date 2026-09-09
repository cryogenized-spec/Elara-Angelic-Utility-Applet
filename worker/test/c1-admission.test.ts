import { beforeEach, describe, expect, it } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId } from '../../src/autonomy/protocol';
import { eventIdForRunKey, workflowInstanceIdForRunKey } from '../../src/autonomy/workflow-identity';
import type { AutonomousEvent, RoutineRunRecord } from '../../src/autonomy/contracts';
import { TOKEN, bearerRead, configPayload, internalDo, makeRoutine, signedWrite } from './helpers';

beforeEach(async () => {
  await reset();
});

type EngineHarness = DurableObjectStub & {
  claimWithoutDispatch(routineId: string, dueAt: number): Promise<{ runKey: string; workflowInstanceId: string; dispatched: boolean }>;
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

const EVENT_STUB = JSON.stringify({
  disposition: 'event',
  title: 'C1 inbox note',
  summary: 'A single admitted cloud event.',
  importance: 2,
  confidence: 2,
});

describe('Phase C1 — Workflow to durable event', () => {
  it('Workflow stub event is admitted once: one event row, run references it, retry is already-completed', { timeout: 20_000 }, async () => {
    const routine = makeRoutine({
      schedule: { kind: 'interval', everyMinutes: 30 },
      instruction: `C1_STUB:${EVENT_STUB}`,
      policy: { cooldownHours: 1, maxToolCalls: 8, maxRunsPerDay: 4 },
    });
    expect((await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const dueAt = Date.now() - 10 * 60_000;
    await doFetch(await internalDo('/scheduler/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routineId: routine.id, dueAt }) }));
    expect((await doFetch(await internalDo('/heartbeat', { method: 'POST' }))).status).toBe(200);
    const runKey = `${routine.id}:catch-up:${dueAt}`;
    const expectedEventId = await eventIdForRunKey(runKey);

    await waitUntil(async () => {
      const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
      return runs.some((run) => run.runKey === runKey && run.state === 'completed');
    });

    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs.filter((run) => run.runKey === runKey);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'completed', outcome: 'event', eventId: expectedEventId });

    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events.filter((event) => event.runKey === runKey)).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: expectedEventId, title: 'C1 inbox note', routineId: routine.id });

    const workflowInstanceId = await workflowInstanceIdForRunKey(runKey);
    const retry = await doFetch(await internalDo('/run/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runKey, workflowInstanceId, result: JSON.parse(EVENT_STUB) }),
    }));
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe('already-completed');
    const after = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events.filter((event) => event.runKey === runKey);
    expect(after).toHaveLength(1);
  });

  it('rolling 24h event cap is enforced inside DO admission across distinct runKeys', { timeout: 20_000 }, async () => {
    const firstRoutine = makeRoutine({
      id: 'routine-budget-a',
      schedule: { kind: 'interval', everyMinutes: 30 },
      policy: { cooldownHours: 1, maxToolCalls: 8, maxRunsPerDay: 8 },
    });
    const secondRoutine = makeRoutine({
      id: 'routine-budget-b',
      name: 'Second brief',
      schedule: { kind: 'interval', everyMinutes: 30 },
      policy: { cooldownHours: 1, maxToolCalls: 8, maxRunsPerDay: 8 },
    });
    const payload = JSON.stringify({ generation: 1, enabled: true, maxEventsPerDay: 1, routines: [firstRoutine, secondRoutine] });
    expect((await doFetch(await signedWrite('/autonomy/config', payload))).status).toBe(200);

    const firstDue = Date.now() - 20 * 60_000;
    const secondDue = Date.now() - 10 * 60_000;
    const engine = await stub();
    const first = await engine.claimWithoutDispatch(firstRoutine.id, firstDue);
    const second = await engine.claimWithoutDispatch(secondRoutine.id, secondDue);
    const eventResult = {
      disposition: 'event' as const,
      title: 'Budget probe',
      summary: 'Should consume the only daily slot.',
      importance: 2 as const,
      confidence: 2 as const,
    };
    const firstComplete = await doFetch(await internalDo('/run/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runKey: first.runKey, workflowInstanceId: first.workflowInstanceId, result: eventResult }),
    }));
    expect(firstComplete.status).toBe(200);
    expect(((await firstComplete.json()) as { status: string }).status).toBe('completed');

    const secondComplete = await doFetch(await internalDo('/run/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runKey: second.runKey, workflowInstanceId: second.workflowInstanceId, result: { ...eventResult, title: 'Budget probe two', summary: 'Must be suppressed.' } }),
    }));
    expect(secondComplete.status).toBe(200);
    expect(((await secondComplete.json()) as { status: string }).status).toBe('suppressed');

    const events = ((await (await doFetch(await bearerRead('/autonomy/events?since=0'))).json()) as { events: AutonomousEvent[] }).events;
    expect(events).toHaveLength(1);
    expect(events[0].runKey).toBe(first.runKey);
    const runs = ((await (await doFetch(await bearerRead('/autonomy/runs?since=0'))).json()) as { runs: RoutineRunRecord[] }).runs;
    expect(runs.find((run) => run.runKey === second.runKey)).toMatchObject({ outcome: 'suppressed', suppressedReason: 'daily-cap' });
  });
});
