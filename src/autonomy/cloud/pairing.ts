import {
  clearAutonomyInstallationToken,
  getAutonomyInstallationToken,
  saveAutonomyInstallationToken,
} from './credential';

// ---------------------------------------------------------------------------
// App-side pairing state (design §10.2). The installation token is a CLIENT
// CREDENTIAL by design — scoped to the user's own worker deployment, set as
// that worker's ELARA_INSTALLATION_TOKEN secret. Pairing metadata remains in
// localStorage, but the token itself is sealed separately with a non-extractable
// device-local key and is never serialized into the pairing JSON.
// ---------------------------------------------------------------------------

const PAIRING_KEY = 'elara.autonomy.pairing.v1';
const GENERATION_KEY = 'elara.autonomy.configGeneration.v1';

export interface AutonomyPairing {
  /** Worker base URL, e.g. https://elara-gemini.<account>.workers.dev */
  workerUrl: string;
  /** Runtime-only installation token. It is never durable in pairing JSON. */
  token: string;
  installationId: string;
  workerVersion: string;
  schemaVersion: number;
  pairedAt: number;
  /** Diagnostics from the last successful sync (display-only). */
  lastSyncedAt: number | null;
  lastSyncedContextHash: string | null;
  /** High-water mark for pulled cloud run records. */
  lastPulledRunsAt: number;
  lastPulledRunsId: string;
  lastPulledEventsAt: number;
  lastPulledEventsId: string;
}

type StoredAutonomyPairing = Omit<AutonomyPairing, 'token'>;

let sessionToken = '';
let credentialQueue: Promise<void> = Promise.resolve();

function queueCredentialWrite(task: () => Promise<void>): void {
  credentialQueue = credentialQueue.catch(() => undefined).then(task);
  void credentialQueue.catch(() => undefined);
}

function persistToken(token: string): void {
  const value = token.trim();
  sessionToken = value;
  if (value) queueCredentialWrite(() => saveAutonomyInstallationToken(value));
  else queueCredentialWrite(() => clearAutonomyInstallationToken());
}

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-browsing storage failures must not crash autonomy UI.
  }
}

function storedPairing(pairing: AutonomyPairing): StoredAutonomyPairing {
  return {
    workerUrl: pairing.workerUrl,
    installationId: pairing.installationId,
    workerVersion: pairing.workerVersion,
    schemaVersion: pairing.schemaVersion,
    pairedAt: pairing.pairedAt,
    lastSyncedAt: pairing.lastSyncedAt,
    lastSyncedContextHash: pairing.lastSyncedContextHash,
    lastPulledRunsAt: pairing.lastPulledRunsAt,
    lastPulledRunsId: pairing.lastPulledRunsId,
    lastPulledEventsAt: pairing.lastPulledEventsAt,
    lastPulledEventsId: pairing.lastPulledEventsId,
  };
}

function migrateLegacyToken(value: Record<string, unknown>, legacyToken: string): void {
  sessionToken = legacyToken;
  queueCredentialWrite(async () => {
    // Do not destroy the legacy plaintext until the protected write actually
    // succeeds. A storage/crypto failure must leave a recoverable pairing.
    await saveAutonomyInstallationToken(legacyToken);
    const current = readJson(PAIRING_KEY);
    if (!current || current.token !== legacyToken) return;
    const { token: _legacyToken, ...metadata } = current;
    void _legacyToken;
    writeJson(PAIRING_KEY, metadata);
  });
}

export function loadPairing(): AutonomyPairing | null {
  const value = readJson(PAIRING_KEY);
  if (!value || typeof value.workerUrl !== 'string' || typeof value.installationId !== 'string') return null;

  // One-time migration from the pre-hardening format. The legacy token remains
  // available for this session and is removed from localStorage only after the
  // protected credential write succeeds.
  const legacyToken = typeof value.token === 'string' ? value.token.trim() : '';
  if (legacyToken) migrateLegacyToken(value, legacyToken);

  return {
    workerUrl: value.workerUrl,
    token: sessionToken,
    installationId: value.installationId,
    workerVersion: typeof value.workerVersion === 'string' ? value.workerVersion : '',
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 0,
    pairedAt: typeof value.pairedAt === 'number' ? value.pairedAt : Date.now(),
    lastSyncedAt: typeof value.lastSyncedAt === 'number' ? value.lastSyncedAt : null,
    lastSyncedContextHash: typeof value.lastSyncedContextHash === 'string' ? value.lastSyncedContextHash : null,
    lastPulledRunsAt: typeof value.lastPulledRunsAt === 'number' ? value.lastPulledRunsAt : 0,
    lastPulledRunsId: typeof value.lastPulledRunsId === 'string' ? value.lastPulledRunsId : '',
    lastPulledEventsAt: typeof value.lastPulledEventsAt === 'number' ? value.lastPulledEventsAt : 0,
    lastPulledEventsId: typeof value.lastPulledEventsId === 'string' ? value.lastPulledEventsId : '',
  };
}

