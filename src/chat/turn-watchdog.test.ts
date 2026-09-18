import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnWatchdog } from './turn-watchdog';

describe('createTurnWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the idle-stall callback after a quiet gap', () => {
    vi.useFakeTimers();
    const onIdleStall = vi.fn();
    const onAbsoluteTimeout = vi.fn();
    createTurnWatchdog({ idleStallMs: 1000, absoluteMs: 10_000, onIdleStall, onAbsoluteTimeout });

    vi.advanceTimersByTime(999);
    expect(onIdleStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdleStall).toHaveBeenCalledOnce();
    expect(onAbsoluteTimeout).not.toHaveBeenCalled();
  });

  it('treats stream activity as a healthy heartbeat, not a stall', () => {
    vi.useFakeTimers();
    const onIdleStall = vi.fn();
    const watchdog = createTurnWatchdog({ idleStallMs: 1000, absoluteMs: 10_000, onIdleStall, onAbsoluteTimeout: vi.fn() });

    for (let tick = 0; tick < 5; tick += 1) {
      vi.advanceTimersByTime(900);
      watchdog.notifyActivity();
    }
    expect(onIdleStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onIdleStall).toHaveBeenCalledOnce();
    watchdog.dispose();
  });

  it('bounds even an active turn with the absolute deadline', () => {
    vi.useFakeTimers();
    const onAbsoluteTimeout = vi.fn();
    const watchdog = createTurnWatchdog({ idleStallMs: 1000, absoluteMs: 5000, onIdleStall: vi.fn(), onAbsoluteTimeout });

    for (let tick = 0; tick < 10; tick += 1) {
      vi.advanceTimersByTime(500);
      watchdog.notifyActivity();
    }
    expect(onAbsoluteTimeout).toHaveBeenCalledOnce();
    watchdog.dispose();
  });

  it('goes silent after dispose', () => {
    vi.useFakeTimers();
    const onIdleStall = vi.fn();
    const onAbsoluteTimeout = vi.fn();
    const watchdog = createTurnWatchdog({ idleStallMs: 100, absoluteMs: 200, onIdleStall, onAbsoluteTimeout });
    watchdog.dispose();
    vi.advanceTimersByTime(10_000);
    expect(onIdleStall).not.toHaveBeenCalled();
    expect(onAbsoluteTimeout).not.toHaveBeenCalled();
  });
});
