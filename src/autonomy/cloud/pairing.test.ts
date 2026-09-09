import { beforeEach, describe, expect, it } from 'vitest';
import { adoptConfigGeneration, bumpConfigGeneration, clearPairing, configGeneration, loadPairing, savePairing, type AutonomyPairing } from './pairing';

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
  lastPulledEventsAt: 0,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('pairing store', () => {
  it('round-trips the pairing (token stays client-side, local-only)', () => {
    savePairing(PAIRING);
    expect(loadPairing()).toEqual(PAIRING);
    clearPairing();
    expect(loadPairing()).toBeNull();
  });

  it('never crashes on corrupted storage (unpair stays safe)', () => {
    window.localStorage.setItem('elara.autonomy.pairing.v1', '{not json');
    expect(loadPairing()).toBeNull();
    expect(() => clearPairing()).not.toThrow();
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
