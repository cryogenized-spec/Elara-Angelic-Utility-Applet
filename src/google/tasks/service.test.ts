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


describe('kanban writes', () => {
  it('patches only edited fields with If-Match and preserves response metadata', async () => {
    let received: RequestInit | undefined;
    const oauth = makeOAuth([]);
    oauth.authorize = async (capability) => ({ capability, fetch: async (_url, init) => {
      received = init;
      return new Response(JSON.stringify({ id: 't', title: '', etag: 'next', completed: '2026-09-18', hidden: true }));
    } });
    const result = await new GoogleTasksService(oauth).patchTask('list', 't', { notes: 'Updated' }, 'original');
    expect(received?.method).toBe('PATCH');
    expect(new Headers(received?.headers).get('If-Match')).toBe('original');
    expect(JSON.parse(String(received?.body))).toEqual({ notes: 'Updated' });
    expect(result).toMatchObject({ title: '', etag: 'next', hidden: true });
  });
  it('surfaces conflicts without retrying or overwriting', async () => {
    const oauth = makeOAuth([]);
    let calls = 0;
    oauth.authorize = async (capability) => ({ capability, fetch: async () => { calls++; return new Response('', { status: 412 }); } });
    await expect(new GoogleTasksService(oauth).patchTask('list', 'task', { title: 'Mine' }, 'stale')).rejects.toThrow('changed in Google');
    expect(calls).toBe(1);
  });
  it('validates new list titles before authorization', async () => {
    const requested: string[] = [];
    await expect(new GoogleTasksService(makeOAuth(requested)).createTaskList('   ')).rejects.toThrow('title');
    expect(requested).toEqual([]);
  });
});

describe('task-list management', () => {
  it('renames only the title using PATCH with the original ETag', async () => {
    let request: RequestInit | undefined;
    let path = '';
    const oauth = makeOAuth([]);
    oauth.authorize = async (capability) => ({ capability, fetch: async (url, init) => { path = String(url); request = init; return new Response(JSON.stringify({ id: 'list/a', title: 'Next' })); } });
    await new GoogleTasksService(oauth).renameTaskList('list/a', ' Next ', 'original');
    expect(path).toContain('/users/@me/lists/list%2Fa');
    expect(request?.method).toBe('PATCH');
    expect(new Headers(request?.headers).get('If-Match')).toBe('original');
    expect(JSON.parse(String(request?.body))).toEqual({ title: 'Next' });
  });
  it('handles 204 list deletions without parsing JSON', async () => {
    let request: RequestInit | undefined;
    const oauth = makeOAuth([]);
    oauth.authorize = async (capability) => ({ capability, fetch: async (_url, init) => { request = init; return new Response(null, { status: 204 }); } });
    await expect(new GoogleTasksService(oauth).deleteTaskList('list', 'original')).resolves.toBeUndefined();
    expect(request?.method).toBe('DELETE');
    expect(new Headers(request?.headers).get('If-Match')).toBe('original');
  });
  it('rejects empty list identifiers before requesting OAuth', async () => {
    const requested: string[] = [];
    await expect(new GoogleTasksService(makeOAuth(requested)).deleteTaskList(' ')).rejects.toThrow('required');
    expect(requested).toEqual([]);
  });
});
