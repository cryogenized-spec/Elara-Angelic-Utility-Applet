import { googleCapabilityKeySchema, type AuthorizedGoogleRequest, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus as GoogleOAuthStatusContract } from './contracts';
import { classifyGoogleOAuthFailure } from './diagnostics';
import { getGoogleScope } from './scope-registry';
import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';

const GOOGLE_API_HOSTS = new Set([
  'www.googleapis.com',
  'tasks.googleapis.com',
  'docs.googleapis.com',
  'chat.googleapis.com',
  'gmail.googleapis.com',
  'sheets.googleapis.com',
]);
const GOOGLE_AUTH_CAPABILITIES = googleCapabilityKeySchema.options.filter((capability) => Boolean(getGoogleScope(capability).scope));
const STORAGE_KEY = 'elara.google.authorization.v2';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

type StoredAuthorization = {
  version: 2;
  grantedCapabilities: GoogleCapabilityKey[];
  account?: { email: string; displayName?: string };
  needsReauthorization?: boolean;
  updatedAt: string;
};

type AccessSession = {
  accessToken: string;
  expiresAt: number;
  grantedCapabilities: GoogleCapabilityKey[];
};

let stored: StoredAuthorization = { version: 2, grantedCapabilities: [], updatedAt: new Date(0).toISOString() };
let session: AccessSession | null = null;

function configuredClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
}

function emptyStored(): StoredAuthorization {
  return { version: 2, grantedCapabilities: [], updatedAt: new Date().toISOString() };
}

function loadStored(): StoredAuthorization {
  if (typeof localStorage === 'undefined') return stored;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      stored = emptyStored();
      session = null;
      return stored;
    }

    const parsed = JSON.parse(raw) as Partial<StoredAuthorization>;
    const capabilities = Array.isArray(parsed.grantedCapabilities)
      ? parsed.grantedCapabilities.filter((value): value is GoogleCapabilityKey => googleCapabilityKeySchema.safeParse(value).success && Boolean(getGoogleScope(value as GoogleCapabilityKey).scope))
      : [];
    const account = parsed.account && typeof parsed.account.email === 'string' && parsed.account.email.trim()
      ? { email: parsed.account.email.trim(), ...(typeof parsed.account.displayName === 'string' && parsed.account.displayName.trim() ? { displayName: parsed.account.displayName.trim() } : {}) }
      : undefined;
    const nextStored: StoredAuthorization = {
      version: 2,
      grantedCapabilities: [...new Set(capabilities)],
      ...(account ? { account } : {}),
      ...(parsed.needsReauthorization ? { needsReauthorization: true } : {}),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
    if (!nextStored.grantedCapabilities.length || nextStored.needsReauthorization) session = null;
    stored = nextStored;
  } catch {
    stored = emptyStored();
    session = null;
  }
  return stored;
}

function saveStored(): void {
  stored.updatedAt = new Date().toISOString();
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function ensureClientId(): string {
  const clientId = configuredClientId();
  if (!clientId) throw new Error('Google Workspace is not configured: VITE_GOOGLE_CLIENT_ID is missing.');
  return clientId;
}

function authorizationState(): GoogleOAuthStatusContract['state'] {
  const current = loadStored();
  if (current.grantedCapabilities.length === 0) return 'disconnected';
  if (current.needsReauthorization) return 'reauthorization-required';
  return current.grantedCapabilities.length === GOOGLE_AUTH_CAPABILITIES.length ? 'connected' : 'partially-authorized';
}

function assertGoogleApiTarget(input: RequestInfo | URL): URL {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'https:' || !GOOGLE_API_HOSTS.has(url.hostname)) throw new Error('Google Workspace target is outside the approved API boundary.');
  return url;
}

function tokenStillValid(): boolean {
  return Boolean(session && session.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS);
}

