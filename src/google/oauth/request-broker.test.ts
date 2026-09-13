import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock('./authority', () => ({
  googleOAuthAuthority: { authorize },
}));

import { dismissGoogleCapabilityGrant, requestGoogleCapabilityGrant } from './request-broker';

describe('Google capability request broker cancellation', () => {
  beforeEach(() => {
    authorize.mockReset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    dismissGoogleCapabilityGrant();
    document.body.innerHTML = '';
  });

  it('declines immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(requestGoogleCapabilityGrant('calendar.events.write', controller.signal)).resolves.toBe(false);
    expect(document.getElementById('elara-google-capability-request')).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('cannot let a late authorization settlement resolve a later request', async () => {
    let resolveAuthorization: (() => void) | undefined;
    authorize.mockReturnValueOnce(new Promise<void>((resolve) => { resolveAuthorization = resolve; }));
    const controller = new AbortController();

    const first = requestGoogleCapabilityGrant('calendar.events.write', controller.signal);
    const authorizeButton = document.querySelector<HTMLButtonElement>('#elara-google-capability-request [data-decision="authorize"]');
    expect(authorizeButton).not.toBeNull();
    authorizeButton?.click();
    expect(authorize).toHaveBeenCalledOnce();

    controller.abort();
    await expect(first).resolves.toBe(false);

    const second = requestGoogleCapabilityGrant('tasks.write');
    expect(document.getElementById('elara-google-capability-request')).not.toBeNull();
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });

    if (!resolveAuthorization) throw new Error('authorization gate was not initialized');
    resolveAuthorization();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    dismissGoogleCapabilityGrant();
    await expect(second).resolves.toBe(false);
  });
});
