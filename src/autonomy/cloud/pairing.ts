// ---------------------------------------------------------------------------
// App-side pairing state (design §10.2). The installation token is a CLIENT
// CREDENTIAL by design — scoped to the user's own worker deployment, set as
// that worker's ELARA_INSTALLATION_TOKEN secret — so it is stored with the
// same care as other client-held credentials: local-only, never in routine
// config, never in URLs or logs. Everything here is disposable: clearing it
// unpairs the app without touching local routine data (local-first).
// ---------------------------------------------------------------------------

const PAIRING_KEY = 'elara.autonomy.pairing.v1';
const GENERATION_KEY = 'elara.autonomy.configGeneration.v1';

export interface AutonomyPairing {
  /** Worker base URL, e.g. https://elara-gemini.<account>.workers.dev */
  workerUrl: string;
  /** The installation token (client credential for the user's own worker). */
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

export function loadPairing(): AutonomyPairing | null {
  const value = readJson(PAIRING_KEY);
  if (!value || typeof value.workerUrl !== 'string' || typeof value.token !== 'string' || typeof value.installationId !== 'string') return null;
  return {
    workerUrl: value.workerUrl,
    token: value.token,
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

export function savePairing(pairing: AutonomyPairing): void {
  writeJson(PAIRING_KEY, { ...pairing });
}

export function clearPairing(): void {
  try {
    window.localStorage.removeItem(PAIRING_KEY);
  } catch {
    // ignore
  }
}

export function updatePairing(patch: Partial<AutonomyPairing>): AutonomyPairing | null {
  const current = loadPairing();
  if (!current) return null;
  const next = { ...current, ...patch };
  savePairing(next);
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
