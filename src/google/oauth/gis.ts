export interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly hd?: string;
  readonly prompt?: string;
  readonly scope?: string;
  readonly token_type?: string;
  readonly error?: string;
  readonly error_description?: string;
  readonly error_uri?: string;
}

interface GoogleTokenClient {
  requestAccessToken(overrideConfig?: {
    scope?: string;
    include_granted_scopes?: boolean;
    prompt?: '' | 'none' | 'consent' | 'select_account';
    login_hint?: string;
    hd?: string;
    state?: string;
  }): void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): GoogleTokenClient;
  revoke(accessToken: string, callback: (response: GoogleTokenResponse) => void): void;
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: GoogleAccountsOAuth2;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

const GIS_SCRIPT_ID = 'google-identity-services';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let loadPromise: Promise<GoogleIdentityServices> | null = null;
let activeRequest: Promise<GoogleTokenResponse> | null = null;

function currentGoogle(): GoogleIdentityServices | null {
  return typeof window !== 'undefined' ? window.google ?? null : null;
}

export function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  const existing = currentGoogle();
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;
  if (typeof document === 'undefined') return Promise.reject(new Error('Google Identity Services is unavailable outside a browser.'));

  loadPromise = new Promise<GoogleIdentityServices>((resolve, reject) => {
    const finish = () => {
      const google = currentGoogle();
      if (google?.accounts?.oauth2) resolve(google);
      else reject(new Error('Google Identity Services loaded without the OAuth2 API.'));
    };

    const existingScript = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', finish, { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google Identity Services could not be loaded.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded.'));
    document.head.appendChild(script);
  }).catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

export async function requestGoogleAccessToken(config: {
  clientId: string;
  scope: string;
  prompt: '' | 'none' | 'consent' | 'select_account';
}): Promise<GoogleTokenResponse> {
  if (activeRequest) return activeRequest;

  activeRequest = (async () => {
    const google = await loadGoogleIdentityServices();
    return new Promise<GoogleTokenResponse>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: config.scope,
        include_granted_scopes: true,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description || response.error || 'Google authorization failed.'));
            return;
          }
          resolve(response);
        },
        error_callback: (error) => {
          reject(new Error(error.type === 'popup_closed' ? 'Google authorization was cancelled.' : 'Google authorization could not be completed.'));
        },
      });
      client.requestAccessToken({ scope: config.scope, include_granted_scopes: true, prompt: config.prompt });
    });
  })();

  try {
    return await activeRequest;
  } finally {
    activeRequest = null;
  }
}

export async function revokeGoogleAccessToken(accessToken: string): Promise<void> {
  const google = await loadGoogleIdentityServices();
  await new Promise<void>((resolve) => {
    google.accounts.oauth2.revoke(accessToken, () => resolve());
  });
}
