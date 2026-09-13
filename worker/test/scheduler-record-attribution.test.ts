import { beforeEach, expect, it } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId } from '../../src/autonomy/protocol';
import { SCHEDULER_BUDGET_CODE } from '../../src/autonomy/scheduler';
import type { RoutineRunRecord } from '../../src/autonomy/contracts';
import { TOKEN, bearerRead, configPayload, internalDo, makeRoutine, signedWrite } from './helpers';

beforeEach(async () => {
  await reset();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.AUTONOMY!.get(env.AUTONOMY!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

async function runs(): Promise<RoutineRunRecord[]> {
  const response = await doFetch(await bearerRead('/autonomy/runs?since=0'));
  expect(response.status).toBe(200);
  return ((await response.json() as { runs: RoutineRunRecord[] }).runs);
}

async function ensureScheduled(routineId: string, dueAt: number): Promise<void> {
  const response = await doFetch(await internalDo('/scheduler/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routineId, dueAt }),
  }));
  expect(response.status).toBe(200);
}

async function heartbeat(): Promise<void> {
  const response = await doFetch(await internalDo('/heartbeat', { method: 'POST' }));
  expect(response.status).toBe(200);
}

it('attributes a repeated ensureScheduled budget refusal to the exact requested occurrence', async () => {
  const routine = makeRoutine({
    schedule: { kind: 'interval', everyMinutes: 30 },
    policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 1 },
  });
  const sync = await doFetch(await signedWrite('/autonomy/config', configPayload(1, [routine])));
  expect(sync.status).toBe(200);

  const firstDue = Date.now() - 5 * 60_000;
  await ensureScheduled(routine.id, firstDue);
  await heartbeat();

  const afterFirst = (await runs()).filter((run) => run.routineId === routine.id);
  expect(afterFirst.filter((run) => run.scheduledFor === firstDue)).toHaveLength(1);

  // Exhausted budget, two distinct caller-supplied occurrences. This makes the
  // attribution check adversarial on purpose: a generic `find(errorCode)` has
  // two valid refusal candidates and therefore cannot prove which occurrence
  // it is talking about.
  const intermediateDue = firstDue + 60_000;
  await ensureScheduled(routine.id, intermediateDue);
  await heartbeat();

  const secondDue = firstDue + 3 * 60_000;
  await ensureScheduled(routine.id, secondDue);
  await heartbeat();

  const records = (await runs()).filter((run) => run.routineId === routine.id);
  const firstOccurrence = records.filter((run) => run.scheduledFor === firstDue);
  const intermediateOccurrence = records.filter((run) => run.scheduledFor === intermediateDue);
  const secondOccurrence = records.filter((run) => run.scheduledFor === secondDue);

  expect(firstOccurrence).toHaveLength(1);
  expect(intermediateOccurrence).toHaveLength(1);
  expect(intermediateOccurrence[0]).toMatchObject({
    scheduledFor: intermediateDue,
    state: 'skipped',
    outcome: 'skipped',
    errorCode: SCHEDULER_BUDGET_CODE,
  });

  // Natural-key attribution first, refusal assertion second. An earlier valid
  // budget refusal must never satisfy the requested second occurrence.
  expect(secondOccurrence).toHaveLength(1);
  expect(secondOccurrence[0]).toMatchObject({
    scheduledFor: secondDue,
    state: 'skipped',
    outcome: 'skipped',
    errorCode: SCHEDULER_BUDGET_CODE,
  });
});
