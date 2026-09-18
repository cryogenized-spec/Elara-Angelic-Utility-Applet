import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  deriveInstallationId,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';

export interface GoogleOAuthRouteEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly GOOGLE_OAUTH?: DurableObjectNamespace;
}

const GOOGLE_OAUTH_PATHS = new Set([
  '/google/oauth/status',
  '/google/oauth/exchange',
  '/google/oauth/token',
  '/google/oauth/disconnect',
]);

const CORS_HEADERS = [
  'Content-Type',
  'Authorization',
  ELARA_AUTH_TIMESTAMP_HEADER,
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  'X-Requested-With',
].join(', ');

function json(body: unknown, status: number, corsOrigin: string | null): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', Vary: 'Origin' });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function attachCors(response: Response, corsOrigin: string | null): Response {
  if (!corsOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', corsOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

function bearer(request: Request): string | null {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

async function vaultStub(env: GoogleOAuthRouteEnv): Promise<DurableObjectStub> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.GOOGLE_OAUTH) throw new Error('Google OAuth vault is not configured.');
  const installationId = await deriveInstallationId(token);
  return env.GOOGLE_OAUTH.get(env.GOOGLE_OAUTH.idFromName(installationId));
}

async function forward(env: GoogleOAuthRouteEnv, request: Request, body: string | undefined, corsOrigin: string | null): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const name of [
    'Authorization',
    'Content-Type',
    'Origin',
    'X-Requested-With',
    ELARA_AUTH_TIMESTAMP_HEADER,
    ELARA_AUTH_NONCE_HEADER,
    ELARA_AUTH_SIGNATURE_HEADER,
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await (await vaultStub(env)).fetch(new Request(`https://google-oauth-vault${url.pathname}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
  }));
  return attachCors(response, corsOrigin);
}

export async function handleGoogleOAuthRoute(
  pathname: string,
  request: Request,
  env: GoogleOAuthRouteEnv,
  corsOrigin: string | null,
): Promise<Response | null> {
  if (!pathname.startsWith('/google/oauth/')) return null;
  if (!GOOGLE_OAUTH_PATHS.has(pathname)) return json({ code: 'not_found', message: 'Not found.' }, 404, corsOrigin);
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.GOOGLE_OAUTH) return json({ code: 'configuration', message: 'Durable Google OAuth is not configured on this Worker.' }, 503, corsOrigin);

  if (request.method === 'GET' && pathname === '/google/oauth/status') {
    if (!(await verifyBearerToken(bearer(request), token))) return json({ code: 'auth', message: 'A valid installation credential is required.' }, 401, corsOrigin);
    return forward(env, request, undefined, corsOrigin);
  }

  if (request.method !== 'POST' || pathname === '/google/oauth/status') {
    return json({ code: 'method', message: 'Method not allowed.' }, 405, corsOrigin);
  }

  const body = await request.text();
  const verified = await verifySignedWrite({
    method: request.method,
    path: pathname,
    timestamp: request.headers.get(ELARA_AUTH_TIMESTAMP_HEADER) ?? '',
    nonce: request.headers.get(ELARA_AUTH_NONCE_HEADER) ?? '',
    signature: request.headers.get(ELARA_AUTH_SIGNATURE_HEADER) ?? '',
    body,
  }, token, Date.now());
  if (!verified.ok) {
    const status = verified.code === 'stale-timestamp' ? 409 : 401;
    return json({ code: verified.code, message: `Google OAuth write rejected: ${verified.code}.` }, status, corsOrigin);
  }

  if (pathname === '/google/oauth/exchange' && request.headers.get('X-Requested-With') !== 'XmlHttpRequest') {
    return json({ code: 'csrf', message: 'Google OAuth exchange requires the popup CSRF marker.' }, 403, corsOrigin);
  }
  return forward(env, request, body, corsOrigin);
}

export function googleOAuthPreflight(corsOrigin: string | null): Response {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': CORS_HEADERS,
    Vary: 'Origin',
  });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(null, { status: 204, headers });
}
