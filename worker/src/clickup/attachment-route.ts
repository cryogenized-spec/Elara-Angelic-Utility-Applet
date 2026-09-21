import {
  ELARA_INTERNAL_HEADER,
  deriveInstallationId,
  internalWakeMarker,
  verifyBearerToken,
} from '../../../src/autonomy/protocol';
import { ARTIFACT_LIMITS } from '../../../src/artifacts/limits';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../../src/clickup/mcp-protocol';

export interface ClickUpAttachmentRouteEnv {
  readonly ELARA_INSTALLATION_TOKEN?: string;
  readonly CLICKUP_OAUTH?: DurableObjectNamespace;
}

const ATTACHMENT_PATH = '/clickup/attachment';
const INTERNAL_ATTACHMENT_PATH = '/internal/clickup/attachment';
const MAX_MULTIPART_OVERHEAD_BYTES = 512 * 1024;
const MAX_ATTACHMENT_REQUEST_BYTES = ARTIFACT_LIMITS.maxAttachmentBytes + MAX_MULTIPART_OVERHEAD_BYTES;

function json(body: unknown, status: number, corsOrigin: string | null): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    Vary: 'Origin',
  });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function bearer(request: Request): string | null {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

function admittedGrantRevision(request: Request): number | null {
  const raw = request.headers.get(CLICKUP_GRANT_REVISION_HEADER)?.trim() ?? '';
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function vaultStub(env: ClickUpAttachmentRouteEnv): Promise<DurableObjectStub> {
  const token = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!token || !env.CLICKUP_OAUTH) throw new Error('ClickUp is not configured on this Worker.');
  const installationId = await deriveInstallationId(token);
  return env.CLICKUP_OAUTH.get(env.CLICKUP_OAUTH.idFromName(installationId));
}

async function readBoundedBytes(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_REQUEST_BYTES) throw new Error('too-large');
  const reader = request.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_REQUEST_BYTES) throw new Error('too-large');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_REQUEST_BYTES) throw new Error('too-large');
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function handleClickUpAttachmentRoute(
  pathname: string,
  request: Request,
  env: ClickUpAttachmentRouteEnv,
  corsOrigin: string | null,
): Promise<Response | null> {
  if (pathname !== ATTACHMENT_PATH) return null;
  if (request.method !== 'POST') return json({ code: 'method', message: 'ClickUp attachment endpoint accepts POST only.' }, 405, corsOrigin);

  const installationToken = env.ELARA_INSTALLATION_TOKEN?.trim() ?? '';
  if (!installationToken || !env.CLICKUP_OAUTH) {
    return json({ code: 'configuration', message: 'ClickUp is not configured on this Worker.' }, 503, corsOrigin);
  }
  if (!(await verifyBearerToken(bearer(request), installationToken))) {
    return json({ code: 'auth', message: 'A valid Elara installation credential is required.' }, 401, corsOrigin);
  }
  const grantRevision = admittedGrantRevision(request);
  if (grantRevision === null) {
    return json({ code: 'grant_required', message: 'ClickUp attachment upload requires the admitted provider grant revision.' }, 409, corsOrigin);
  }

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLocaleLowerCase().startsWith('multipart/form-data;')) {
    return json({ code: 'validation', message: 'ClickUp attachment upload requires multipart/form-data.' }, 415, corsOrigin);
  }
  let body: Uint8Array;
  try {
    body = await readBoundedBytes(request);
  } catch {
    return json({ code: 'artifact-too-large', message: 'The attachment request exceeds Elara\'s upload limit.' }, 413, corsOrigin);
  }

  try {
    const internal = new Headers();
    internal.set('Content-Type', contentType);
    internal.set(ELARA_INTERNAL_HEADER, await internalWakeMarker(installationToken));
    internal.set(CLICKUP_GRANT_REVISION_HEADER, String(grantRevision));
    const forwarded = new Request(`https://clickup-oauth-vault${INTERNAL_ATTACHMENT_PATH}`, {
      method: 'POST',
      headers: internal,
      body,
    });
    const response = await (await vaultStub(env)).fetch(forwarded);
    const body = await response.text();
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      Vary: 'Origin',
    });
    if (corsOrigin) {
      headers.set('Access-Control-Allow-Origin', corsOrigin);
      headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return new Response(body, { status: response.status, headers });
  } catch {
    return json({ code: 'attachment', message: 'The ClickUp attachment upload could not be completed.' }, 502, corsOrigin);
  }
}

export function clickUpAttachmentPreflight(corsOrigin: string | null): Response {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Accept, Authorization, Content-Type, ${CLICKUP_GRANT_REVISION_HEADER}`,
    Vary: 'Origin',
  });
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(null, { status: 204, headers });
}
