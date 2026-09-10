import { describe, expect, it } from 'vitest';
import { workflowInstanceIdForRunKey } from './workflow-identity';

describe('workflowInstanceIdForRunKey', () => {
  it('is deterministic, charset-safe, and distinct from the domain runKey', async () => {
    const runKey = 'routine-cloud-1:scheduled:1700000000000';
    const first = await workflowInstanceIdForRunKey(runKey);
    const second = await workflowInstanceIdForRunKey(runKey);
    expect(first).toBe(second);
    expect(first).toMatch(/^rr[0-9a-f]{64}$/);
    expect(first).not.toContain(':');
    expect(first).not.toBe(runKey);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it('different runKeys produce different instance ids', async () => {
    const a = await workflowInstanceIdForRunKey('r-1:scheduled:1');
    const b = await workflowInstanceIdForRunKey('r-1:catch-up:1');
    expect(a).not.toBe(b);
  });
});
