import { registerSW } from 'virtual:pwa-register';

// How often an open client re-checks for a new service worker. Installed PWAs
// rarely navigate, so without polling the browser may not discover a deploy
// for a long time while the website (fresh navigation) picks it up at once.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let applyPendingUpdate: (() => void) | null = null;
let refreshCallback: (() => void) | null = null;
let updaterInitialized = false;

/**
 * Register the service worker with aggressive update discovery: check
 * immediately on load, on a timer, and whenever the app regains visibility or
 * focus. `onNeedRefresh` fires when a new worker has taken control and fresh
 * assets are one reload away. Safe to call twice (React StrictMode remounts).
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

/** Reload into the waiting service worker's fresh assets. No-op until one exists. */
export function applyPwaUpdate(): void {
  applyPendingUpdate?.();
}
