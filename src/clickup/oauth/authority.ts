import { newNonce, signWrite } from '../../autonomy/protocol';
import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../../autonomy/cloud/pairing';
import {
  clickUpConnectionMethodsSchema,
  clickUpOAuthStartSchema,
  clickUpOAuthStatusSchema,
  type ClickUpConnectionMethods,
  type ClickUpExecutionGrant,
  type ClickUpOAuthAuthority,
  type ClickUpOAuthStart,
  type ClickUpOAuthStatus,
} from './contracts';

const WORKER_TIMEOUT_MS = 20_000;
const MAX_WORKER_RESPONSE_BYTES = 64 * 1024;
const STORAGE_KEY = 'elara.clickup.authorization.v1';

export class ClickUpOAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

function activePairing(): AutonomyPairing {
  if (typeof window === 'undefined') throw new ClickUpOAuthError('pairing', 'ClickUp requires a paired self-hosted Worker.', 0);
  const pairing = loadPairing();
  if (!pairing) throw new ClickUpOAuthError('pairing', 'ClickUp requires a paired self-hosted Worker. Pair this Elara installation before connecting ClickUp.', 0);
  return pairing;
}

export function normalizeWorkerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ClickUpOAuthError('worker-url', 'The paired Worker URL is invalid.', 0);
  }
  if (url.protocol !== 'https:') throw new ClickUpOAuthError('worker-url', 'The paired Worker must use HTTPS.', 0);
  if (url.username || url.password || url.search || url.hash) throw new ClickUpOAuthError('worker-url', 'The paired Worker URL contains unsupported components.', 0);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function clickUpPairingAuthorityBinding(pairing: AutonomyPairing): string {
  return `${normalizeWorkerBaseUrl(pairing.workerUrl)}#${pairing.installationId}`;
}

function assertPairingStillCurrent(pairing: AutonomyPairing): void {
  const expected = clickUpPairingAuthorityBinding(pairing);
  const current = loadPairing();
  if (!current) {
    throw new ClickUpOAuthError('grant_changed', 'The paired Worker changed before ClickUp OAuth egress.', 409);
  }
  try {
    if (clickUpPairingAuthorityBinding(current) !== expected) {
      throw new ClickUpOAuthError('grant_changed', 'The paired Worker changed before ClickUp OAuth egress.', 409);
    }
  } catch (error) {
    if (error instanceof ClickUpOAuthError && error.code === 'grant_changed') throw error;
    throw new ClickUpOAuthError('grant_changed', 'The paired Worker changed before ClickUp OAuth egress.', 409);
  }
}

async function workerToken(pairing: AutonomyPairing): Promise<string> {
  const token = (await resolvePairingToken(pairing)).trim();
  if (!token) throw new ClickUpOAuthError('credential', 'The self-hosted Worker installation credential is unavailable. Pair this device again.', 0);
  return token;
}

interface WorkerJsonResponse {
  readonly status: number;
  readonly body: unknown;
}

async function readBoundedWorkerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > MAX_WORKER_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ClickUpOAuthError('response_too_large', 'The paired Worker returned an oversized ClickUp response.', response.status);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!bytes.byteLength) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ClickUpOAuthError('protocol', 'The paired Worker returned invalid ClickUp JSON.', response.status);
  }
}

