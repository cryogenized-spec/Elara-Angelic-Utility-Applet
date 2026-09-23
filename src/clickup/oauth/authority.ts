import { newNonce, signWrite } from '../../autonomy/protocol';
import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../../autonomy/cloud/pairing';
import {
  clickUpConnectionMethodsSchema,
  clickUpConnectionStateSchema,
  clickUpOAuthStartSchema,
  clickUpOAuthStatusSchema,
  type ClickUpConnectionMethods,
  type ClickUpConnectionState,
  type ClickUpExecutionGrant,
  type ClickUpOAuthAuthority,
  type ClickUpOAuthStart,
  type ClickUpOAuthStatus,
} from './contracts';

const WORKER_TIMEOUT_MS = 20_000;
const MAX_WORKER_RESPONSE_BYTES = 64 * 1024;
const STORAGE_KEY = 'elara.clickup.authorization.v1';
const PENDING_CONNECTION_KEY = 'elara.clickup.connection.pending.v1';
const CONNECTION_GENERATION_KEY = 'elara.clickup.connection.generation.v1';
export const CLICKUP_CONNECTION_SETTLE_MS = (WORKER_TIMEOUT_MS * 2) + 5_000;

type StoredClickUpStatus = {
  readonly authorityBinding: string;
  readonly generationId: string | null;
  readonly status: ClickUpOAuthStatus;
};

type ConnectionGeneration = {
  readonly authorityBinding: string;
  readonly generationId: string;
};

type PendingConnectionChange = {
  readonly authorityBinding: string;
  readonly operationId: string;
  readonly operation: 'oauth-exchange' | 'personal-token' | 'disconnect';
  readonly until: number;
};

type PendingConnectionSnapshot = {
  readonly raw: string;
  readonly value: PendingConnectionChange;
};

export class ClickUpOAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

function clickUpConnectionNonce(browserIntentTimestamp: number): string {
  return `clickup-v1:${browserIntentTimestamp}:${newNonce()}`;
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

function samePairing(pairing: AutonomyPairing): boolean {
  const current = loadPairing();
  if (!current) return false;
  try {
    return clickUpPairingAuthorityBinding(current) === clickUpPairingAuthorityBinding(pairing);
  } catch {
    return false;
  }
}

function parseStoredStatus(raw: string | null): StoredClickUpStatus | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.authorityBinding !== 'string') return null;
    if (record.generationId !== undefined && record.generationId !== null && typeof record.generationId !== 'string') return null;
    const status = clickUpOAuthStatusSchema.safeParse(record.status);
    return status.success ? {
      authorityBinding: record.authorityBinding,
      generationId: typeof record.generationId === 'string' ? record.generationId : null,
      status: status.data,
    } : null;
  } catch {
    return null;
  }
}

function parseConnectionGeneration(raw: string | null): ConnectionGeneration | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.authorityBinding !== 'string' || typeof record.generationId !== 'string' || !record.generationId) return null;
    return { authorityBinding: record.authorityBinding, generationId: record.generationId };
  } catch {
    return null;
  }
}

function connectionGenerationForPairing(pairing: AutonomyPairing): string | null {
  if (typeof localStorage === 'undefined') return null;
  const generation = parseConnectionGeneration(localStorage.getItem(CONNECTION_GENERATION_KEY));
  return generation?.authorityBinding === clickUpPairingAuthorityBinding(pairing)
    ? generation.generationId
    : null;
}

function writeConnectionGeneration(pairing: AutonomyPairing, generationId: string): void {
  if (typeof localStorage === 'undefined' || !samePairing(pairing)) return;
  const generation: ConnectionGeneration = {
    authorityBinding: clickUpPairingAuthorityBinding(pairing),
    generationId,
  };
  localStorage.setItem(CONNECTION_GENERATION_KEY, JSON.stringify(generation));
}

