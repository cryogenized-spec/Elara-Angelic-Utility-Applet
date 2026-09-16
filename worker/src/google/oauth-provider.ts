export interface GoogleOAuthServerEnv {
  readonly GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

export interface GoogleOAuthTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken?: string;
  readonly refreshTokenExpiresIn?: number;
  readonly scopes: readonly string[];
}

export interface GoogleOAuthAccount {
  readonly subject: string;
  readonly email: string;
  readonly displayName?: string;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const MAX_TOKEN_CHARS = 32_768;
const MAX_SCOPE_CHARS = 16_384;
const MAX_SUBJECT_CHARS = 255;

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function boundedToken(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Google OAuth ${field} was missing.`);
  const normalized = value.trim();
  if (normalized.length > MAX_TOKEN_CHARS) throw new Error(`Google OAuth ${field} was too large.`);
  return normalized;
}

function parseScopes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  if (value.length > MAX_SCOPE_CHARS) throw new Error('Google OAuth scope response was too large.');
  return [...new Set(value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))];
}

async function readTokenResponse(response: Response): Promise<GoogleOAuthTokenResult> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new Error(`Google OAuth token exchange failed (${response.status}).`);
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? Math.max(60, Math.trunc(payload.expires_in))
    : 3600;
  const refreshTokenExpiresIn = typeof payload.refresh_token_expires_in === 'number' && Number.isFinite(payload.refresh_token_expires_in)
    ? Math.max(60, Math.trunc(payload.refresh_token_expires_in))
    : undefined;
  const refreshToken = typeof payload.refresh_token === 'string' && payload.refresh_token.trim()
    ? boundedToken(payload.refresh_token, 'refresh token')
    : undefined;
  return {
    accessToken: boundedToken(payload.access_token, 'access token'),
    expiresIn,
    ...(refreshToken ? { refreshToken } : {}),
    ...(refreshTokenExpiresIn ? { refreshTokenExpiresIn } : {}),
    scopes: parseScopes(payload.scope),
  };
}

export async function exchangeGoogleAuthorizationCode(
  env: GoogleOAuthServerEnv,
  input: { code: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<GoogleOAuthTokenResult> {
  const body = new URLSearchParams({
    code: boundedToken(input.code, 'authorization code'),
    client_id: required(env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: required(env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
  return readTokenResponse(await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }));
}

export async function refreshGoogleAccessToken(
  env: GoogleOAuthServerEnv,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleOAuthTokenResult> {
  const body = new URLSearchParams({
    client_id: required(env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: required(env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    refresh_token: boundedToken(refreshToken, 'refresh token'),
    grant_type: 'refresh_token',
  });
  return readTokenResponse(await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }));
}

export async function fetchGoogleOAuthAccount(accessToken: string, fetcher: typeof fetch = fetch): Promise<GoogleOAuthAccount | null> {
  const response = await fetcher(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${boundedToken(accessToken, 'access token')}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const subject = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
  const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
  if (!subject || subject.length > MAX_SUBJECT_CHARS || !email || email.length > 320) return null;
  const displayName = typeof payload?.name === 'string' && payload.name.trim()
    ? payload.name.trim().slice(0, 500)
    : undefined;
  return { subject, email, ...(displayName ? { displayName } : {}) };
}

export async function revokeGoogleOAuthToken(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: boundedToken(token, 'revocation token') }),
  });
  return response.ok;
}
