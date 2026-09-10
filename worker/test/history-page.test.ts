import { beforeEach, describe, expect, it } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId } from '../../src/autonomy/protocol';
import type { RoutineRunRecord } from '../../src/autonomy/contracts';
import { TOKEN, bearerRead, configPayload, makeRoutine, signedWrite } from './helpers';

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

describe('cloud history keyset pages', () => {
  it('returns 250 runs across pages without skipping same-timestamp siblings', { timeout: 30_000 }, async () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', everyMinutes: 30 } });
    const engine = await stub();
    expect((await engine.fetch(await signedWrite('/autonomy/config', configPayload(1, [routine])))).status).toBe(200);
    const stamp = Date.now() - 60 * 60_000;
    for (let index = 0; index < 250; index += 1) {
      await engine.claimWithoutDispatch(routine.id, stamp + index);
    }
    const first = await (await engine.fetch(await bearerRead('/autonomy/runs?afterAt=0&afterId=&limit=200'))).json() as { runs: RoutineRunRecord[]; next: { at: number; id: string } | null };
    expect(first.runs).toHaveLength(200);
    expect(first.next).toEqual({ at: first.runs[199]!.startedAt, id: first.runs[199]!.id });
    const second = await (await engine.fetch(await bearerRead(`/autonomy/runs?afterAt=${first.next!.at}&afterId=${encodeURIComponent(first.next!.id)}&limit=200`))).json() as { runs: RoutineRunRecord[]; next: { at: number; id: string } | null };
    expect(second.runs).toHaveLength(50);
    expect(second.next).toBeNull();
    const replay = await (await engine.fetch(await bearerRead('/autonomy/runs?afterAt=0&afterId=&limit=200'))).json() as { runs: RoutineRunRecord[] };
    expect(replay.runs.map((run) => run.id)).toEqual(first.runs.map((run) => run.id));
    const empty = await (await engine.fetch(await bearerRead(`/autonomy/runs?afterAt=${second.runs[49]!.startedAt}&afterId=${encodeURIComponent(second.runs[49]!.id)}&limit=200`))).json() as { runs: RoutineRunRecord[] };
    expect(empty.runs).toHaveLength(0);
    const ids = [...first.runs, ...second.runs].map((run) => run.id);
    expect(new Set(ids).size).toBe(250);
  });
});
