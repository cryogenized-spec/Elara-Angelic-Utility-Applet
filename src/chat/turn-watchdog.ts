// ---------------------------------------------------------------------------
// Turn watchdog: distinguishes a slow-but-healthy stream from a stalled one.
//
// - The idle-stall timer resets on EVERY stream event (thought deltas, status
//   updates, and tool heartbeats all count as activity), so long actively
//   streaming turns are never mistaken for dead connections.
// - The absolute timer bounds the whole turn regardless of activity.
//
// Owned by the turn runner. Callbacks fire at most once; the runner disposes
// the watchdog when the turn reaches a terminal phase.
// ---------------------------------------------------------------------------

export interface TurnWatchdogOptions {
  idleStallMs: number;
  absoluteMs: number;
  onIdleStall: () => void;
  onAbsoluteTimeout: () => void;
}

export interface TurnWatchdog {
  notifyActivity: () => void;
  dispose: () => void;
}

export function createTurnWatchdog(options: TurnWatchdogOptions): TurnWatchdog {
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let absoluteTimer: ReturnType<typeof setTimeout> | undefined;

  function clearIdle(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearIdle();
    if (absoluteTimer !== undefined) {
      clearTimeout(absoluteTimer);
      absoluteTimer = undefined;
    }
  }

  function armIdle(): void {
    clearIdle();
    if (disposed) return;
    idleTimer = setTimeout(() => {
      dispose();
      options.onIdleStall();
    }, options.idleStallMs);
  }

  absoluteTimer = setTimeout(() => {
    dispose();
    options.onAbsoluteTimeout();
  }, options.absoluteMs);
  armIdle();

  return {
    notifyActivity: () => {
      if (!disposed) armIdle();
    },
    dispose,
  };
}
