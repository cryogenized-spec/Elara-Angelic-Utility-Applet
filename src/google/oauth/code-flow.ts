import { loadGoogleIdentityServices } from './gis';

export interface GoogleAuthorizationCodeResponse {
  readonly code: string;
  readonly scope?: string;
  readonly state?: string;
}

interface CodeResponse {
  readonly code?: string;
  readonly scope?: string;
  readonly state?: string;
  readonly error?: string;
  readonly error_description?: string;
  readonly error_uri?: string;
}

interface CodeClient {
  requestCode(): void;
}

interface GoogleIdentityServicesWithCode {
  accounts: {
    oauth2: {
      initCodeClient(config: {
        client_id: string;
        scope: string;
        include_granted_scopes?: boolean;
        ux_mode?: 'popup' | 'redirect';
        redirect_uri?: string;
        callback?: (response: CodeResponse) => void;
        error_callback?: (error: { type?: string }) => void;
        state?: string;
        login_hint?: string;
        hd?: string;
      }): CodeClient;
    };
  };
}

/**
 * Request a one-time Google authorization code through GIS popup UX.
 *
 * Popup mode deliberately does not accept or pass redirect_uri. Google defines
 * the effective redirect URI as the calling page origin; the Worker exchange
 * must use that same window.location.origin value. Keeping redirect selection
 * out of this helper prevents a self-hosted Pages deployment from accidentally
 * exchanging a code against another installation's origin.
 */
export async function requestGoogleAuthorizationCode(config: {
  clientId: string;
  scope: string;
  state?: string;
  loginHint?: string;
  hostedDomain?: string;
}): Promise<GoogleAuthorizationCodeResponse> {
  if (typeof window === 'undefined') throw new Error('Google authorization-code flow is unavailable outside a browser.');

  const google = await loadGoogleIdentityServices() as unknown as GoogleIdentityServicesWithCode;
  return new Promise<GoogleAuthorizationCodeResponse>((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: config.clientId,
      scope: config.scope,
      include_granted_scopes: true,
      ux_mode: 'popup',
      ...(config.state ? { state: config.state } : {}),
      ...(config.loginHint ? { login_hint: config.loginHint } : {}),
      ...(config.hostedDomain ? { hd: config.hostedDomain } : {}),
      callback: (response: CodeResponse) => {
        if (response.error || !response.code) {
          reject(new Error(response.error_description || response.error || 'Google authorization-code flow failed.'));
          return;
        }
        resolve({ code: response.code, ...(response.scope ? { scope: response.scope } : {}), ...(response.state ? { state: response.state } : {}) });
      },
      error_callback: (error: { type?: string }) => {
        reject(new Error(error.type === 'popup_closed' ? 'Google authorization was cancelled.' : 'Google authorization could not be completed.'));
      },
    });
    client.requestCode();
  });
}
