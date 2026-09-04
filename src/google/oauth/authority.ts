import { googleCapabilityKeySchema, type AuthorizedGoogleRequest, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus } from './contracts';

const DEFAULT_OAUTH_BASE_URL = 'https://elara-gemini.cryogenized.workers.dev';

const OAUTH_BASE_URL = (import.meta.env.VITE_GOOGLE_OAUTH_BASE_URL as string | undefined)?.trim() || DEFAULT_OAUTH_BASE_URL;

function assertSameOriginRedirect(url: URL): void {
  if (url.protocol !== 'https:') throw new Error('Google OAuth redirect must use HTTPS.');
  if (url.origin !== OAUTH_BASE_URL) throw new Error('Unexpected Google OAuth redirect origin.');
}

function capabilityParam(capability: GoogleCapabilityKey): string {
  return encodeURIComponent(googleCapabilityKeySchema.parse(capability));
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google OAuth authority request failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

async function authorizedFetch(capability: GoogleCapabilityKey, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  if (request.url.startsWith(`${OAUTH_BASE_URL}/api/google/oauth/`)) throw new Error('Google OAuth authority requests cannot be proxied as Workspace operations.');
  const proxyHeaders = new Headers();
  const accept = request.headers.get('Accept');
  const contentType = request.headers.get('Content-Type');
  const ifMatch = request.headers.get('If-Match');
  if (accept) proxyHeaders.set('Accept', accept);
  if (contentType) proxyHeaders.set('Content-Type', contentType);
  if (ifMatch) proxyHeaders.set('If-Match', ifMatch);
  proxyHeaders.set('X-Elara-Google-Capability', capability);
  proxyHeaders.set('X-Elara-Google-Target', request.url);
  return fetch(`${OAUTH_BASE_URL}/api/google/oauth/proxy`, {
    method: request.method,
    credentials: 'include',
    headers: proxyHeaders,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
  });
}

export interface GoogleOAuthStatus extends Omit<GoogleOAuthStatus, 'state'> {
  state: GoogleOAuthStatus['state'];
  grantedCapabilities: readonly GoogleCapabilityKey[];
  account?: { email: string; displayName?: string };
}

export const googleOAuthAuthority: GoogleOAuthAuthority = {
  async authorize(capability) {
    googleCapabilityKeySchema.parse(capability);
    const status = await this.getStatus();
    const available = status.grantedCapabilities.includes(capability) && status.state !== 'disconnected' && status.state !== 'needs-consent' && status.state !== 'revoked' && status.state !== 'reauthorization-required' && status.state !== 'token-recovery';
    if (!available) {
      const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/start?capability=${capabilityParam(capability)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json', Origin: window.location.origin },
      });
      const payload = await readJson<{ authorizationUrl: string }>(response);
      const redirect = new URL(payload.authorizationUrl);
      if (redirect.protocol !== 'https:') throw new Error('Google authorization URL must be HTTPS.');
      window.location.assign(redirect.toString());
      return { capability, fetch: async () => { throw new Error('OAuth redirect is pending; authorized Google requests cannot start in this page state.'); } } satisfies AuthorizedGoogleRequest;
    }
    return { capability, fetch: (input, init) => authorizedFetch(capability, input, init) } satisfies AuthorizedGoogleRequest;
  },

  async getStatus() {
    const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/status`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', Origin: window.location.origin },
      cache: 'no-store',
    });
    return readJson<GoogleOAuthStatus>(response);
  },

  async disconnect() {
    const response = await fetch(`${OAUTH_BASE_URL}/api/google/oauth/disconnect`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', Origin: window.location.origin },
    });
    await readJson<{ disconnected: true }>(response);
  },
};

export function validateGoogleOAuthCallbackUrl(candidate: string | URL): URL {
  const url = typeof candidate === 'string' ? new URL(candidate) : candidate;
  assertSameOriginRedirect(url);
  return url;
}
