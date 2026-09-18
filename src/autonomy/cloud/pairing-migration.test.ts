import { beforeEach, describe, expect, it, vi } from 'vitest';

const credential = vi.hoisted(() => ({
  save: vi.fn<(value: string) => Promise<void>>(),
  get: vi.fn<() => Promise<string>>(),
  clear: vi.fn<() => Promise<void>>(),
}));

vi.mock('./credential', () => ({
  saveAutonomyInstallationToken: credential.save,
  getAutonomyInstallationToken: credential.get,
  clearAutonomyInstallationToken: credential.clear,
}));

const PAIRING_KEY = 'elara.autonomy.pairing.v1';
const LEGACY_TOKEN = 'legacy-installation-credential';

function legacyPairing(): Record<string, unknown> {
  return {
    workerUrl: 'https://elara.example.workers.dev',
    token: LEGACY_TOKEN,
    installationId: 'a'.repeat(32),
    workerVersion: '1.0.0',
    schemaVersion: 1,
    pairedAt: 1_700_000_000_000,
    lastSyncedAt: null,
    lastSyncedContextHash: null,
    lastPulledRunsAt: 0,
    lastPulledRunsId: '',
    lastPulledEventsAt: 0,
    lastPulledEventsId: '',
  };
}

async function freshPairingModule() {
  vi.resetModules();
  return import('./pairing');
}

beforeEach(() => {
  window.localStorage.clear();
  credential.save.mockReset().mockResolvedValue(undefined);
  credential.get.mockReset().mockResolvedValue('');
  credential.clear.mockReset().mockResolvedValue(undefined);
});

describe('legacy autonomy credential migration', () => {
  it('removes plaintext pairing credential only after the protected write succeeds', async () => {
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(legacyPairing()));
    const pairing = await freshPairingModule();

    const loaded = pairing.loadPairing();
    expect(loaded?.token).toBe(LEGACY_TOKEN);

    await vi.waitFor(() => expect(credential.save).toHaveBeenCalledWith(LEGACY_TOKEN));
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(PAIRING_KEY) ?? '{}') as Record<string, unknown>;
      expect(stored.token).toBeUndefined();
      expect(stored.installationId).toBe('a'.repeat(32));
    });
  });

  it('preserves legacy plaintext when the protected credential write fails', async () => {
    credential.save.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(legacyPairing()));
    const pairing = await freshPairingModule();

    const loaded = pairing.loadPairing();
    expect(loaded?.token).toBe(LEGACY_TOKEN);

    await vi.waitFor(() => expect(credential.save).toHaveBeenCalledWith(LEGACY_TOKEN));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = JSON.parse(window.localStorage.getItem(PAIRING_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.token).toBe(LEGACY_TOKEN);
  });

  it('recovers a protected credential lazily after a reload-like metadata-only load', async () => {
    const metadata = legacyPairing();
    delete metadata.token;
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(metadata));
    credential.get.mockResolvedValueOnce('sealed-token-after-reload');
    const pairing = await freshPairingModule();

    const loaded = pairing.loadPairing();
    expect(loaded?.token).toBe('');
    expect(loaded).not.toBeNull();

    await expect(pairing.resolvePairingToken(loaded!)).resolves.toBe('sealed-token-after-reload');
    expect(credential.get).toHaveBeenCalledTimes(1);
  });
});
