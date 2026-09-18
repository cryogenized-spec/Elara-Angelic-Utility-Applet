import coreWorker, { type Env as CoreEnv } from './index';
import { googleOAuthPreflight, handleGoogleOAuthRoute } from './google/oauth-routes';

export { AutonomyEngine, RoutineRunWorkflow } from './index';
export { GoogleOAuthVault } from './google/oauth-vault';

export interface Env extends CoreEnv {
  /** Dedicated encrypted Google refresh-token authority, one instance per installation. */
  GOOGLE_OAUTH?: DurableObjectNamespace;
  /** Server-side OAuth web client identifier. Public identity, kept here with the exchange authority. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Server-side OAuth web client secret. Wrangler secret only. */
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** High-entropy AES-GCM vault material. Wrangler secret only. */
  GOOGLE_OAUTH_VAULT_KEY?: string;
}

function configuredOrigins(env: Env): readonly string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  return configuredOrigins(env).includes(origin ?? '') ? origin : null;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    Vary: 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/google/oauth/')) {
      const origin = request.headers.get('Origin');
      const corsOrigin = allowedOrigin(request, env);
      if (origin && !corsOrigin) return json({ code: 'authz', message: 'Origin is not authorized.' }, 403, null);
      if (request.method === 'OPTIONS') return googleOAuthPreflight(corsOrigin);
      try {
        const response = await handleGoogleOAuthRoute(pathname, request, env, corsOrigin);
        return response ?? json({ code: 'not_found', message: 'Not found.' }, 404, corsOrigin);
      } catch {
        return json({ code: 'internal', message: 'The Google OAuth Worker boundary could not complete the request.' }, 500, corsOrigin);
      }
    }
    return coreWorker.fetch(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await coreWorker.scheduled(controller, env, ctx);
  },
};
