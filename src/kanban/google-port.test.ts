import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleOAuthAuthority } from '../google/oauth/authority';
import type { GoogleOAuthStatus } from '../google/oauth/contracts';
import { taskService, taskServiceForAccount } from './google-port';

const ready: GoogleOAuthStatus = { state: 'connected', account: { email: 'one@example.com' }, sessionReady: true, enabledCapabilities: ['tasks.read', 'tasks.write'], grantedCapabilities: ['tasks.read', 'tasks.write'], grantedProviderScopes: [] };
afterEach(() => vi.restoreAllMocks());
describe('human board authorization boundary', () => {
  it('never opens consent for metadata-only sessions', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue({ ...ready, sessionReady: false });
    const authorize = vi.spyOn(googleOAuthAuthority, 'authorizeExisting');
    await expect(taskService.listTaskLists()).rejects.toThrow('unlock Google');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('rejects writes without effective write permission before consent or fetch', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue({ ...ready, grantedCapabilities: ['tasks.read'] });
    const authorize = vi.spyOn(googleOAuthAuthority, 'authorizeExisting');
    await expect(taskService.createTaskList('Work')).rejects.toThrow('permission');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('rejects a human board write if the displayed account changed before authorization begins', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue({ ...ready, account: { email: 'two@example.com' } });
    const authorize = vi.spyOn(googleOAuthAuthority, 'authorizeExisting');
    const bound = taskServiceForAccount('one@example.com');

    await expect(bound.createTaskList('Work')).rejects.toThrow('account changed');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('does not issue a provider fetch if account identity changes during authorization', async () => {
    const status = vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response('{}'));
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => {
      status.mockResolvedValue({ ...ready, account: { email: 'two@example.com' } });
      return { capability, fetch };
    });
    await expect(taskService.listTaskLists()).rejects.toThrow('account changed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks identity at the actual provider boundary after transport work', async () => {
    const status = vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const providerFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit, beforeProviderFetch?: () => void | Promise<void>) => {
      status.mockResolvedValue({ ...ready, account: { email: 'two@example.com' } });
      await beforeProviderFetch?.();
      return new Response(JSON.stringify({ items: [] }));
    });
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch: providerFetch }));

    await expect(taskService.listTaskLists()).rejects.toThrow('account changed');
    expect(providerFetch).toHaveBeenCalledOnce();
  });
  it('uses only the noninteractive transport after live-session admission', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const interactive = vi.spyOn(googleOAuthAuthority, 'authorize');
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch }));
    await expect(taskService.listTaskLists()).resolves.toMatchObject({ items: [] });
    expect(interactive).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('uses the authorized transport and emits invalidation only after a successful write', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'list', title: 'Work' })));
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch }));
    const listener = vi.fn(); window.addEventListener('elara:tasks-changed', listener);
    try {
      await expect(taskService.createTaskList('Work')).resolves.toMatchObject({ id: 'list' });
      expect(fetch).toHaveBeenCalledOnce(); expect(listener).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('elara:tasks-changed', listener); }
  });
});

describe('read-only retry classification', () => {
  it('classifies a throttled read with its cooldown, without replaying the request', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response('quota response', { status: 429, headers: { 'retry-after': '60' } }));
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch }));
    await expect(taskService.listTaskLists()).rejects.toMatchObject({ name: 'RetryableReadError', retryAfterMs: 60000 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not classify or automatically retry a failed mutation', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch }));
    await expect(taskService.createTaskList('Work')).rejects.toMatchObject({ name: 'Error', message: 'Google Tasks request failed (503).' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('passes cancellation to the actual provider boundary and rejects aborted reads', async () => {
    vi.spyOn(googleOAuthAuthority, 'getStatus').mockResolvedValue(ready);
    const controller = new AbortController();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit, guard?: () => void | Promise<void>) => {
      controller.abort();
      await guard?.();
      return new Response(JSON.stringify({ items: [] }));
    });
    vi.spyOn(googleOAuthAuthority, 'authorizeExisting').mockImplementation(async (capability) => ({ capability, fetch }));
    await expect(taskService.listTaskLists(undefined, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
