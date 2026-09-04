import { getGoogleScope } from '../../src/google/oauth/scope-registry';
import { googleCapabilityKeySchema, type GoogleCapabilityKey } from '../../src/google/oauth/contracts';

export interface OAuthKV {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface GoogleOAuthEnv {
  GOOGLE_OAUTH_KV?: OAuthKV;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  APP_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
}

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_COOKIE = 'elara_oauth_state';
const SESSION_COOKIE = '__Host-elara_google_session';
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_TOKEN_SKEW_SECONDS = 60;
const MAX_PROXY_BODY_BYTES = 1_048_576;

const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

type UserRecord = {
  sub: string;
  email: string;
  displayName?: string;
  grantedScopes: string[];
  encryptedRefreshToken?: string;
  encryptedAccessToken?: string;
  accessTokenExpiresAt?: number;
  status: 'active' | 'revoked' | 'token-recovery';
  updatedAt: string;
};

type StateRecord = {
  state: string;
  sessionId?: string;
  capability: GoogleCapabilityKey;
  codeVerifier: string;
  createdAt: number;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type UserInfo = {
  sub?: string;
  email?: string;
  name?: string;
};

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

function configuredOrigins(env: GoogleOAuthEnv): string[] {
  return text(env.ALLOWED_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(request: Request, env: GoogleOAuthEnv): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin && configuredOrigins(env).includes(origin));
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get('Cookie') ?? '';
  for (const pair of raw.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function setCookie(name: string, value: string, attributes: string): string {
  return `${name}=${value}; ${attributes}`;
}

function randomBytes(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function readEncryptionKey(value: string): Uint8Array {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(trimmed.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  const decoded = base64UrlDecode(trimmed);
  if (decoded.length !== 32) throw new Error('OAuth encryption key must decode to exactly 32 bytes.');
  return decoded;
}

async function encryptionKey(env: GoogleOAuthEnv): Promise<CryptoKey> {
  const raw = readEncryptionKey(text(env.OAUTH_TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptSecret(secret: string, env: GoogleOAuthEnv): Promise<string> {
  const key = await encryptionKey(env);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(value: string, env: GoogleOAuthEnv): Promise<string> {
  const [ivPart, ciphertextPart] = value.split('.');
  if (!ivPart || !ciphertextPart) throw new Error('Malformed encrypted token.');
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(ivPart) }, key, base64UrlDecode(ciphertextPart));
  return new TextDecoder().decode(plaintext);
}

function userKey(sub: string): string { return `google:user:${sub}`; }
function sessionKey(sessionId: string): string { return `google:session:${sessionId}`; }
function stateKey(state: string): string { return `google:oauth-state:${state}`; }

async function loadJson<T>(kv: OAuthKV | undefined, key: string): Promise<T | null> {
  if (!kv) return null;
  const raw = await kv.get(key, 'text');
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

async function saveJson(kv: OAuthKV | undefined, key: string, value: unknown, expirationTtl?: number): Promise<void> {
  if (!kv) throw new Error('Google OAuth storage is not configured.');
  await kv.put(key, JSON.stringify(value), expirationTtl ? { expirationTtl } : undefined);
}

function missingConfig(env: GoogleOAuthEnv): string | null {
  if (!env.GOOGLE_OAUTH_KV || !text(env.GOOGLE_CLIENT_ID) || !text(env.GOOGLE_CLIENT_SECRET) || !text(env.GOOGLE_OAUTH_REDIRECT_URI) || !text(env.OAUTH_TOKEN_ENCRYPTION_KEY) || !text(env.APP_ORIGIN)) return 'Google OAuth Worker configuration is incomplete.';
  return null;
}

function callbackUri(env: GoogleOAuthEnv): URL {
  const uri = new URL(text(env.GOOGLE_OAUTH_REDIRECT_URI));
  if (uri.protocol !== 'https:') throw new Error('Google OAuth redirect URI must use HTTPS.');
  if (!uri.pathname.endsWith('/api/google/oauth/callback')) throw new Error('Google OAuth redirect URI must target the protected callback route.');
  return uri;
}

function appOrigin(env: GoogleOAuthEnv): string {
  const origin = new URL(text(env.APP_ORIGIN));
  if (origin.protocol !== 'https:') throw new Error('Application origin must use HTTPS.');
  if (!configuredOrigins(env).includes(origin.origin)) throw new Error('Application origin must be present in ALLOWED_ORIGINS.');
  return origin.toString();
}

function corsHeaders(request: Request, env: GoogleOAuthEnv): Headers {
  const headers = new Headers({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Elara-Google-Capability, X-Elara-Google-Target', Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  if (origin && configuredOrigins(env).includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  return headers;
}

function json(request: Request, env: GoogleOAuthEnv, body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

function redirectToApp(env: GoogleOAuthEnv, status: string): Response {
  const target = new URL(appOrigin(env));
  target.searchParams.set('google', status);
  const headers = new Headers({ Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', setCookie(STATE_COOKIE, '', 'Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax'));
  return new Response(null, { status: 303, headers });
}

function normalizeScopeList(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function capabilityGranted(record: UserRecord, capability: GoogleCapabilityKey): boolean {
  const scope = getGoogleScope(capability).scope;
  return record.grantedScopes.includes(scope);
}

function grantedCapabilities(record: UserRecord): GoogleCapabilityKey[] {
  const capabilities = googleCapabilityKeySchema.options;
  return capabilities.filter((capability) => capabilityGranted(record, capability));
}

function stateFromRecord(record: UserRecord): 'connected' | 'needs-consent' | 'revoked' | 'partially-authorized' | 'token-recovery' {
  if (record.status === 'revoked') return 'revoked';
  const count = grantedCapabilities(record).length;
  if (!record.encryptedRefreshToken) return count > 0 ? 'token-recovery' : 'needs-consent';
  return count === googleCapabilityKeySchema.options.length ? 'connected' : count > 0 ? 'partially-authorized' : 'needs-consent';
}

function allowedGoogleTarget(capability: GoogleCapabilityKey, target: URL): boolean {
  if (target.protocol !== 'https:') return false;
  const host = target.hostname;
  const path = target.pathname;
  const rules: Record<GoogleCapabilityKey, Array<[string, string]>> = {
    'calendar.events.read': [['www.googleapis.com', '/calendar/v3/calendars/']],
    'calendar.events.write': [['www.googleapis.com', '/calendar/v3/calendars/']],
    'calendar.list.read': [['www.googleapis.com', '/calendar/v3/users/me/calendarList']],
    'calendar.settings.read': [['www.googleapis.com', '/calendar/v3/users/me/settings']],
    'tasks.read': [['tasks.googleapis.com', '/tasks/v1/']],
    'tasks.write': [['tasks.googleapis.com', '/tasks/v1/']],
    'docs.read': [['docs.googleapis.com', '/v1/documents/']],
    'docs.write': [['docs.googleapis.com', '/v1/documents/']],
    'chat.read': [['chat.googleapis.com', '/v1/']],
    'chat.write': [['chat.googleapis.com', '/v1/']],
    'gmail.read': [['gmail.googleapis.com', '/gmail/v1/users/me/']],
    'gmail.modify': [['gmail.googleapis.com', '/gmail/v1/users/me/']],
    'gmail.labels': [['gmail.googleapis.com', '/gmail/v1/users/me/']],
    'gmail.send': [['gmail.googleapis.com', '/gmail/v1/users/me/']],
    'drive.files.read': [['www.googleapis.com', '/drive/v3/']],
    'drive.files.write': [['www.googleapis.com', '/drive/v3/']],
    'sheets.read': [['sheets.googleapis.com', '/v4/spreadsheets/']],
    'sheets.write': [['sheets.googleapis.com', '/v4/spreadsheets/']],
  };
  return rules[capability].some(([allowedHost, prefix]) => allowedHost === host && path.startsWith(prefix));
}

async function exchangeCode(code: string, verifier: string, env: GoogleOAuthEnv): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: text(env.GOOGLE_CLIENT_ID),
      client_secret: text(env.GOOGLE_CLIENT_SECRET),
      redirect_uri: callbackUri(env).toString(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) throw new Error(payload.error === 'invalid_grant' ? 'invalid_grant' : 'token_exchange_failed');
  return payload;
}

async function refreshAccessToken(record: UserRecord, env: GoogleOAuthEnv): Promise<{ token: string; record: UserRecord }> {
  if (!record.encryptedRefreshToken) throw new Error('missing_refresh_token');
  const refreshToken = await decryptSecret(record.encryptedRefreshToken, env);
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: text(env.GOOGLE_CLIENT_ID), client_secret: text(env.GOOGLE_CLIENT_SECRET), refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    if (payload.error === 'invalid_grant') {
      return { token: '', record: { ...record, encryptedRefreshToken: undefined, encryptedAccessToken: undefined, accessTokenExpiresAt: undefined, status: 'revoked', updatedAt: new Date().toISOString() } };
    }
    throw new Error('token_refresh_failed');
  }
  const next: UserRecord = {
    ...record,
    encryptedRefreshToken: payload.refresh_token ? await encryptSecret(payload.refresh_token, env) : record.encryptedRefreshToken,
    encryptedAccessToken: await encryptSecret(payload.access_token, env),
    accessTokenExpiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
    grantedScopes: normalizeScopeList(payload.scope?.split(' ') ?? record.grantedScopes),
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
  return { token: payload.access_token, record: next };
}

async function accessTokenFor(record: UserRecord, env: GoogleOAuthEnv): Promise<{ token: string; record: UserRecord }> {
  if (record.encryptedAccessToken && (record.accessTokenExpiresAt ?? 0) > Date.now() + ACCESS_TOKEN_SKEW_SECONDS * 1000) {
    return { token: await decryptSecret(record.encryptedAccessToken, env), record };
  }
  const refreshed = await refreshAccessToken(record, env);
  await saveJson(env.GOOGLE_OAUTH_KV, userKey(record.sub), refreshed.record);
  if (!refreshed.token) throw new Error('revoked');
  return refreshed;
}

async function handleStart(request: Request, env: GoogleOAuthEnv): Promise<Response> {
  if (!isAllowedOrigin(request, env)) return json(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  const configError = missingConfig(env);
  if (configError) return json(request, env, { code: 'configuration', message: configError }, 503);
  const capabilityResult = googleCapabilityKeySchema.safeParse(new URL(request.url).searchParams.get('capability'));
  if (!capabilityResult.success) return json(request, env, { code: 'validation', message: 'Unknown Google capability.' }, 400);
  const capability = capabilityResult.data;
  const sessionId = cookieValue(request, SESSION_COOKIE);
  const existingUserSub = sessionId ? await env.GOOGLE_OAUTH_KV!.get(sessionKey(sessionId), 'text') : null;
  const existingUser = existingUserSub ? await loadJson<UserRecord>(env.GOOGLE_OAUTH_KV, userKey(existingUserSub)) : null;
  if (existingUser && capabilityGranted(existingUser, capability) && existingUser.status === 'active' && existingUser.encryptedRefreshToken) {
    return json(request, env, { authorizationUrl: appOrigin(env) });
  }
  const state = base64UrlEncode(randomBytes(32));
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = await sha256Base64Url(verifier);
  await saveJson(env.GOOGLE_OAUTH_KV, stateKey(state), { state, sessionId: sessionId ?? undefined, capability, codeVerifier: verifier, createdAt: Date.now() } satisfies StateRecord, STATE_TTL_SECONDS);
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', text(env.GOOGLE_CLIENT_ID));
  url.searchParams.set('redirect_uri', callbackUri(env).toString());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', [
    ...IDENTITY_SCOPES,
    getGoogleScope(capability).scope,
  ].join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (!existingUser?.encryptedRefreshToken) url.searchParams.set('prompt', 'consent');
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', setCookie(STATE_COOKIE, state, 'Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax'));
  return new Response(JSON.stringify({ authorizationUrl: url.toString() }), { status: 200, headers });
}

async function handleCallback(request: Request, env: GoogleOAuthEnv): Promise<Response> {
  const configError = missingConfig(env);
  if (configError) return new Response(configError, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const cookieState = cookieValue(request, STATE_COOKIE);
  if (!state || !cookieState || !timingSafeEqual(state, cookieState)) return redirectToApp(env, 'state_error');
  const stateRecord = await loadJson<StateRecord>(env.GOOGLE_OAUTH_KV, stateKey(state));
  await env.GOOGLE_OAUTH_KV!.delete(stateKey(state));
  if (!stateRecord || Date.now() - stateRecord.createdAt > STATE_TTL_SECONDS * 1000) return redirectToApp(env, 'state_expired');
  if (error || !code) return redirectToApp(env, error === 'access_denied' ? 'denied' : 'oauth_error');

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCode(code, stateRecord.codeVerifier, env);
  } catch {
    return redirectToApp(env, 'token_error');
  }

  const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!userInfoResponse.ok) return redirectToApp(env, 'identity_error');
  const info = await userInfoResponse.json().catch(() => ({})) as UserInfo;
  if (!info.sub || !info.email) return redirectToApp(env, 'identity_error');

  const previous = await loadJson<UserRecord>(env.GOOGLE_OAUTH_KV, userKey(info.sub));
  const grantedScopes = normalizeScopeList([...(previous?.grantedScopes ?? []), ...(tokens.scope?.split(' ') ?? []), getGoogleScope(stateRecord.capability).scope]);
  const refreshToken = tokens.refresh_token ? await encryptSecret(tokens.refresh_token, env) : previous?.encryptedRefreshToken;
  if (!refreshToken) return redirectToApp(env, 'token_recovery');
  const record: UserRecord = {
    sub: info.sub,
    email: info.email,
    displayName: info.name,
    grantedScopes,
    encryptedRefreshToken: refreshToken,
    encryptedAccessToken: await encryptSecret(tokens.access_token!, env),
    accessTokenExpiresAt: Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
  await saveJson(env.GOOGLE_OAUTH_KV, userKey(info.sub), record);
  const sessionId = stateRecord.sessionId ?? base64UrlEncode(randomBytes(32));
  await env.GOOGLE_OAUTH_KV!.put(sessionKey(sessionId), info.sub, { expirationTtl: SESSION_TTL_SECONDS });
  const headers = new Headers({ Location: appOrigin(env), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, sessionId, `Path=/; Max-Age=${SESSION_TTL_SECONDS}; Secure; HttpOnly; SameSite=None`));
  headers.append('Set-Cookie', setCookie(STATE_COOKIE, '', 'Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax'));
  return new Response(null, { status: 303, headers });
}

async function resolveSession(env: GoogleOAuthEnv, request: Request): Promise<{ sessionId: string; user: UserRecord } | null> {
  if (!env.GOOGLE_OAUTH_KV) return null;
  const sessionId = cookieValue(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const sub = await env.GOOGLE_OAUTH_KV.get(sessionKey(sessionId), 'text');
  if (!sub) return null;
  const user = await loadJson<UserRecord>(env.GOOGLE_OAUTH_KV, userKey(sub));
  if (!user) return null;
  return { sessionId, user };
}

async function handleStatus(request: Request, env: GoogleOAuthEnv): Promise<Response> {
  if (!isAllowedOrigin(request, env)) return json(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  const session = await resolveSession(env, request);
  if (!session) return json(request, env, { state: 'disconnected', grantedCapabilities: [] });
  const state = stateFromRecord(session.user);
  return json(request, env, {
    state,
    grantedCapabilities: grantedCapabilities(session.user),
    account: { email: session.user.email, ...(session.user.displayName ? { displayName: session.user.displayName } : {}) },
  });
}

async function handleDisconnect(request: Request, env: GoogleOAuthEnv): Promise<Response> {
  if (!isAllowedOrigin(request, env)) return json(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  const session = await resolveSession(env, request);
  if (session) {
    try {
      if (session.user.encryptedRefreshToken) {
        const refreshToken = await decryptSecret(session.user.encryptedRefreshToken, env);
        await fetch(GOOGLE_REVOCATION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) });
      }
    } catch {
      // Local credential deletion is still mandatory when disconnect is requested.
    }
    await env.GOOGLE_OAUTH_KV!.delete(userKey(session.user.sub));
    await env.GOOGLE_OAUTH_KV!.delete(sessionKey(session.sessionId));
  }
  const headers = new Headers();
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 'Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None'));
  return json(request, env, { disconnected: true }, 200, headers);
}

async function proxy(request: Request, env: GoogleOAuthEnv): Promise<Response> {
  if (!isAllowedOrigin(request, env)) return json(request, env, { code: 'authz', message: 'Origin is not authorized.' }, 403);
  const capabilityResult = googleCapabilityKeySchema.safeParse(request.headers.get('X-Elara-Google-Capability'));
  if (!capabilityResult.success) return json(request, env, { code: 'validation', message: 'Google capability header is invalid.' }, 400);
  const capability = capabilityResult.data;
  const targetHeader = request.headers.get('X-Elara-Google-Target');
  if (!targetHeader) return json(request, env, { code: 'validation', message: 'Google target is required.' }, 400);
  let googleTarget: URL;
  try { googleTarget = new URL(targetHeader); } catch { return json(request, env, { code: 'validation', message: 'Google target is invalid.' }, 400); }
  if (!allowedGoogleTarget(capability, googleTarget)) return json(request, env, { code: 'authz', message: 'Google target is not allowed for this capability.' }, 403);
  const session = await resolveSession(env, request);
  if (!session || session.user.status === 'revoked' || !capabilityGranted(session.user, capability)) return json(request, env, { code: 'authorization', message: 'Google capability is not authorized.' }, 401);

  const body = request.method === 'GET' || request.method === 'HEAD' || request.method === 'DELETE' ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > MAX_PROXY_BODY_BYTES) return json(request, env, { code: 'validation', message: 'Google request body is too large.' }, 413);
  const outgoingHeaders = new Headers();
  for (const name of ['Accept', 'Content-Type', 'If-Match']) {
    const value = request.headers.get(name);
    if (value) outgoingHeaders.set(name, value);
  }

  let authorized = await accessTokenFor(session.user, env);
  let response: Response;
  const execute = async (token: string): Promise<Response> => {
    const headers = new Headers(outgoingHeaders);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(googleTarget, { method: request.method, headers, body });
  };
  try {
    response = await execute(authorized.token);
    if (response.status === 401) {
      authorized = await refreshAccessToken(authorized.record, env);
      await saveJson(env.GOOGLE_OAUTH_KV, userKey(session.user.sub), authorized.record);
      if (!authorized.token) return json(request, env, { code: 'revoked', message: 'Google authorization has been revoked.' }, 401);
      response = await execute(authorized.token);
    }
  } catch {
    return json(request, env, { code: 'provider', message: 'Google request could not be completed.' }, 502);
  }

  const responseHeaders = new Headers();
  const contentType = response.headers.get('Content-Type');
  if (contentType) responseHeaders.set('Content-Type', contentType);
  responseHeaders.set('Cache-Control', 'no-store');
  const responseBody = await response.arrayBuffer();
  if (responseBody.byteLength > MAX_PROXY_BODY_BYTES * 4) return json(request, env, { code: 'provider', message: 'Google response exceeded the application size boundary.' }, 502);
  return new Response(responseBody, { status: response.status, headers: responseHeaders });
}

export async function handleGoogleOAuthRequest(request: Request, env: GoogleOAuthEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/api/google/oauth/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (pathname === '/api/google/oauth/start' && request.method === 'GET') return handleStart(request, env);
  if (pathname === '/api/google/oauth/callback' && request.method === 'GET') return handleCallback(request, env);
  if (pathname === '/api/google/oauth/status' && request.method === 'GET') return handleStatus(request, env);
  if (pathname === '/api/google/oauth/disconnect' && request.method === 'POST') return handleDisconnect(request, env);
  if (pathname === '/api/google/oauth/proxy' && request.method !== 'OPTIONS') return proxy(request, env);
  return new Response('Not found.', { status: 404 });
}
