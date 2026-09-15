import { afterEach, describe, expect, it, vi } from 'vitest';
import { pwaRegisterProbe, resetPwaRegisterProbe } from '../test/virtual-pwa-register';
import { applyPwaUpdate, initPwaUpdater } from './pwa';

afterEach(() => {
  vi.restoreAllMocks();
  resetPwaRegisterProbe();
});

describe('PWA update coordinator', () => {
  it('registers once, keeps the latest refresh callback, checks on lifecycle signals, and applies explicitly', async () => {
    resetPwaRegisterProbe();
    const firstRefresh = vi.fn();
    const latestRefresh = vi.fn();
    let intervalHandler: TimerHandler | null = null;
    const interval = vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler) => {
      intervalHandler = handler;
      return 1;
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const registrationUpdate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const registration = { update: registrationUpdate } as unknown as ServiceWorkerRegistration;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    initPwaUpdater(firstRefresh);
    initPwaUpdater(latestRefresh);

    const probe = pwaRegisterProbe();
    expect(probe.registerCalls).toBe(1);
    expect(probe.options?.immediate).toBe(true);

    probe.options?.onNeedRefresh?.();
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledTimes(1);

    probe.options?.onRegisteredSW?.('/sw.js', registration);
    expect(interval).toHaveBeenCalledTimes(1);
    expect(intervalHandler).not.toBeNull();
    if (typeof intervalHandler === 'function') intervalHandler();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(registrationUpdate).toHaveBeenCalledTimes(3);

    probe.options?.onRegisteredSW?.('/sw.js', undefined);
    expect(interval).toHaveBeenCalledTimes(1);

    const failure = new Error('registration failed');
    probe.options?.onRegisterError?.(failure);
    expect(consoleError).toHaveBeenCalledWith('[pwa] service worker registration failed', failure);

    applyPwaUpdate();
    await Promise.resolve();
    expect(pwaRegisterProbe().updateCalls).toEqual([true]);
  });
});
