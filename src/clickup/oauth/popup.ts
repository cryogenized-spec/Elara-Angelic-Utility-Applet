import { clickUpOAuthAuthority } from './authority';
import type { ClickUpOAuthStatus } from './contracts';

const MESSAGE_TYPE = 'elara-clickup-oauth-callback-v1';
const POPUP_NAME = 'elara-clickup-oauth';
const AUTH_TIMEOUT_MS = 5 * 60_000;

type CallbackMessage = {
  type: typeof MESSAGE_TYPE;
  code?: string;
  state?: string;
  error?: string;
};

function redirectUri(): string {
  if (typeof window === 'undefined') throw new Error('ClickUp authorization is available only in the browser.');
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Called by the PWA on startup. When this window is the ClickUp OAuth popup,
 * forward only the one-time code/state back to the opener and close.
 */
export function forwardClickUpOAuthCallbackFromPopup(): boolean {
  if (typeof window === 'undefined' || !window.opener) return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code')?.trim() ?? '';
  const state = params.get('state')?.trim() ?? '';
  const error = params.get('error_description')?.trim() || params.get('error')?.trim() || '';
  if (!code && !error) return false;

  const message: CallbackMessage = {
    type: MESSAGE_TYPE,
    ...(code ? { code } : {}),
    ...(state ? { state } : {}),
    ...(error ? { error } : {}),
  };
  window.opener.postMessage(message, window.location.origin);
  window.close();
  return true;
}

export async function connectClickUpWithPopup(): Promise<ClickUpOAuthStatus> {
  if (typeof window === 'undefined') throw new Error('ClickUp authorization is available only in the browser.');

  // Create the window under the user gesture before awaiting Worker state, so
  // popup blockers cannot turn a valid connect click into a silent failure.
  const popup = window.open('', POPUP_NAME, 'popup,width=560,height=760,resizable=yes,scrollbars=yes');
  if (!popup) throw new Error('The ClickUp authorization popup was blocked.');

  const targetRedirect = redirectUri();
  try {
    const started = await clickUpOAuthAuthority.beginConnect(targetRedirect);
    popup.location.replace(started.authorizationUrl);

    return await new Promise<ClickUpOAuthStatus>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(closedPoll);
        clearTimeout(timeout);
        try { if (!popup.closed) popup.close(); } catch { /* ignore */ }
        callback();
      };

      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.origin !== window.location.origin || event.source !== popup) return;
        if (!event.data || typeof event.data !== 'object') return;
        const message = event.data as Partial<CallbackMessage>;
        if (message.type !== MESSAGE_TYPE) return;
        if (message.error) {
          finish(() => reject(new Error(message.error)));
          return;
        }
        if (!message.code || message.state !== started.state) {
          finish(() => reject(new Error('ClickUp authorization returned an invalid or mismatched state.')));
          return;
        }
        void clickUpOAuthAuthority.completeConnect({
          code: message.code,
          state: message.state,
          redirectUri: targetRedirect,
        }).then(
          (status) => finish(() => resolve(status)),
          (error: unknown) => finish(() => reject(error)),
        );
      };

      window.addEventListener('message', onMessage);
      const closedPoll = window.setInterval(() => {
        if (popup.closed) finish(() => reject(new Error('ClickUp authorization was cancelled.')));
      }, 500);
      const timeout = window.setTimeout(() => {
        finish(() => reject(new Error('ClickUp authorization timed out.')));
      }, AUTH_TIMEOUT_MS);
    });
  } catch (error) {
    try { popup.close(); } catch { /* ignore */ }
    throw error;
  }
}
