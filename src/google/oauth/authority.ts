import { newNonce, signWrite } from '../../autonomy/protocol';
import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../../autonomy/cloud/pairing';
import { googleCapabilityKeySchema, type AuthorizedGoogleRequest, type GoogleCapabilityKey, type GoogleOAuthAuthority, type GoogleOAuthStatus as GoogleOAuthStatusContract } from './contracts';
import { classifyGoogleOAuthFailure } from './diagnostics';
import { getGoogleScope } from './scope-registry';
import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';
import { requestGoogleAuthorizationCode } from './code-flow';
import {
  authorizationStateFor,
  computeEffectiveCapabilities,
  normalizeCapabilityKey,
  parseProviderScopes,
  providerSatisfiesCapability,
  resolveAuthorizingCapability,
} from './capability-policy';

const GOOGLE_API_HOSTS = new Set([
  'www.googleapis.com',
  'tasks.googleapis.com',
  'docs.googleapis.com',
  'chat.googleapis.com',
  'gmail.googleapis.com',
  'sheets.googleapis.com',
  'openidconnect.googleapis.com',
]);
const STORAGE_KEY = 'elara.google.authorization.v2';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const WORKER_TIMEOUT_MS = 20_000;
const GOOGLE_USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const GOOGLE_OPENID_SCOPE = 'openid';
const GOOGLE_USERINFO_ENDPOINTS = [
  'https://www.googleapis.com/oauth2/v2/userinfo',
  'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
  'https://openidconnect.googleapis.com/v1/userinfo',
] as const;

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
  /** Present only for paired durable OAuth sessions. */
  vaultUpdatedAt?: number;
};

type DurableOAuthStatus = {
  connected: boolean;
  scopes: string[];
  account?: { email: string; displayName?: string };
  updatedAt?: number;
  refreshTokenExpiresAt?: number;
};

type DurableOAuthToken = Omit<DurableOAuthStatus, 'updatedAt'> & {
  accessToken: string;
  expiresIn: number;
  updatedAt: number;
};

class DurableGoogleOAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

let stored: StoredAuthorization = emptyStored();
let session: AccessSession | null = null;

/**
 * Capability evidence carried over from v2-era records that did not persist a
 * provider-scope manifest. The v2 format recorded the capabilities a user
 * consented to; scope strings were not always stored alongside them.
 */
let legacyGrantedCapabilities: GoogleCapabilityKey[] = [];

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
  if (typeof localStorage === 'undefined') {
    legacyGrantedCapabilities = [];
    return stored;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      stored = emptyStored();
      session = null;
      legacyGrantedCapabilities = [];
      return stored;
    }

    const parsed = JSON.parse(raw) as Partial<StoredAuthorization> & { grantedCapabilities?: unknown };
    const enabled = migrateCapabilities(parsed.enabledCapabilities ?? parsed.grantedCapabilities);
    const scopes = Array.isArray(parsed.grantedProviderScopes)
      ? parseProviderScopes(parsed.grantedProviderScopes.filter((value): value is string => typeof value === 'string').join(' '))
      : [];
    legacyGrantedCapabilities = Array.isArray(parsed.grantedCapabilities) && scopes.length === 0
      ? [...enabled]
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
    legacyGrantedCapabilities = [];
  }
  return stored;
}

