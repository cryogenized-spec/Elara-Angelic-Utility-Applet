import {
  ELARA_INTERNAL_HEADER,
  deriveInstallationId,
  internalWakeMarker,
} from '../../../src/autonomy/protocol';

export interface ClickUpWebhookRouteEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH?: DurableObjectNamespace;
}

const CLICKUP_WEBHOOK_PATH = '/clickup/webhook';
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function readBoundedBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error('too-large');
  }
  const reader = request.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_WEBHOOK_BODY_BYTES) throw new Error('too-large');
    return new TextDecoder().decode(bytes);
  }
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BODY_BYTES) throw new Error('too-large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
}

async function vaultStub(env: ClickUpWebhookRouteEnv): Promise<DurableObjectStub> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.CLICKUP_OAUTH) throw new Error('ClickUp webhook authority is not configured.');
  const installationId = await deriveInstallationId(token);
  return env.CLICKUP_OAUTH.get(env.CLICKUP_OAUTH.idFromName(installationId));
}

export async function handleClickUpWebhookRoute(
  pathname: string,
  request: Request,
  env: ClickUpWebhookRouteEnv,
): Promise<Response | null> {
  if (pathname !== CLICKUP_WEBHOOK_PATH) return null;
  if (request.method !== 'POST') return json({ code: 'method', message: 'ClickUp webhook endpoint accepts POST only.' }, 405);

  const installationToken = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!installationToken || !env.CLICKUP_OAUTH) {
    return json({ code: 'configuration', message: 'ClickUp webhook authority is not configured.' }, 503);
  }
  const contentType = (request.headers.get('Content-Type') ?? '').toLocaleLowerCase().split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') {
    return json({ code: 'content_type', message: 'ClickUp webhook deliveries must use application/json.' }, 415);
  }
  const signature = request.headers.get('X-Signature')?.trim() ?? '';
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return json({ code: 'webhook_signature', message: 'ClickUp webhook signature is invalid.' }, 401);
  }

  let body: string;
  try {
    body = await readBoundedBody(request);
  } catch {
    return json({ code: 'request_too_large', message: 'ClickUp webhook payload exceeds Elara\'s byte limit.' }, 413);
  }

  const response = await (await vaultStub(env)).fetch(new Request(
    'https://clickup-oauth-vault/internal/clickup/webhook',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Signature': signature,
        [ELARA_INTERNAL_HEADER]: await internalWakeMarker(installationToken),
      },
      body,
    },
  ));
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
