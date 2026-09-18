import { describe, expect, it } from 'vitest';
import { cloudAdmitFromOutcome, cloudAdmitResultSchema } from './cloud-result';

describe('C1 cloud admit contract', () => {
  it('rejects tool and web evidence on the C1 event schema', () => {
    expect(cloudAdmitResultSchema.safeParse({
      disposition: 'event', title: 't', summary: 's', importance: 2, confidence: 2,
      evidence: [{ kind: 'tool', ref: 'calendar.listEvents' }],
    }).success).toBe(false);
    expect(cloudAdmitResultSchema.safeParse({
      disposition: 'event', title: 't', summary: 's', importance: 2, confidence: 2,
      evidence: [{ kind: 'web', ref: 'https://example.com' }],
    }).success).toBe(false);
  });

  it('maps a model tool-evidence proposal to an execution contract error', () => {
    const result = cloudAdmitFromOutcome({
      outcome: 'event',
      title: 't',
      summary: 's',
      importance: 2,
      confidence: 2,
      evidence: [{ kind: 'tool', ref: 'calendar.listEvents' }],
    });
    expect(result).toMatchObject({ disposition: 'error', source: 'execution', errorCode: 'OUTCOME_INVALID_CONTRACT' });
  });
});
