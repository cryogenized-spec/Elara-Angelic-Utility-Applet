import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  deriveInstallationId,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';

export interface ClickUpOAuthRouteEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH?: DurableObjectNamespace;
}

export const CLICKUP_WEBHOOK_ENDPOINT_HEADER = 'X-Elara-ClickUp-Webhook-Endpoint';

const CLICKUP_OAUTH_PATHS = new Set([
  '/clickup/oauth/status',
  '/clickup/oauth/start',
  '/clickup/oauth/exchange',
  '/clickup/oauth/disconnect',
]);

const CORS_HEADERS = [
  'Content-Type',
  'Authorization',
  ELARA_AUTH_TIMESTAMP_HEADER,
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
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

async function vaultStub(env: ClickUpOAuthRouteEnv): Promise<DurableObjectStub> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.CLICKUP_OAUTH) throw new Error('ClickUp OAuth vault is not configured.');
  const installationId = await deriveInstallationId(token);
  return env.CLICKUP_OAUTH.get(env.CLICKUP_OAUTH.idFromName(installationId));
}

async function forward(env: ClickUpOAuthRouteEnv, request: Request, body: string | undefined, corsOrigin: string | null): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const name of [
    'Authorization',
    'Content-Type',
    'Origin',
    ELARA_AUTH_TIMESTAMP_HEADER,
    ELARA_AUTH_NONCE_HEADER,
    ELARA_AUTH_SIGNATURE_HEADER,
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (url.pathname === '/clickup/oauth/exchange') {
    headers.set(CLICKUP_WEBHOOK_ENDPOINT_HEADER, `${url.origin}/clickup/webhook`);
  }
  const response = await (await vaultStub(env)).fetch(new Request(`https://clickup-oauth-vault${url.pathname}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
  }));
  return attachCors(response, corsOrigin);
}

export async function handleClickUpOAuthRoute(
  pathname: string,
  request: Request,
  env: ClickUpOAuthRouteEnv,
  corsOrigin: string | null,
): Promise<Response | null> {
  if (!pathname.startsWith('/clickup/oauth/')) return null;
  if (!CLICKUP_OAUTH_PATHS.has(pathname)) return json({ code: 'not_found', message: 'Not found.' }, 404, corsOrigin);
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.CLICKUP_OAUTH) return json({ code: 'configuration', message: 'Durable ClickUp OAuth is not configured on this Worker.' }, 503, corsOrigin);

  if (request.method === 'GET' && pathname === '/clickup/oauth/status') {
    if (!(await verifyBearerToken(bearer(request), token))) return json({ code: 'auth', message: 'A valid installation credential is required.' }, 401, corsOrigin);
    return forward(env, request, undefined, corsOrigin);
  }

  if (request.method !== 'POST' || pathname === '/clickup/oauth/status') {
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
    return json({ code: verified.code, message: `ClickUp OAuth write rejected: ${verified.code}.` }, status, corsOrigin);
  }
  return forward(env, request, body, corsOrigin);
}

export function clickUpOAuthPreflight(corsOrigin: string | null): Response {
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
