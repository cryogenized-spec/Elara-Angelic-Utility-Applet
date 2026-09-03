import { describe, expect, it } from 'vitest';
import { GoogleTasksService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

const makeOAuth = (requested: string[]): GoogleOAuthAuthority => ({
  authorize: async (capability) => {
    requested.push(capability);
    return {
      capability,
      fetch: async () => new Response(JSON.stringify({ id: 'task-1', title: 'Review Kanban', status: 'needsAction', position: '0001' }), { status: 200 }),
    };
  },
  getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
  disconnect: async () => undefined,
});

describe('GoogleTasksService', () => {
  it('uses the read capability for retrieval', async () => {
    const requested: string[] = [];
    const service = new GoogleTasksService(makeOAuth(requested));
    await expect(service.getTask('list-1', 'task-1')).resolves.toMatchObject({ id: 'task-1', title: 'Review Kanban' });
    expect(requested).toEqual(['tasks.read']);
  });

  it('uses write capability for reordering', async () => {
    const requested: string[] = [];
    const service = new GoogleTasksService(makeOAuth(requested));
    await expect(service.moveTask('list-1', 'task-1', 'parent-1', 'previous-1')).resolves.toMatchObject({ id: 'task-1' });
    expect(requested).toEqual(['tasks.write']);
  });
});
