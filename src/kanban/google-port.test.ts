import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleOAuthAuthority } from '../google/oauth/authority';
import type { GoogleOAuthStatus } from '../google/oauth/contracts';
import { taskService } from './google-port';

const ready: GoogleOAuthStatus = { state: 'connected', account: { email: 'one@example.com' }, sessionReady: true, enabledCapabilities: ['tasks.read', 'tasks.write'], grantedCapabilities: ['tasks.read', 'tasks.write'], grantedProviderScopes: [] };
afterEach(() => vi.restoreAllMocks());
describe('human board authorization boundary', () => {
  it('never opens consent for metadata-only sessions', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue({ ...ready, sessionReady: false });
    const authorize = vi.spyOn(googleOAuthAuthority, 'authorize');
    await expect(taskService.listTaskLists()).rejects.toThrow('unlock Google');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('rejects writes without effective write permission before consent or fetch', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue({ ...ready, grantedCapabilities: ['tasks.read'] });
    const authorize = vi.spyOn(googleOAuthAuthority, 'authorize');
    await expect(taskService.createTaskList('Work')).rejects.toThrow('permission');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('does not issue a provider fetch if account identity changes during authorization', async () => {
    const status = vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response('{}'));
    vi.spyOn(googleOAuthAuthority, 'authorize').mockImplementation(async (capability) => {
      status.mockResolvedValue({ ...ready, account: { email: 'two@example.com' } });
      return { capability, fetch };
    });
    await expect(taskService.listTaskLists()).rejects.toThrow('account changed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the authorized transport and emits invalidation only after a successful write', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'list', title: 'Work' })));
    vi.spyOn(googleOAuthAuthority, 'authorize').mockImplementation(async (capability) => ({ capability, fetch }));
    const listener = vi.fn(); window.addEventListener('elara:tasks-changed', listener);
    try {
      await expect(taskService.createTaskList('Work')).resolves.toMatchObject({ id: 'list' });
      expect(fetch).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('elara:tasks-changed', listener); }
  });
});
