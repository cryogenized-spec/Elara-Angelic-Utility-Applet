import { beforeEach, describe, expect, it } from 'vitest';
import {
  adoptConfigGeneration,
  bumpConfigGeneration,
  clearPairing,
  configGeneration,
  loadPairing,
  resolvePairingToken,
  savePairing,
  updatePairing,
  type AutonomyPairing,
} from './pairing';

const PAIRING: AutonomyPairing = {
  workerUrl: 'https://elara-gemini.example.workers.dev',
  token: 'client-credential-token',
  installationId: 'a'.repeat(32),
  workerVersion: '1.0.0-phase-b',
  schemaVersion: 1,
  pairedAt: 1_700_000_000_000,
  lastSyncedAt: null,
  lastSyncedContextHash: null,
  lastPulledRunsAt: 0,
  lastPulledRunsId: '',
  lastPulledEventsAt: 0,
  lastPulledEventsId: '',
};

beforeEach(() => {
  clearPairing();
  window.localStorage.clear();
});

describe('pairing store', () => {
  it('round-trips the runtime pairing without serializing the credential', () => {
    savePairing(PAIRING);

    const raw = window.localStorage.getItem('elara.autonomy.pairing.v1');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(PAIRING.token);
    expect((JSON.parse(raw ?? '{}') as { token?: unknown }).token).toBeUndefined();
    expect(loadPairing()).toEqual(PAIRING);

    clearPairing();
    expect(loadPairing()).toBeNull();
  });

  it('never crashes on corrupted storage (unpair stays safe)', () => {
    window.localStorage.setItem('elara.autonomy.pairing.v1', '{not json');
    expect(loadPairing()).toBeNull();
    expect(() => clearPairing()).not.toThrow();
  });

  it('updates persisted metadata without ever serializing the runtime credential', () => {
    expect(updatePairing({ workerVersion: 'missing' })).toBeNull();
    savePairing(PAIRING);

    const updated = updatePairing({
      workerVersion: '1.1.0',
      lastSyncedAt: 1_800_000_000_000,
      lastSyncedContextHash: 'context-hash',
    });

    expect(updated).toMatchObject({
      token: PAIRING.token,
      workerVersion: '1.1.0',
      lastSyncedAt: 1_800_000_000_000,
      lastSyncedContextHash: 'context-hash',
    });
    const raw = window.localStorage.getItem('elara.autonomy.pairing.v1') ?? '';
    expect(raw).not.toContain(PAIRING.token);
    expect((JSON.parse(raw) as { token?: unknown }).token).toBeUndefined();
  });

  it('treats an explicit empty-token patch as credential removal while keeping metadata', () => {
    savePairing(PAIRING);
    const updated = updatePairing({ token: '' });

    expect(updated?.token).toBe('');
    expect(loadPairing()).toMatchObject({
      token: '',
      workerUrl: PAIRING.workerUrl,
      installationId: PAIRING.installationId,
    });
    expect(window.localStorage.getItem('elara.autonomy.pairing.v1')).not.toContain(PAIRING.token);
  });

  it('prefers a direct runtime token only while shared pairing metadata still names that installation', async () => {
    const direct = { ...PAIRING, token: '  direct-runtime-token  ' };
    savePairing(direct);
    await expect(resolvePairingToken(direct)).resolves.toBe('direct-runtime-token');
    await expect(resolvePairingToken({ ...direct, token: '' })).resolves.toBe('direct-runtime-token');
  });

  it('refuses a stale sibling-tab pairing object after the shared installation is removed', async () => {
    savePairing(PAIRING);
    await expect(resolvePairingToken(PAIRING)).resolves.toBe(PAIRING.token);

    window.localStorage.removeItem('elara.autonomy.pairing.v1');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'elara.autonomy.pairing.v1',
      oldValue: JSON.stringify({ workerUrl: PAIRING.workerUrl, installationId: PAIRING.installationId }),
      newValue: null,
    }));

    await expect(resolvePairingToken(PAIRING)).resolves.toBe('');
  });

  it('rechecks shared pairing identity after awaiting the protected credential queue', async () => {
    savePairing(PAIRING);
    // Clear only the module-memory token while preserving pairing metadata and
    // the protected credential so resolvePairingToken must cross its async
    // credential boundary.
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'elara.autonomy.pairing.v1',
      oldValue: null,
      newValue: window.localStorage.getItem('elara.autonomy.pairing.v1'),
    }));

    const resolving = resolvePairingToken({ ...PAIRING, token: '' });
    window.localStorage.removeItem('elara.autonomy.pairing.v1');

    await expect(resolving).resolves.toBe('');
  });
});

describe('configuration generation (stale-config protection)', () => {
  it('bumps monotonically on every change', () => {
    expect(configGeneration()).toBe(0);
    expect(bumpConfigGeneration()).toBe(1);
    expect(bumpConfigGeneration()).toBe(2);
    expect(configGeneration()).toBe(2);
  });

  it('adopts a higher worker generation but never rolls back locally', () => {
    bumpConfigGeneration();
    bumpConfigGeneration();
    adoptConfigGeneration(9);
    expect(configGeneration()).toBe(9);
    adoptConfigGeneration(4); // a lower value never wins
    expect(configGeneration()).toBe(9);
  });
});
