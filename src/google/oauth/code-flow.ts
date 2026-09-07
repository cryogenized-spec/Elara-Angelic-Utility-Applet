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

export async function requestGoogleAuthorizationCode(config: {
  clientId: string;
  scope: string;
  redirectUri: string;
  state?: string;
  loginHint?: string;
  hostedDomain?: string;
}): Promise<GoogleAuthorizationCodeResponse> {
  if (typeof window === 'undefined') throw new Error('Google authorization-code flow is unavailable outside a browser.');
  if (!config.redirectUri.trim()) throw new Error('Google authorization-code redirect URI is required.');

  const google = await loadGoogleIdentityServices();
  return new Promise<GoogleAuthorizationCodeResponse>((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: config.clientId,
      scope: config.scope,
      include_granted_scopes: true,
      ux_mode: 'popup',
      redirect_uri: config.redirectUri,
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
