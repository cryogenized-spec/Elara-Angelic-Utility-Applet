import { registerSW } from 'virtual:pwa-register';

// How often an open client re-checks for a new service worker. Installed PWAs
// rarely navigate, so without polling the browser may not discover a deploy
// for a long time while the website (fresh navigation) picks it up at once.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let applyPendingUpdate: (() => void) | null = null;
let refreshCallback: (() => void) | null = null;
let updaterInitialized = false;

/**
 * Register the service worker (prompt strategy, see vite.config.ts) with
 * aggressive update discovery: check immediately on load, on a timer, and
 * whenever the app regains visibility or focus. Discovery only installs a
 * WAITING worker — the running page keeps its own worker, so polling can
 * never invalidate active chat state. `onNeedRefresh` fires while the new
 * worker waits; the user's Refresh tap sends SKIP_WAITING and reloads once
 * the new worker takes control. Safe to call twice (React StrictMode
 * remounts); registration and listeners are created exactly once.
 */
export function initPwaUpdater(onNeedRefresh: () => void): void {
  refreshCallback = onNeedRefresh;
  if (updaterInitialized) return;
  updaterInitialized = true;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      refreshCallback?.();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        void registration.update().catch(() => undefined);
      };
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);
    },
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed', error);
    },
  });
  applyPendingUpdate = () => {
    void updateSW(true);
  };
}

/**
 * Apply the waiting update: sends SKIP_WAITING to the waiting worker, which
 * reloads the page once the new worker takes control. No waiting worker, no
 * refresh — safe to call any time.
 */
export function applyPwaUpdate(): void {
  applyPendingUpdate?.();
}
