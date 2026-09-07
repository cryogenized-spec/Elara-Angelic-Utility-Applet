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
const STORAGE_KEY = 'elara.google.authorization.v2';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

type StoredAuthorization = {
  version: 2;
  grantedCapabilities: GoogleCapabilityKey[];
  account?: { email?: string; displayName?: string };
  updatedAt: string;
};

type AccessSession = {
  accessToken: string;
  expiresAt: number;
  grantedCapabilities: GoogleCapabilityKey[];
};

let loaded = false;
let stored: StoredAuthorization = { version: 2, grantedCapabilities: [], updatedAt: new Date(0).toISOString() };
let session: AccessSession | null = null;

function loadStored(): StoredAuthorization {
  if (loaded) return stored;
  loaded = true;
  if (typeof localStorage === 'undefined') return stored;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return stored;
    const parsed = JSON.parse(raw) as Partial<StoredAuthorization>;
    const capabilities = Array.isArray(parsed.grantedCapabilities)
      ? parsed.grantedCapabilities.filter((value): value is GoogleCapabilityKey => googleCapabilityKeySchema.safeParse(value).success)
      : [];
    stored = {
      version: 2,
      grantedCapabilities: [...new Set(capabilities)],
      ...(parsed.account ? { account: { email: parsed.account.email, displayName: parsed.account.displayName } } : {}),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    stored = { version: 2, grantedCapabilities: [], updatedAt: new Date().toISOString() };
  }
  return stored;
}

function saveStored(): void {
  stored.updatedAt = new Date().toISOString();
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function ensureClientId(): string {
  if (!CLIENT_ID) throw new Error('Google Workspace is not configured: VITE_GOOGLE_CLIENT_ID is missing.');
  return CLIENT_ID;
}

function hasCapability(capability: GoogleCapabilityKey): boolean {
  return loadStored().grantedCapabilities.includes(capability);
}

function authorizationState(): GoogleOAuthStatusContract['state'] {
  const count = loadStored().grantedCapabilities.length;
  if (count === 0) return 'disconnected';
  return count >= 6 ? 'connected' : 'partially-authorized';
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
  const response = await requestGoogleAccessToken({ clientId: ensureClientId(), scope: descriptor.scope, prompt });
  session = {
    accessToken: response.access_token!,
    expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
    grantedCapabilities: [...new Set([...(loadStored().grantedCapabilities), capability])],
  };
  stored.grantedCapabilities = session.grantedCapabilities;
  saveStored();
}

async function ensureToken(capability: GoogleCapabilityKey, allowInteraction = false): Promise<string> {
  if (!hasCapability(capability) || !tokenStillValid()) await acquireToken(capability, allowInteraction ? '' : 'none');
  if (!tokenStillValid() || !session) throw new Error('Google authorization did not return a usable access token.');
  return session.accessToken;
}

async function authorizedFetch(capability: GoogleCapabilityKey, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = assertGoogleApiTarget(input);
  let token = await ensureToken(capability, false);
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
    token = await ensureToken(capability, false);
  } catch {
    throw new Error('Google authorization has expired or was revoked. Reauthorize this Google capability in Settings.');
  }

  response = await fetch(new Request(target, requestOptions(token)));
  if (response.status === 401) throw new Error('Google rejected the refreshed authorization. Reauthorize this capability in Settings.');
  return response;
}

export const googleOAuthAuthority: GoogleOAuthAuthority = {
  async authorize(capability) {
    const parsed = googleCapabilityKeySchema.parse(capability);
    if (!getGoogleScope(parsed).scope) return { capability: parsed, fetch: async () => { throw new Error('This capability is application-local and does not use Google OAuth.'); } } satisfies AuthorizedGoogleRequest;
    await acquireToken(parsed, hasCapability(parsed) ? 'none' : '');
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
    if (token) await revokeGoogleAccessToken(token).catch(() => undefined);
    session = null;
    stored = { version: 2, grantedCapabilities: [], updatedAt: new Date().toISOString() };
    loaded = true;
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  },
};

export function normalizeGoogleOAuthError(input: { error?: string; errorDescription?: string; status?: number }): Error {
  const result = classifyGoogleOAuthFailure(input);
  return new Error(result.message);
}