async function workerRequest(pairing: AutonomyPairing, path: string, init: RequestInit): Promise<WorkerJsonResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizeWorkerBaseUrl(pairing.workerUrl)}${path}`, { ...init, signal: controller.signal });
    const body = await readBoundedWorkerJson(response);
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof ClickUpOAuthError) throw error;
    if (controller.signal.aborted) {
      throw new ClickUpOAuthError('timeout', 'The paired Worker ClickUp request timed out.', 0);
    }
    throw new ClickUpOAuthError('network', 'The self-hosted Worker could not be reached.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

function workerError(response: WorkerJsonResponse): ClickUpOAuthError {
  const record = response.body && typeof response.body === 'object' && !Array.isArray(response.body)
    ? response.body as Record<string, unknown>
    : undefined;
  const code = typeof record?.code === 'string' ? record.code.slice(0, 100) : `http-${response.status}`;
  const message = typeof record?.message === 'string'
    ? record.message.slice(0, 1_000)
    : `The self-hosted Worker responded with HTTP ${response.status}.`;
  return new ClickUpOAuthError(code, message, response.status);
}

function persistStatus(status: ClickUpOAuthStatus): void {
  if (typeof localStorage === 'undefined') return;
  if (!status.connected) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
}

export function loadStoredClickUpStatus(): ClickUpOAuthStatus | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = clickUpOAuthStatusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function bearerStatus(pairing: AutonomyPairing): Promise<ClickUpOAuthStatus> {
  try {
    const token = await workerToken(pairing);
    assertPairingStillCurrent(pairing);
    const response = await workerRequest(pairing, '/clickup/oauth/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assertPairingStillCurrent(pairing);
    if (response.status !== 200) throw workerError(response);
    const parsed = clickUpOAuthStatusSchema.parse(response.body);
    persistStatus(parsed);
    return parsed;
  } catch (cause) {
    // Cached ClickUp metadata is only a convenience for tool election. If the
    // Worker cannot authoritatively confirm the grant, fail closed rather than
    // allowing a stale account/workspace snapshot to keep advertising tools.
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    throw cause;
  }
}

async function bearerConnectionMethods(pairing: AutonomyPairing): Promise<ClickUpConnectionMethods> {
  const token = await workerToken(pairing);
  assertPairingStillCurrent(pairing);
  const response = await workerRequest(pairing, '/clickup/oauth/methods', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  assertPairingStillCurrent(pairing);
  // Older Workers do not expose this endpoint and support OAuth only.
  if (response.status === 404) return { oauth: true, personalToken: false };
  if (response.status !== 200) throw workerError(response);
  return clickUpConnectionMethodsSchema.parse(response.body);
}

async function signedPost<T>(
  pairing: AutonomyPairing,
  path: string,
  payload: unknown,
  parse: (value: unknown) => T,
): Promise<T> {
  const token = await workerToken(pairing);
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const nonce = newNonce();
  const signature = await signWrite(token, 'POST', path, timestamp, nonce, body);
  assertPairingStillCurrent(pairing);
  const response = await workerRequest(pairing, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Elara-Timestamp': String(timestamp),
      'X-Elara-Nonce': nonce,
      'X-Elara-Signature': signature,
    },
    body,
  });
  assertPairingStillCurrent(pairing);
  if (response.status !== 200) throw workerError(response);
  return parse(response.body);
}

export const clickUpOAuthAuthority: ClickUpOAuthAuthority = {
  async getStatus(): Promise<ClickUpOAuthStatus> {
    return bearerStatus(activePairing());
  },

  async getConnectionMethods(): Promise<ClickUpConnectionMethods> {
    return bearerConnectionMethods(activePairing());
  },

  async getExecutionGrant(): Promise<ClickUpExecutionGrant> {
    const pairing = activePairing();
    const status = await bearerStatus(pairing);
    return {
      status,
      authorityBinding: clickUpPairingAuthorityBinding(pairing),
      revision: status.updatedAt ?? 0,
    };
  },

  async beginConnect(redirectUri: string): Promise<ClickUpOAuthStart> {
    return signedPost(activePairing(), '/clickup/oauth/start', { redirectUri }, (value) => clickUpOAuthStartSchema.parse(value));
  },

  async completeConnect(input): Promise<ClickUpOAuthStatus> {
    const status = await signedPost(
      activePairing(),
      '/clickup/oauth/exchange',
      input,
      (value) => clickUpOAuthStatusSchema.parse(value),
    );
    const normalized = status;
    persistStatus(normalized);
    return normalized;
  },

  async connectPersonalToken(): Promise<ClickUpOAuthStatus> {
    const pairing = activePairing();
    try {
      const status = await signedPost(
        pairing,
        '/clickup/oauth/personal-token',
        {},
        (value) => clickUpOAuthStatusSchema.parse(value),
      );
      persistStatus(status);
      return status;
    } catch (cause) {
      // A timeout/network failure is ambiguous: the Worker may already have
      // committed the replacement grant. Reconcile authoritative status before
      // surfacing the error. If reconciliation is also unavailable, clear the
      // cached status so stale identity metadata cannot continue tool election.
      try {
        await bearerStatus(pairing);
      } catch {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      }
      throw cause;
    }
  },

  async disconnect(): Promise<void> {
    await signedPost(activePairing(), '/clickup/oauth/disconnect', {}, (value) => {
      if (!value || typeof value !== 'object' || (value as Record<string, unknown>).disconnected !== true) {
        throw new ClickUpOAuthError('protocol', 'The Worker did not confirm ClickUp disconnect.', 0);
      }
      return true;
    });
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  },
};
