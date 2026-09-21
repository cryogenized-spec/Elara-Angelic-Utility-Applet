import { newNonce, signWrite } from '../../autonomy/protocol';
import { loadPairing, resolvePairingToken, type AutonomyPairing } from '../../autonomy/cloud/pairing';
import {
  clickUpOAuthStartSchema,
  clickUpOAuthStatusSchema,
  type ClickUpExecutionGrant,
  type ClickUpOAuthAuthority,
  type ClickUpOAuthStart,
  type ClickUpOAuthStatus,
} from './contracts';

const WORKER_TIMEOUT_MS = 20_000;
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

async function workerToken(pairing: AutonomyPairing): Promise<string> {
  const token = (await resolvePairingToken(pairing)).trim();
  if (!token) throw new ClickUpOAuthError('credential', 'The self-hosted Worker installation credential is unavailable. Pair this device again.', 0);
  return token;
}

async function workerRequest(pairing: AutonomyPairing, path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    return await fetch(`${normalizeWorkerBaseUrl(pairing.workerUrl)}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof ClickUpOAuthError) throw error;
    throw new ClickUpOAuthError('network', error instanceof Error ? error.message : 'The self-hosted Worker could not be reached.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function workerError(response: Response): Promise<ClickUpOAuthError> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  return new ClickUpOAuthError(
    body?.code ?? `http-${response.status}`,
    body?.message ?? `The self-hosted Worker responded with HTTP ${response.status}.`,
    response.status,
  );
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
  const token = await workerToken(pairing);
  const response = await workerRequest(pairing, '/clickup/oauth/status', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 200) throw await workerError(response);
  const parsed = clickUpOAuthStatusSchema.parse(await response.json());
  persistStatus(parsed);
  return parsed;
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
  if (response.status !== 200) throw await workerError(response);
  return parse(await response.json());
}

export const clickUpOAuthAuthority: ClickUpOAuthAuthority = {
  async getStatus(): Promise<ClickUpOAuthStatus> {
    return bearerStatus(activePairing());
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