async function acquireToken(capability: GoogleCapabilityKey, prompt: '' | 'none'): Promise<void> {
  const descriptor = getGoogleScope(capability);
  if (!descriptor.scope) throw new Error(`Google capability ${capability} does not require OAuth authorization.`);
  try {
    const response = await requestGoogleAccessToken({ clientId: ensureClientId(), scope: descriptor.scope, prompt });
    if (!response.access_token) throw new Error('Google authorization did not return an access token.');
    session = {
      accessToken: response.access_token,
      expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
      grantedCapabilities: [...new Set([...(loadStored().grantedCapabilities), capability])],
    };
    stored.grantedCapabilities = session.grantedCapabilities;
    stored.needsReauthorization = false;
    saveStored();
  } catch (error) {
    const raw = error instanceof Error ? error.message : undefined;
    if (prompt === 'none') {
      stored.needsReauthorization = true;
      session = null;
      saveStored();
    }
    throw new Error(raw || 'Google authorization failed.');
  }
}

async function ensureToken(capability: GoogleCapabilityKey, allowInteraction = false): Promise<string> {
  const current = loadStored();
  if (!current.grantedCapabilities.includes(capability) || !tokenStillValid()) await acquireToken(capability, allowInteraction ? '' : 'none');
  if (!tokenStillValid() || !session) throw new Error('Google authorization did not return a usable access token.');
  return session.accessToken;
}

async function authorizedFetch(capability: GoogleCapabilityKey, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = assertGoogleApiTarget(input);
  const token = await ensureToken(capability, false);
  const request = new Request(target, init);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const requestOptions = (accessToken: string): RequestInit => {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    return { method: request.method, headers, body };
  };

  let response = await fetch(new Request(target, requestOptions(token)));
  if (response.status !== 401) return response;

  session = null;
  try {
    await acquireToken(capability, 'none');
  } catch {
    stored.needsReauthorization = true;
    saveStored();
    throw new Error('Google authorization has expired or was revoked. Reauthorize this Google capability in Settings.');
  }

  const refreshedToken = session?.accessToken;
  if (!refreshedToken) throw new Error('Google authorization did not return a refreshed access token.');
  response = await fetch(new Request(target, requestOptions(refreshedToken)));
  if (response.status === 401) {
    stored.needsReauthorization = true;
    session = null;
    saveStored();
    throw new Error('Google rejected the refreshed authorization. Reauthorize this capability in Settings.');
  }
  return response;
}

export const googleOAuthAuthority: GoogleOAuthAuthority = {
  async authorize(capability) {
    const parsed = googleCapabilityKeySchema.parse(capability);
    const descriptor = getGoogleScope(parsed);
    const current = loadStored();
    if (!descriptor.scope) return { capability: parsed, fetch: async () => { throw new Error('This capability is application-local and does not use Google OAuth.'); } } satisfies AuthorizedGoogleRequest;
    if (!current.grantedCapabilities.includes(parsed) || !tokenStillValid() || current.needsReauthorization) {
      await acquireToken(parsed, current.grantedCapabilities.includes(parsed) && !current.needsReauthorization ? 'none' : '');
    }
    return { capability: parsed, fetch: (input, init) => authorizedFetch(parsed, input, init) } satisfies AuthorizedGoogleRequest;
  },

  async getStatus() {
    const current = loadStored();
    return {
      state: authorizationState(),
      grantedCapabilities: [...current.grantedCapabilities],
      ...(current.account ? { account: current.account } : {}),
    } satisfies GoogleOAuthStatusContract;
  },

  async disconnect() {
    const token = session?.accessToken;
    if (token) {
      try {
        await revokeGoogleAccessToken(token);
      } catch {
        // Provider revocation is best-effort; local disconnect must still complete.
      }
    }
    session = null;
    stored = emptyStored();
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  },
};

export function normalizeGoogleOAuthError(input: { error?: string; errorDescription?: string; status?: number }): Error {
  const result = classifyGoogleOAuthFailure(input);
  return new Error(result.message);
}
