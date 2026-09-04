import { googleCapabilityKeySchema, type AuthorizedGoogleRequest, type GoogleCapabilityKey, type GoogleOAuthAuthority } from './contracts';

const DEFAULT_OAUTH_BASE_URL = 'https://elara-gemini.cryogenized.workers.dev';

const OAUTH_BASE_URL = (import.meta.env.VITE_GOOGLE_OAUTH_BASE_URL as string | undefined)?.trim() || DEFAULT_OAUTH_BASE_URL;

function assertSameOriginRedirect(url: URL): void {
  if (url.protocol !== 'https:') throw new Error('Google OAuth redirect must use HTTPS.');
  if (url.origin !== OAUTH_BASE_URL) throw new Error('Unexpected Google OAuth redirect origin.');
}

function capabilityParam(capability: GoogleCapabilityKey): string {
  return encodeURIComponent(googleCapabilityKeySchema.parse(capability));
}

export interface GoogleOAuthStatus {
  state: 'disconnected' | 'connected' | 'needs-consent' | 'token-recovery' | 'reauthorization-required' | 'partially-authorized' | 'revoked';
  grantedCapabilities: readonly GoogleCapabilityKey[];
  account?: { email: string; displayName?: string };
}

interface OAuthFetchInit extends RequestInit {
  credentials?: RequestCredentials;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google OAuth authority request failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export const googleOAuthAuthority: GoogleOAuthAuthority = {
  async authorize(capability) {
    googleCapabilityKeySchema.parse(capability);
    const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/start?capability=${capabilityParam(capability)}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    } satisfies OAuthFetchInit);

    const payload = await readJson<{ authorizationUrl: string }>(response);
    const redirect = new URL(payload.authorizationUrl);
    if (redirect.protocol !== 'https:') throw new Error('Google authorization URL must use HTTPS.');

    window.location.assign(redirect.toString());

    return {
      capability,
      fetch: async () => {
        throw new Error('OAuth redirect is pending; authorized Google requests cannot start in this page state.');
      },
    } satisfies AuthorizedGoogleRequest;
  },

  async getStatus() {
    const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/status`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return readJson<GoogleOAuthStatus>(response);
  },

  async disconnect() {
    const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/disconnect`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    await readJson<{ disconnected: true }>(response);
  },
};

export function validateGoogleOAuthCallbackUrl(candidate: string | URL): URL {
  const url = typeof candidate === 'string' ? new URL(candidate) : candidate;
  assertSameOriginRedirect(url);
  return url;
}
