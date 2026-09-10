import { describe, expect, it } from 'vitest';
import { hashConfigPayload } from './config-identity';
import { normalizeRoutine } from './contracts';

const routine = normalizeRoutine({
  id: 'r-1',
  name: 'Brief',
  enabled: true,
  instruction: 'Summarize.',
  schedule: { kind: 'daily', time: '09:00', days: 'every' },
  timezone: 'UTC',
  permissions: { memory: false, google: [] },
  delivery: { inbox: true, push: false, minImportanceForPush: 2 },
  policy: { cooldownHours: 24, maxToolCalls: 8, maxRunsPerDay: 4 },
  createdAt: 1,
  updatedAt: 1,
});

describe('hashConfigPayload', () => {
  it('is stable for equivalent payloads regardless of routine array order', async () => {
    const other = { ...routine, id: 'r-2', name: 'Other' };
    const a = await hashConfigPayload({ enabled: true, maxEventsPerDay: 10, routines: [routine, other] });
    const b = await hashConfigPayload({ enabled: true, maxEventsPerDay: 10, routines: [other, routine] });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('is stable across nested property insertion order', async () => {
    const a = await hashConfigPayload({ enabled: true, maxEventsPerDay: 10, routines: [routine] });
    const b = await hashConfigPayload({
      maxEventsPerDay: 10,
      enabled: true,
      routines: [{
        ...routine,
        permissions: { google: [], memory: false },
        delivery: { minImportanceForPush: 2, push: false, inbox: true },
      }],
    });
    expect(a).toBe(b);
  });

  it('changes when enabled, budget, or a routine field changes', async () => {
    const base = await hashConfigPayload({ enabled: true, maxEventsPerDay: 10, routines: [routine] });
    expect(await hashConfigPayload({ enabled: false, maxEventsPerDay: 10, routines: [routine] })).not.toBe(base);
    expect(await hashConfigPayload({ enabled: true, maxEventsPerDay: 9, routines: [routine] })).not.toBe(base);
    expect(await hashConfigPayload({ enabled: true, maxEventsPerDay: 10, routines: [{ ...routine, instruction: 'Different.' }] })).not.toBe(base);
  });
});