function cachedStatusRawForPairing(pairing: AutonomyPairing): string | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  const stored = parseStoredStatus(raw);
  return stored?.authorityBinding === clickUpPairingAuthorityBinding(pairing) ? raw : null;
}

function clearCachedStatusForPairing(
  pairing: AutonomyPairing,
  expectedRaw?: string | null,
): void {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (expectedRaw !== undefined && raw !== expectedRaw) return;
  const stored = parseStoredStatus(raw);
  if (stored?.authorityBinding !== clickUpPairingAuthorityBinding(pairing)) return;
  if (localStorage.getItem(STORAGE_KEY) === raw) localStorage.removeItem(STORAGE_KEY);
}

function persistStatus(
  pairing: AutonomyPairing,
  status: ClickUpOAuthStatus,
  allowedPendingOperationId?: string,
  expectedGenerationId: string | null = connectionGenerationForPairing(pairing),
): void {
  if (typeof localStorage === 'undefined' || !samePairing(pairing)) return;
  if (connectionGenerationForPairing(pairing) !== expectedGenerationId) return;
  const pending = pendingConnectionSnapshotForPairing(pairing);
  if (pending && pending.value.operationId !== allowedPendingOperationId) return;
  if (!status.connected) {
    clearCachedStatusForPairing(pairing);
    return;
  }

  const current = parseStoredStatus(localStorage.getItem(STORAGE_KEY));
  const incomingRevision = status.updatedAt ?? 0;
  const currentRevision = current?.authorityBinding === clickUpPairingAuthorityBinding(pairing)
    ? current.status.updatedAt ?? 0
    : 0;
  if (currentRevision > incomingRevision) return;

  const stored: StoredClickUpStatus = {
    authorityBinding: clickUpPairingAuthorityBinding(pairing),
    generationId: expectedGenerationId,
    status,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function parsePendingConnection(raw: string | null): PendingConnectionChange | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const operation = record.operation;
    if (
      typeof record.authorityBinding !== 'string'
      || typeof record.operationId !== 'string'
      || !record.operationId
      || (
        operation !== 'oauth-exchange'
        && operation !== 'personal-token'
        && operation !== 'disconnect'
      )
      || typeof record.until !== 'number'
      || !Number.isFinite(record.until)
    ) return null;
    return {
      authorityBinding: record.authorityBinding,
      operationId: record.operationId,
      operation,
      until: record.until,
    };
  } catch {
    return null;
  }
}

function pendingConnectionSnapshotForPairing(pairing: AutonomyPairing): PendingConnectionSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(PENDING_CONNECTION_KEY);
  if (!raw) return null;
  const pending = parsePendingConnection(raw);
  if (!pending || pending.authorityBinding !== clickUpPairingAuthorityBinding(pairing)) return null;
  if (pending.until <= Date.now()) {
    if (localStorage.getItem(PENDING_CONNECTION_KEY) === raw) {
      localStorage.removeItem(PENDING_CONNECTION_KEY);
    }
    return null;
  }
  return { raw, value: pending };
}

function markConnectionPending(
  pairing: AutonomyPairing,
  operation: PendingConnectionChange['operation'],
): PendingConnectionChange {
  const pending: PendingConnectionChange = {
    authorityBinding: clickUpPairingAuthorityBinding(pairing),
    operationId: newNonce(),
    operation,
    until: Date.now() + CLICKUP_CONNECTION_SETTLE_MS,
  };
  if (typeof localStorage !== 'undefined' && samePairing(pairing)) {
    writeConnectionGeneration(pairing, pending.operationId);
    localStorage.setItem(PENDING_CONNECTION_KEY, JSON.stringify(pending));
    clearCachedStatusForPairing(pairing);
  }
  return pending;
}

function clearPendingConnectionForPairing(
  pairing: AutonomyPairing,
  expectedOperationId?: string,
): void {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(PENDING_CONNECTION_KEY);
  const pending = parsePendingConnection(raw);
  if (pending?.authorityBinding !== clickUpPairingAuthorityBinding(pairing)) return;
  if (expectedOperationId && pending.operationId !== expectedOperationId) return;
  if (localStorage.getItem(PENDING_CONNECTION_KEY) === raw) {
    localStorage.removeItem(PENDING_CONNECTION_KEY);
  }
}