/** Resolve the runtime credential without ever putting it back into pairing JSON. */
export async function resolvePairingToken(pairing: AutonomyPairing): Promise<string> {
  // A stale object retained by another React tree/tab is never credential
  // authority. The shared pairing metadata must still identify the same
  // installation before any memory- or IndexedDB-held token may be returned.
  const current = loadPairing();
  if (!current || current.installationId !== pairing.installationId || current.workerUrl !== pairing.workerUrl) {
    sessionToken = '';
    return '';
  }

  const direct = pairing.token.trim();
  if (direct) {
    sessionToken = direct;
    return direct;
  }
  if (sessionToken) return sessionToken;
  await credentialQueue.catch(() => undefined);
  // Recheck after the async credential boundary so an unpair racing the read
  // cannot resurrect an installation token from protected storage.
  const stillCurrent = loadPairing();
  if (!stillCurrent || stillCurrent.installationId !== pairing.installationId || stillCurrent.workerUrl !== pairing.workerUrl) {
    sessionToken = '';
    return '';
  }
  const recoveredToken = (await getAutonomyInstallationToken()).trim();
  // The protected read above is itself asynchronous. Pairing can be removed or
  // replaced while IndexedDB/decryption is in flight, so validate authority
  // again before repopulating the module-memory credential.
  const afterCredentialRead = loadPairing();
  if (!afterCredentialRead
    || afterCredentialRead.installationId !== pairing.installationId
    || afterCredentialRead.workerUrl !== pairing.workerUrl) {
    sessionToken = '';
    return '';
  }
  sessionToken = recoveredToken;
  return sessionToken;
}

export function savePairing(pairing: AutonomyPairing): void {
  if (pairing.token.trim()) persistToken(pairing.token);
  writeJson(PAIRING_KEY, storedPairing(pairing));
}

export function clearPairing(): void {
  sessionToken = '';
  queueCredentialWrite(() => clearAutonomyInstallationToken());
  try {
    window.localStorage.removeItem(PAIRING_KEY);
  } catch {
    // ignore
  }
}

function installPairingCrossTabInvalidation(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (event) => {
    if (event.key === PAIRING_KEY) sessionToken = '';
  });
}

installPairingCrossTabInvalidation();

export function updatePairing(patch: Partial<AutonomyPairing>): AutonomyPairing | null {
  const current = loadPairing();
  if (!current) return null;
  const next = { ...current, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'token')) persistToken(next.token);
  writeJson(PAIRING_KEY, storedPairing(next));
  return next;
}

// ---------------------------------------------------------------------------
// App-side configuration generation (design §10.2 / Phase B §19): every
// meaningful autonomy configuration change advances a monotonic counter. The
// worker rejects a sync whose generation is OLDER than its stored one, so a
// delayed or out-of-order delivery can never overwrite newer configuration
// (no naive last-write-wins by network arrival).
// ---------------------------------------------------------------------------

export function configGeneration(): number {
  const value = readJson(GENERATION_KEY);
  return typeof value?.generation === 'number' ? value.generation : 0;
}

/** Advance the local generation (call at every autonomy configuration change). */
export function bumpConfigGeneration(): number {
  const next = configGeneration() + 1;
  writeJson(GENERATION_KEY, { generation: next });
  return next;
}

/**
 * Adopt a generation from the worker (after pairing or a stale rejection) so
 * the next local change syncs above it. The PAYLOAD is not re-sent blindly:
 * adopting only the counter keeps stale rejection honest.
 */
export function adoptConfigGeneration(generation: number): void {
  if (generation > configGeneration()) writeJson(GENERATION_KEY, { generation });
}
