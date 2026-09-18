import {
  ELARA_AUTH_NONCE_HEADER,
  ELARA_AUTH_SIGNATURE_HEADER,
  ELARA_AUTH_TIMESTAMP_HEADER,
  deriveInstallationId,
  verifyBearerToken,
  verifySignedWrite,
} from '../../../src/autonomy/protocol';

// ---------------------------------------------------------------------------
// The /autonomy/* Worker boundary (design §4.1 routes, §10 auth).
//
// The Worker stays a NARROW boundary: it terminates CORS, performs a fast
// first-pass authentication rejection (missing token, bad bearer, stale
// timestamp, bad signature), and forwards the ORIGINAL method/path/body and
// auth headers to the installation's Durable Object — which re-verifies
// everything independently and owns the durable nonce ledger. No model
// execution, no Google access, no scheduler logic lives here.
//
// There is deliberately NO public wake endpoint: the cron heartbeat reaches
// the DO only through the Worker→DO binding (see scheduled() in index.ts).
// ---------------------------------------------------------------------------

export const AUTONOMY_WORKER_VERSION = '1.0.0-phase-c1';
export const AUTONOMY_SCHEMA_VERSION = 1;
/** What this deployment supports — the app refuses to enable autonomy on mismatch. */
export const AUTONOMY_CAPABILITIES = ['config-sync', 'context-sync', 'scheduler-live', 'routine-run-workflow', 'cloud-execution'] as const;
export const AUTONOMY_CRON = '0 * * * *';

export interface AutonomyEnv {
  ELARA_INSTALLATION_TOKEN?: string;
  AUTONOMY?: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

const CORS_EXTRA_HEADERS = 'Content-Type, Authorization, X-Elara-Timestamp, X-Elara-Nonce, X-Elara-Signature';

function json(body: unknown, status: number, corsOrigin: string | null): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function bearerOf(request: Request): Promise<string | null> {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

/** The DO stub for an installation, reached only through the binding. */
function autonomyStub(env: AutonomyEnv, installationId: string): DurableObjectStub {
  return env.AUTONOMY!.get(env.AUTONOMY!.idFromName(installationId));
}

/** Forward an authenticated app request to the DO verbatim (it re-verifies independently). */
async function forwardToEngine(env: AutonomyEnv, installationId: string, request: Request, body: string, corsOrigin: string | null): Promise<Response> {
  const forwardHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const header of ['Authorization', ELARA_AUTH_TIMESTAMP_HEADER, ELARA_AUTH_NONCE_HEADER, ELARA_AUTH_SIGNATURE_HEADER]) {
    const value = request.headers.get(header);
    if (value) forwardHeaders[header] = value;
  }
  const url = new URL(request.url);
  const response = await autonomyStub(env, installationId).fetch(new Request(`https://autonomy-engine${url.pathname}${url.search}`, {
    method: request.method,
    headers: forwardHeaders,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
  }));
  if (!corsOrigin) return response;
  // The DO response is internal; the worker re-attaches the browser CORS
  // boundary it owns.
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', corsOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Handle one /autonomy/* request. Returns null when the path is not an
 * autonomy route (the caller then falls through to 404).
 */
export async function handleAutonomyRoute(pathname: string, request: Request, env: AutonomyEnv, corsOrigin: string | null): Promise<Response | null> {
  if (!pathname.startsWith('/autonomy/') && pathname !== '/autonomy') return null;

  // Public liveness + capability manifest — no secrets, no state.
  if (pathname === '/autonomy/health' && request.method === 'GET') {
    return json({
      service: 'elara-gemini',
      autonomy: {
        configured: Boolean(env.AUTONOMY && env.ELARA_INSTALLATION_TOKEN),
        version: AUTONOMY_WORKER_VERSION,
        schemaVersion: AUTONOMY_SCHEMA_VERSION,
        capabilities: AUTONOMY_CAPABILITIES,
        cron: AUTONOMY_CRON,
        schedulerLive: true,
        agentExecution: true,
        dryRun: false,
      },
    }, 200, corsOrigin);
  }

  if (!env.AUTONOMY || !env.ELARA_INSTALLATION_TOKEN) {
    return json({ code: 'configuration', message: 'Autonomy is not configured on this worker (missing AUTONOMY binding or installation token).' }, 503, corsOrigin);
  }
  const token = env.ELARA_INSTALLATION_TOKEN;
  const installationId = await deriveInstallationId(token);

  // Pairing: prove possession of the token, return the capability manifest.
  if (pathname === '/autonomy/pair' && request.method === 'POST') {
    if (!(await verifyBearerToken(await bearerOf(request), token))) {
      return json({ code: 'auth', message: 'A valid installation token is required.' }, 401, corsOrigin);
    }
    return json({
      installationId,
      service: 'elara-gemini',
      version: AUTONOMY_WORKER_VERSION,
      schemaVersion: AUTONOMY_SCHEMA_VERSION,
      capabilities: AUTONOMY_CAPABILITIES,
      cron: AUTONOMY_CRON,
      schedulerLive: true,
      agentExecution: true,
      dryRun: false,
    }, 200, corsOrigin);
  }

  const isRead = request.method === 'GET';
  const isWrite = request.method === 'POST';

  if (isRead && (pathname === '/autonomy/state' || pathname === '/autonomy/runs' || pathname === '/autonomy/events' || pathname === '/autonomy/context')) {
    // First-pass bearer check; the DO re-verifies.
    if (!(await verifyBearerToken(await bearerOf(request), token))) {
      return json({ code: 'auth', message: 'A valid installation token is required.' }, 401, corsOrigin);
    }
    return forwardToEngine(env, installationId, request, '', corsOrigin);
  }

  if (isWrite && (pathname === '/autonomy/config' || pathname === '/autonomy/context')) {
    const body = await request.text();
    // First-pass write verification (the DO re-verifies against its own copy
    // of the token and its durable nonce ledger).
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
      return json({ code: verified.code, message: `Write rejected: ${verified.code}.` }, status, corsOrigin);
    }
    return forwardToEngine(env, installationId, request, body, corsOrigin);
  }

  return json({ code: 'not_found', message: 'Not found.' }, 404, corsOrigin);
}

/** Preflight response for /autonomy/* routes (extra auth headers allowed). */
export function autonomyPreflight(corsOrigin: string | null): Response {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': CORS_EXTRA_HEADERS,
    Vary: 'Origin',
  });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(null, { status: 204, headers });
}