function connectionPendingError(): ClickUpOAuthError {
  return new ClickUpOAuthError(
    'connection_pending',
    'A ClickUp connection change may still be settling. Refresh status again shortly.',
    409,
  );
}

async function bearerConnectionState(pairing: AutonomyPairing): Promise<ClickUpConnectionState | null> {
  const token = await workerToken(pairing);
  assertPairingStillCurrent(pairing);
  const response = await workerRequest(pairing, '/clickup/oauth/connection-state', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  assertPairingStillCurrent(pairing);
  // Older Workers predate durable operation-state reporting. The browser's
  // pairing-owned settle timer remains the compatibility fallback.
  if (response.status === 404) return null;
  if (response.status !== 200) throw workerError(response);
  return clickUpConnectionStateSchema.parse(response.body);
}

async function ensureConnectionSettled(
  pairing: AutonomyPairing,
): Promise<ClickUpConnectionState | null> {
  const localBefore = pendingConnectionSnapshotForPairing(pairing);
  if (!localBefore) return null;

  const workerState = await bearerConnectionState(pairing);
  if (workerState?.pending) {
    clearCachedStatusForPairing(pairing, cachedStatusRawForPairing(pairing));
    throw connectionPendingError();
  }

  const localAfter = pendingConnectionSnapshotForPairing(pairing);
  if (
    localAfter
    && localAfter.value.operationId !== localBefore.value.operationId
  ) {
    throw connectionPendingError();
  }

  if (workerState) {
    clearPendingConnectionForPairing(pairing, localBefore.value.operationId);
    return workerState;
  }

  throw connectionPendingError();
}

function ambiguousConnectionWriteFailure(cause: unknown): boolean {
  if (!(cause instanceof ClickUpOAuthError)) return true;
  if (
    cause.code === 'configuration'
    || cause.code === 'oauth_superseded'
    || cause.code === 'connection_superseded'
    || cause.code === 'grant_changed'
  ) return false;
  return cause.code === 'timeout'
    || cause.code === 'network'
    || cause.code === 'response_too_large'
    || cause.code === 'protocol'
    || cause.status >= 500;
}

export function loadStoredClickUpStatus(): ClickUpOAuthStatus | null {
  if (typeof localStorage === 'undefined') return null;
  const pairing = loadPairing();
  if (!pairing || pendingConnectionSnapshotForPairing(pairing)) return null;
  const stored = parseStoredStatus(localStorage.getItem(STORAGE_KEY));
  if (!stored) return null;
  if (stored.authorityBinding !== clickUpPairingAuthorityBinding(pairing)) return null;
  return stored.generationId === connectionGenerationForPairing(pairing) ? stored.status : null;
}

async function bearerStatus(pairing: AutonomyPairing): Promise<ClickUpOAuthStatus> {
  const cacheSnapshot = cachedStatusRawForPairing(pairing);
  const generationSnapshot = connectionGenerationForPairing(pairing);
  try {
    const localPending = pendingConnectionSnapshotForPairing(pairing);
    const stateBefore = localPending
      ? await ensureConnectionSettled(pairing)
      : await bearerConnectionState(pairing);
    if (stateBefore?.pending) throw connectionPendingError();

    const token = await workerToken(pairing);
    assertPairingStillCurrent(pairing);
    const response = await workerRequest(pairing, '/clickup/oauth/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assertPairingStillCurrent(pairing);
    if (response.status !== 200) throw workerError(response);
    const parsed = clickUpOAuthStatusSchema.parse(response.body);

    if (stateBefore) {
      const stateAfter = await bearerConnectionState(pairing);
      if (
        !stateAfter
        || stateAfter.pending
        || stateAfter.epoch !== stateBefore.epoch
        || stateAfter.settledEpoch !== stateBefore.settledEpoch
      ) {
        throw connectionPendingError();
      }
    }
    if (pendingConnectionSnapshotForPairing(pairing)) throw connectionPendingError();
    if (connectionGenerationForPairing(pairing) !== generationSnapshot) throw connectionPendingError();

    persistStatus(pairing, parsed, undefined, generationSnapshot);
    return parsed;
  } catch (cause) {
    // Remove only the cache snapshot that this read started with. A newer
    // same-pairing or replacement-pairing refresh must survive this failure.
    if (cacheSnapshot) clearCachedStatusForPairing(pairing, cacheSnapshot);
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
  browserIntentTimestamp: number,
): Promise<T> {
  const token = await workerToken(pairing);
  const body = JSON.stringify(payload);
  // The ordinary signed-write timestamp remains a freshness timestamp taken
  // immediately before egress. Gesture ordering travels inside the nonce,
  // which is itself covered by the HMAC, so a delayed older gesture cannot
  // masquerade as newer merely because it signs later.
  const timestamp = Date.now();
  const nonce = clickUpConnectionNonce(browserIntentTimestamp);
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

async function connectionWrite<T>(
  pairing: AutonomyPairing,
  operation: PendingConnectionChange['operation'],
  path: string,
  payload: unknown,
  parse: (value: unknown) => T,
  onSuccess?: (value: T, operationId: string) => void,
): Promise<T> {
  const browserIntentTimestamp = Date.now();
  await ensureConnectionSettled(pairing);
  // Mark before egress so every same-origin tab immediately stops advertising
  // the old identity while an account-changing request is in flight.
  const pending = markConnectionPending(pairing, operation);
  try {
    const result = await signedPost(pairing, path, payload, parse, browserIntentTimestamp);
    if (connectionGenerationForPairing(pairing) !== pending.operationId) {
      throw connectionPendingError();
    }
    onSuccess?.(result, pending.operationId);
    clearPendingConnectionForPairing(pairing, pending.operationId);
    return result;
  } catch (cause) {
    if (!ambiguousConnectionWriteFailure(cause)) {
      clearPendingConnectionForPairing(pairing, pending.operationId);
    }
    throw cause;
  }
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
    const pairing = activePairing();
    const browserIntentTimestamp = Date.now();
    await ensureConnectionSettled(pairing);
    return signedPost(
      pairing,
      '/clickup/oauth/start',
      { redirectUri },
      (value) => clickUpOAuthStartSchema.parse(value),
      browserIntentTimestamp,
    );
  },

  async completeConnect(input): Promise<ClickUpOAuthStatus> {
    const pairing = activePairing();
    return connectionWrite(
      pairing,
      'oauth-exchange',
      '/clickup/oauth/exchange',
      input,
      (value) => clickUpOAuthStatusSchema.parse(value),
      (status, operationId) => persistStatus(pairing, status, operationId, operationId),
    );
  },

  async connectPersonalToken(): Promise<ClickUpOAuthStatus> {
    const pairing = activePairing();
    return connectionWrite(
      pairing,
      'personal-token',
      '/clickup/oauth/personal-token',
      {},
      (value) => clickUpOAuthStatusSchema.parse(value),
      (status, operationId) => persistStatus(pairing, status, operationId),
    );
  },

  async disconnect(): Promise<void> {
    const pairing = activePairing();
    await connectionWrite(
      pairing,
      'disconnect',
      '/clickup/oauth/disconnect',
      {},
      (value) => {
        if (!value || typeof value !== 'object' || (value as Record<string, unknown>).disconnected !== true) {
          throw new ClickUpOAuthError('protocol', 'The Worker did not confirm ClickUp disconnect.', 0);
        }
        return true;
      },
      (_value, operationId) => {
        if (connectionGenerationForPairing(pairing) === operationId) clearCachedStatusForPairing(pairing);
      },
    );
  },
};