function saveStored(): void {
  stored.updatedAt = new Date().toISOString();
  stored.version = 3;
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function clearStored(): void {
  session = null;
  stored = emptyStored();
  legacyGrantedCapabilities = [];
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

function ensureClientId(): string {
  const clientId = configuredClientId();
  if (!clientId) throw new Error('Google Workspace is not configured: VITE_GOOGLE_CLIENT_ID is missing.');
  return clientId;
}

function currentStatus(): GoogleOAuthStatusContract {
  const current = loadStored();
  const grantedCapabilities = [...new Set([
    ...computeEffectiveCapabilities(current.enabledCapabilities, current.grantedProviderScopes),
    ...legacyGrantedCapabilities,
  ])];
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

function activePairing(): AutonomyPairing | null {
  if (typeof window === 'undefined') return null;
  return loadPairing();
}

function normalizeWorkerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DurableGoogleOAuthError('worker-url', 'The paired Worker URL is invalid.', 0);
  }
  if (url.protocol !== 'https:') throw new DurableGoogleOAuthError('worker-url', 'The paired Worker must use HTTPS.', 0);
  if (url.username || url.password || url.search || url.hash) throw new DurableGoogleOAuthError('worker-url', 'The paired Worker URL contains unsupported components.', 0);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function workerToken(pairing: AutonomyPairing): Promise<string> {
  const token = (await resolvePairingToken(pairing)).trim();
  if (!token) throw new DurableGoogleOAuthError('credential', 'The self-hosted Worker installation credential is unavailable. Pair this device again.', 0);
  return token;
}

async function workerRequest(pairing: AutonomyPairing, path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    return await fetch(`${normalizeWorkerBaseUrl(pairing.workerUrl)}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DurableGoogleOAuthError) throw error;
    throw new DurableGoogleOAuthError('network', error instanceof Error ? error.message : 'The self-hosted Worker could not be reached.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function workerError(response: Response): Promise<DurableGoogleOAuthError> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  return new DurableGoogleOAuthError(
    body?.code ?? `http-${response.status}`,
    body?.message ?? `The self-hosted Worker responded with HTTP ${response.status}.`,
    response.status,
  );
}

async function durableStatus(pairing: AutonomyPairing): Promise<DurableOAuthStatus> {
  const token = await workerToken(pairing);
  const response = await workerRequest(pairing, '/google/oauth/status', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 200) throw await workerError(response);
  return await response.json() as DurableOAuthStatus;
}

async function durablePost<T>(pairing: AutonomyPairing, path: string, payload: unknown, popupExchange = false): Promise<T> {
  const token = await workerToken(pairing);
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const nonce = newNonce();
  const signature = await signWrite(token, 'POST', path, timestamp, nonce, body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Elara-Timestamp': String(timestamp),
    'X-Elara-Nonce': nonce,
    'X-Elara-Signature': signature,
  };
  if (popupExchange) headers['X-Requested-With'] = 'XmlHttpRequest';
  const response = await workerRequest(pairing, path, { method: 'POST', headers, body });
  if (response.status !== 200) throw await workerError(response);
  return await response.json() as T;
}

function durableRevision(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DurableGoogleOAuthError('protocol', 'The paired Worker did not provide a valid Google OAuth grant revision.', 0);
  }
  return value;
}

function applyDurableStatus(remote: DurableOAuthStatus): void {
  const current = loadStored();
  legacyGrantedCapabilities = [];
  if (!remote.connected) {
    session = null;
    stored.grantedProviderScopes = [];
    stored.needsReauthorization = current.enabledCapabilities.length > 0;
    delete (stored as { account?: unknown }).account;
    saveStored();
    return;
  }
  if (session) {
    const remoteRevision = remote.updatedAt;
    if (session.vaultUpdatedAt === undefined
      || typeof remoteRevision !== 'number'
      || !Number.isFinite(remoteRevision)
      || session.vaultUpdatedAt !== remoteRevision) {
      session = null;
    }
  }
  stored.grantedProviderScopes = parseProviderScopes(remote.scopes.join(' '));
  stored.needsReauthorization = false;
  if (remote.account?.email) stored.account = remote.account;
  else delete (stored as { account?: unknown }).account;
  saveStored();
}

async function synchronizeDurableStatus(pairing: AutonomyPairing): Promise<DurableOAuthStatus> {
  const remote = await durableStatus(pairing);
  applyDurableStatus(remote);
  return remote;
}

async function fetchGoogleAccount(accessToken: string): Promise<{ email: string; displayName?: string } | null> {
  for (const endpoint of GOOGLE_USERINFO_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { email?: string; name?: string };
      if (data && typeof data.email === 'string' && data.email.trim()) {
        const email = data.email.trim();
        const displayName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined;
        return { email, ...(displayName ? { displayName } : {}) };
      }
    } catch {
      // Best-effort: try next endpoint, never fail the authorization itself.
    }
  }
  return null;
}

async function acquireBrowserToken(capability: GoogleCapabilityKey, prompt: '' | 'none'): Promise<void> {
  const descriptor = getGoogleScope(capability);
  if (!descriptor.scope) throw new Error(`Google capability ${capability} does not require OAuth authorization.`);
  try {
    const requestedScope = [descriptor.scope, GOOGLE_USERINFO_EMAIL_SCOPE, GOOGLE_OPENID_SCOPE].join(' ');
    const response = await requestGoogleAccessToken({ clientId: ensureClientId(), scope: requestedScope, prompt });
    if (!response.access_token) throw new Error('Google authorization did not return an access token.');
    const current = loadStored();
    const returnedScopes = parseProviderScopes(response.scope);
    const grantedProviderScopes = returnedScopes.length
      ? returnedScopes
      : [...new Set([...current.grantedProviderScopes, descriptor.scope])];
    const enabledCapabilities = uniqueCapabilities([...current.enabledCapabilities, capability]);
    session = {
      accessToken: response.access_token,
      expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
    };
    let nextAccount = current.account;
    try {
      const fetched = await fetchGoogleAccount(response.access_token);
      if (fetched) nextAccount = fetched;
      else if (prompt === '') nextAccount = undefined;
    } catch {
      if (prompt === '') nextAccount = undefined;
    }
    legacyGrantedCapabilities = [];
    stored.enabledCapabilities = enabledCapabilities;
    stored.grantedProviderScopes = grantedProviderScopes;
    stored.needsReauthorization = false;
    if (nextAccount) stored.account = nextAccount;
    else delete (stored as { account?: unknown }).account;
    saveStored();
  } catch (error) {
    const raw = error instanceof Error ? error.message : undefined;
    if (prompt === 'none') {
      stored.needsReauthorization = true;
      session = null;
      saveStored();
    }
    throw new Error(raw || 'Google authorization failed.', { cause: error });
  }
}

async function acquireDurableToken(capability: GoogleCapabilityKey, pairing: AutonomyPairing): Promise<void> {
  const descriptor = getGoogleScope(capability);
  if (!descriptor.scope) throw new Error(`Google capability ${capability} does not require OAuth authorization.`);
  const current = loadStored();
  const requestedScope = [descriptor.scope, GOOGLE_USERINFO_EMAIL_SCOPE, GOOGLE_OPENID_SCOPE].join(' ');
  const code = await requestGoogleAuthorizationCode({
    clientId: ensureClientId(),
    scope: requestedScope,
    ...(current.account?.email ? { loginHint: current.account.email } : {}),
  });
  const redirectUri = window.location.origin;
  const response = await durablePost<DurableOAuthToken>(pairing, '/google/oauth/exchange', {
    code: code.code,
    redirectUri,
  }, true);
  const providerScopes = parseProviderScopes(response.scopes.join(' '));
  const codeScopes = parseProviderScopes(code.scope);
  session = {
    accessToken: response.accessToken,
    expiresAt: Date.now() + Math.max(60, response.expiresIn) * 1000,
    vaultUpdatedAt: durableRevision(response.updatedAt),
  };
  legacyGrantedCapabilities = [];
  stored.enabledCapabilities = uniqueCapabilities([...current.enabledCapabilities, capability]);
  stored.grantedProviderScopes = providerScopes.length ? providerScopes : codeScopes;
  stored.needsReauthorization = false;
  if (response.account?.email) stored.account = response.account;
  else delete (stored as { account?: unknown }).account;
  saveStored();
}

async function refreshDurableToken(pairing: AutonomyPairing): Promise<void> {
  const response = await durablePost<DurableOAuthToken>(pairing, '/google/oauth/token', {});
  session = {
    accessToken: response.accessToken,
    expiresAt: Date.now() + Math.max(60, response.expiresIn) * 1000,
    vaultUpdatedAt: durableRevision(response.updatedAt),
  };
  const scopes = parseProviderScopes(response.scopes.join(' '));
  if (scopes.length) stored.grantedProviderScopes = scopes;
  stored.needsReauthorization = false;
  if (response.account?.email) stored.account = response.account;
  saveStored();
}

function markReauthorizationRequired(): void {
  stored.needsReauthorization = true;
  session = null;
  saveStored();
}

function workerFailureRequiresReauthorization(error: unknown): boolean {
  return error instanceof DurableGoogleOAuthError
    && (error.code === 'not_connected' || error.code === 'reauthorization_required' || error.code === 'auth');
}

async function ensureToken(capability: GoogleCapabilityKey, allowInteraction = false): Promise<string> {
  const pairing = activePairing();
  if (pairing) {
    await synchronizeDurableStatus(pairing);
    let status = currentStatus();
    if (!status.enabledCapabilities.includes(capability) && providerSatisfiesCapability(capability, status.grantedProviderScopes)) {
      stored.enabledCapabilities = uniqueCapabilities([...stored.enabledCapabilities, capability]);
      stored.needsReauthorization = false;
      saveStored();
      status = currentStatus();
    }
    const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities);
    if (!authorizing) {
      if (!allowInteraction) throw new Error('Google authorization requires explicit consent in Settings.');
      await acquireDurableToken(capability, pairing);
    } else if (!tokenStillValid()) {
      try {
        await refreshDurableToken(pairing);
      } catch (error) {
        if (workerFailureRequiresReauthorization(error)) markReauthorizationRequired();
        throw error;
      }
    }
    if (!tokenStillValid() || !session) throw new Error('Google durable authorization did not return a usable access token.');
    return session.accessToken;
  }

  const status = currentStatus();
  const authorizing = resolveAuthorizingCapability(capability, status.grantedCapabilities);
  const target = authorizing ?? capability;
  if (!authorizing || !tokenStillValid()) await acquireBrowserToken(target, allowInteraction ? '' : 'none');
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
    await ensureToken(capability, false);
  } catch (error) {
    if (!activePairing() || workerFailureRequiresReauthorization(error)) markReauthorizationRequired();
    throw new Error('Google authorization has expired or was revoked. Reauthorize this Google capability in Settings.', { cause: error });
  }

  const refreshedToken = currentAccessToken();
  if (!refreshedToken) throw new Error('Google authorization did not return a refreshed access token.');
  response = await fetch(new Request(target, requestOptions(refreshedToken)));
  if (response.status === 401) {
    markReauthorizationRequired();
    throw new Error('Google rejected the refreshed authorization. Reauthorize this capability in Settings.');
  }
  return response;
}

export const googleOAuthAuthority: GoogleOAuthAuthority = {
  async authorize(capability) {
    const parsed = googleCapabilityKeySchema.parse(capability);
    const descriptor = getGoogleScope(parsed);
    if (!descriptor.scope) return { capability: parsed, fetch: async () => { throw new Error('This capability is application-local and does not use Google OAuth.'); } } satisfies AuthorizedGoogleRequest;
    await ensureToken(parsed, true);
    return { capability: parsed, fetch: (input, init) => authorizedFetch(parsed, input, init) } satisfies AuthorizedGoogleRequest;
  },

  async getStatus() {
    const pairing = activePairing();
    if (pairing) {
      try {
        await synchronizeDurableStatus(pairing);
      } catch {
        const local = currentStatus();
        if (local.enabledCapabilities.length || local.grantedProviderScopes.length) return { ...local, state: 'token-recovery' };
      }
    }
    return currentStatus();
  },

  async disconnect() {
    const pairing = activePairing();
    if (pairing) {
      await durablePost<{ disconnected: boolean; providerRevoked: boolean }>(pairing, '/google/oauth/disconnect', {});
      clearStored();
      return;
    }

    const token = session?.accessToken;
    if (token) {
      try {
        await revokeGoogleAccessToken(token);
      } catch {
        // Provider revocation is best-effort for the browser-only fallback.
      }
    }
    clearStored();
  },
};

export function normalizeGoogleOAuthError(input: { error?: string; errorDescription?: string; status?: number }): Error {
  const result = classifyGoogleOAuthFailure(input);
  return new Error(result.message);
}