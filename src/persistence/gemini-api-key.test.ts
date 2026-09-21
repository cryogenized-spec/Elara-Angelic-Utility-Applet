import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readLockboxFixtureRecord, writeLockboxFixtureRecord } from './lockbox-test-fixtures';
import {
  GEMINI_LOCKBOX_IDLE_TIMEOUT_MS,
  GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH,
  GEMINI_LOCKBOX_PIN_MAX_LENGTH,
  GEMINI_LOCKBOX_PIN_MIN_LENGTH,
  clearGeminiApiKey,
  configureGeminiApiKeyWithPin,
  disableGeminiLockboxSecurity,
  enableGeminiLockboxWithPin,
  enforceGeminiApiKeyIdleTimeout,
  getGeminiApiKey,
  getGeminiLockboxMetadata,
  getGeminiLockboxStatus,
  isGeminiApiKeyIdle,
  isGeminiLockboxPin,
  isStrongGeminiLockboxPin,
  lockGeminiApiKey,
  saveGeminiApiKey,
  touchGeminiApiKeyActivity,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';

const TEST_KEY = 'test-gemini-key-material';
const PASSWORD = 'correct-horse-battery-staple';
const PIN = '2846197531';
const NEW_PIN = '7315284062';
const LEGACY_STORAGE_KEY = 'elara.gemini.api-key';

beforeEach(async () => {
  await clearGeminiApiKey();
});

describe('encrypted Gemini API Lockbox', () => {
  it('starts empty and exposes no plaintext key', async () => {
    expect(await getGeminiLockboxStatus()).toBe('empty');
    expect(await getGeminiLockboxMetadata()).toBeNull();
    expect(await getGeminiApiKey()).toBe('');
  });

  it('migrates a legacy localStorage API key into the device-local encrypted Lockbox', async () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, TEST_KEY);

    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'off', authVersion: 1 });
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    lockGeminiApiKey();
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('encrypts a key, keeps it available only while unlocked, and restores it with the password', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'password', authVersion: 1 });

    lockGeminiApiKey();
    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(await getGeminiApiKey()).toBe('');
    await expect(unlockGeminiApiKey('wrong-password')).rejects.toThrow('Invalid Lockbox password.');
    await unlockGeminiApiKey(PASSWORD);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('revokes an unlocked plaintext session when a sibling tab broadcasts a Lockbox revocation', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    expect(await getGeminiLockboxStatus()).toBe('unlocked');

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'elara.gemini.lockbox.session-revocation.v1',
      newValue: 'remote-tab-revocation',
    }));

    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(await getGeminiApiKey()).toBe('');
  });

  it('validates PIN shape', () => {
    expect(isGeminiLockboxPin('12345')).toBe(false);
    expect(isGeminiLockboxPin('123456')).toBe(true);
    expect(isGeminiLockboxPin('12345678')).toBe(true);
    expect(isGeminiLockboxPin('123456789012')).toBe(true);
    expect(isGeminiLockboxPin('1234567890123')).toBe(false);
    expect(isStrongGeminiLockboxPin('12345678')).toBe(false);
    expect(isStrongGeminiLockboxPin('1234567890')).toBe(true);
    expect(isGeminiLockboxPin('12a456')).toBe(false);
    expect(GEMINI_LOCKBOX_PIN_MIN_LENGTH).toBe(6);
    expect(GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH).toBe(10);
    expect(GEMINI_LOCKBOX_PIN_MAX_LENGTH).toBe(12);
  });

  it('keeps a legacy 6-digit PIN record unlockable after the stronger creation policy', async () => {
    const legacyPin = '284619';
    await saveGeminiApiKey(TEST_KEY, legacyPin);
    const record = await readLockboxFixtureRecord('gemini-api-key');
    if (!record) throw new Error('expected seeded Lockbox record');
    await writeLockboxFixtureRecord({ ...record, security: { mode: 'pin' } });

    lockGeminiApiKey();
    await unlockGeminiApiKeyWithPin(legacyPin);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('rejects legacy-strength PINs for new or re-enabled protection', async () => {
    await expect(configureGeminiApiKeyWithPin(TEST_KEY, '123456')).rejects.toThrow('10–12 digit PIN');
    await expect(enableGeminiLockboxWithPin('123456')).rejects.toThrow('10–12 digit PIN');
  });

  it('creates and unlocks a fresh Lockbox with the PIN mode', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin', authVersion: 1, failedAttempts: 0, lockedUntil: null });
    lockGeminiApiKey();
    await expect(unlockGeminiApiKeyWithPin('111111')).rejects.toThrow('Invalid PIN');
    await unlockGeminiApiKeyWithPin(PIN);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('applies exponential local backoff after repeated wrong PIN attempts', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    await expect(unlockGeminiApiKeyWithPin('111111')).rejects.toThrow('Invalid PIN');
    await expect(unlockGeminiApiKeyWithPin('111111')).rejects.toThrow('Invalid PIN');
    await expect(unlockGeminiApiKeyWithPin('111111')).rejects.toThrow('Invalid PIN');
    await expect(unlockGeminiApiKeyWithPin('111111')).rejects.toThrow('Try again in');
    const metadata = await getGeminiLockboxMetadata();
    expect(metadata?.failedAttempts).toBe(4);
    expect((metadata?.lockedUntil ?? 0) > Date.now()).toBe(true);
    await expect(unlockGeminiApiKeyWithPin(PIN)).rejects.toThrow('Too many failed PIN attempts');
  });

  it('keeps password Lockboxes compatible when PIN auth is unavailable', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    lockGeminiApiKey();
    await expect(unlockGeminiApiKeyWithPin(PIN)).rejects.toThrow('password unlock');
    await unlockGeminiApiKey(PASSWORD);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('turns security off only from an unlocked session and re-enables with a new PIN', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    lockGeminiApiKey();
    await expect(disableGeminiLockboxSecurity()).rejects.toThrow('Unlock the Lockbox');

    await unlockGeminiApiKeyWithPin(PIN);
    await disableGeminiLockboxSecurity();
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'off', failedAttempts: 0, lockedUntil: null });
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);

    lockGeminiApiKey();
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);

    await enableGeminiLockboxWithPin(NEW_PIN);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin' });
    lockGeminiApiKey();
    await expect(unlockGeminiApiKeyWithPin(PIN)).rejects.toThrow('Invalid PIN');
    await unlockGeminiApiKeyWithPin(NEW_PIN);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('locks an unlocked key when the idle boundary is reached', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    const startedAt = 10_000;
    touchGeminiApiKeyActivity(startedAt);
    expect(isGeminiApiKeyIdle(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS - 1)).toBe(false);
    expect(isGeminiApiKeyIdle(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(enforceGeminiApiKeyIdleTimeout(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(await getGeminiLockboxStatus()).toBe('locked');
  });

  it('renews the idle boundary on meaningful activity', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    const firstActivity = 20_000;
    touchGeminiApiKeyActivity(firstActivity);
    const secondActivity = firstActivity + 60_000;
    touchGeminiApiKeyActivity(secondActivity);
    expect(isGeminiApiKeyIdle(secondActivity + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS - 1)).toBe(false);
    expect(enforceGeminiApiKeyIdleTimeout(secondActivity + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(await getGeminiLockboxStatus()).toBe('locked');
  });

  it('clears the encrypted record and session copy', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    await clearGeminiApiKey();
    expect(await getGeminiLockboxStatus()).toBe('empty');
    expect(await getGeminiApiKey()).toBe('');
  });
});
