import { describe, expect, it } from 'vitest';
import { requestGoogleToolConfirmations } from './broker';

const request = {
  tool: 'calendar.createEvent' as const,
  risk: 'write' as const,
  resourceSummary: 'Create Calendar event “Design review”.',
  requestedAt: '2026-09-07T06:00:00.000Z',
};

describe('Google confirmation broker', () => {
  it('fails closed outside the browser for every requested mutation', async () => {
    await expect(requestGoogleToolConfirmations([request, { ...request, tool: 'tasks.createTask' as const }])).resolves.toEqual([false, false]);
  });
});
