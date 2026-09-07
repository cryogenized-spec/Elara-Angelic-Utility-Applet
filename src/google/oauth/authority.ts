import { googleCapabilityKeySchema, type AuthorizedGoogleRequest, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus as GoogleOAuthStatusContract } from './contracts';
import { classifyGoogleOAuthFailure } from './diagnostics';
import { getGoogleScope } from './scope-registry';
import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';
import {
  authorizationStateFor,
  computeEffectiveCapabilities,
  normalizeCapabilityKey,
  parseProviderScopes,
  resolveAuthorizingCapability,
} from './capability-policy';

const GOOGLE_API_HOSTS = new Set([
  'www.googleapis.com',
  'tasks.googleapis.com',
  'docs.googleapis.com',
  'chat.googleapis.com',
  'gmail.googleapis.com',
  'sheets.googleapis.com',
]);
const STORAGE_KEY = 'elara.google.authorization.v2';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

type StoredAuthorization = {
  version: 3;
  enabledCapabilities: GoogleCapabilityKey[];
  grantedProviderScopes: string[];
  account?: { email: string; displayName?: string };
  needsReauthorization?: boolean;
  updatedAt: string;
};

type AccessSession = {
  accessToken: string;
  expiresAt: number;
};

let stored: StoredAuthorization = emptyStored();
let session: AccessSession | null = null;

function configuredClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
}

function emptyStored(): StoredAuthorization {
  return { version: 3, enabledCapabilities: [], grantedProviderScopes: [], updatedAt: new Date().toISOString() };
}

function uniqueCapabilities(values: readonly GoogleCapabilityKey[]): GoogleCapabilityKey[] {
  return [...new Set(values)].filter((capability) => Boolean(getGoogleScope(capability).scope));
}

function migrateCapabilities(values: unknown): GoogleCapabilityKey[] {
  if (!Array.isArray(values)) return [];
  const migrated: GoogleCapabilityKey[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const capability = normalizeCapabilityKey(value);
    if (capability && getGoogleScope(capability).scope) migrated.push(capability);
  }
  return uniqueCapabilities(migrated);
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

    const parsed = JSON.parse(raw) as Partial<StoredAuthorization> & { grantedCapabilities?: unknown };
    const enabled = migrateCapabilities(parsed.enabledCapabilities ?? parsed.grantedCapabilities);
    const scopes = Array.isArray(parsed.grantedProviderScopes)
      ? parseProviderScopes(parsed.grantedProviderScopes.filter((value): value is string => typeof value === 'string').join(' '))
      : [];
    const account = parsed.account && typeof parsed.account.email === 'string' && parsed.account.email.trim()
      ? { email: parsed.account.email.trim(), ...(typeof parsed.account.displayName === 'string' && parsed.account.displayName.trim() ? { displayName: parsed.account.displayName.trim() } : {}) }
      : undefined;
    const nextStored: StoredAuthorization = {
      version: 3,
      enabledCapabilities: enabled,
      grantedProviderScopes: scopes,
      ...(account ? { account } : {}),
      ...(parsed.needsReauthorization ? { needsReauthorization: true } : {}),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
    if (!nextStored.enabledCapabilities.length || nextStored.needsReauthorization) session = null;
    stored = nextStored;
  } catch {
    stored = emptyStored();
    session = null;
  }
  return stored;
}

function saveStored(): void {
  stored.updatedAt = new Date().toISOString();
  stored.version = 3;
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function ensureClientId(): string {
  const clientId = configuredClientId();
  if (!clientId) throw new Error('Google Workspace is not configured: VITE_GOOGLE_CLIENT_ID is missing.');
  return clientId;
}

function currentStatus(): GoogleOAuthStatusContract {
  const current = loadStored();
  const grantedCapabilities = computeEffectiveCapabilities(current.enabledCapabilities, current.grantedProviderScopes);
  return {
    state: authorizationStateFor(current.enabledCapabilities, grantedCapabilities, Boolean(current.needsReauthorization)),
    grantedCapabilities,
    enabledCapabilities: [...current.enabledCapabilities],
    grantedProviderScopes: [...current.grantedProviderScopes],
    ...(current.account ? { account: current.account } : {}),
  };
}

function assertGoogleApiTarget(input: RequestInfo | URL): URL {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'https:' || !GOOGLE_API_HOSTS.has(url.hostname)) throw new Error('Google Workspace target is outside the approved API boundary.');
  return url;
}

function tokenStillValid(): boolean {
  return Boolean(session && session.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS);
}

function currentAccessToken(): string | undefined {
  return session?.accessToken;
}

async function acquireToken(capability: GoogleCapabilityKey, prompt: '' | 'none'): Promise<void> {
  const descriptor = getGoogleScope(capability);
  if (!descriptor.scope) throw new Error(`Google capability ${capability} does not require OAuth authorization.`);
  try {
    const response = await requestGoogleAccessToken({ clientId: ensureClientId(), scope: descriptor.scope, prompt });
    if (!response.access_token) throw new Error('Google authorization did not return an access token.');
    const returnedScopes = parseProviderScopes(response.scope);
    const grantedProviderScopes = [...new Set([
      ...loadStored().grantedProviderScopes,
      ...(returnedScopes.length ? returnedScopes : [descriptor.scope]),
    ])];
    const enabledCapabilities = uniqueCapabilities([...loadStored().enabledCapabilities, capability]);
    session = {
      accessToken: response.access_token,
      expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
    };
    stored.enabledCapabilities = enabledCapabilities;
    stored.grantedProviderScopes = grantedProviderScopes;
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
  const status = currentStatus();
  const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities);
  const target = authorizing ?? capability;
  if (!authorizing || !tokenStillValid()) await acquireToken(target, allowInteraction ? '' : 'none');
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
    const status = currentStatus();
    const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities) ?? capability;
    await acquireToken(authorizing, 'none');
  } catch {
    stored.needsReauthorization = true;
    saveStored();
    throw new Error('Google authorization has expired or was revoked. Reauthorize this Google capability in Settings.');
  }

  const refreshedToken = currentAccessToken();
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
    if (!descriptor.scope) return { capability: parsed, fetch: async () => { throw new Error('This capability is application-local and does not use Google OAuth.'); } } satisfies AuthorizedGoogleRequest;
    const status = currentStatus();
    const authorizing = resolveAuthorizingCapability(parsed, status.grantedCapabilities);
    if (!authorizing || !tokenStillValid() || status.state === 'reauthorization-required') {
      await acquireToken(parsed, authorizing && status.state !== 'reauthorization-required' ? 'none' : '');
    }
    return { capability: parsed, fetch: (input, init) => authorizedFetch(parsed, input, init) } satisfies AuthorizedGoogleRequest;
  },

  async getStatus() {
    return currentStatus();
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
