import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GEMINI_LOCKBOX_IDLE_TIMEOUT_MS,
  GEMINI_LOCKBOX_PIN_MAX_LENGTH,
  GEMINI_LOCKBOX_PIN_MIN_LENGTH,
  clearGeminiApiKey,
  configureGeminiApiKeyWithPin,
  enforceGeminiApiKeyIdleTimeout,
  getGeminiApiKey,
  getGeminiLockboxMetadata,
  getGeminiLockboxStatus,
  isGeminiApiKeyIdle,
  isGeminiLockboxPin,
  lockGeminiApiKey,
  saveGeminiApiKey,
  touchGeminiApiKeyActivity,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';

const TEST_KEY = 'AIzaSyDUMMY_TEST_KEY_123456789';
const PASSWORD = 'correct-horse-battery-staple';
const PIN = '284619';

beforeEach(async () => {
  await clearGeminiApiKey();
});

describe('encrypted Gemini API Lockbox', () => {
  it('starts empty and exposes no plaintext key', async () => {
    expect(await getGeminiLockboxStatus()).toBe('empty');
    expect(await getGeminiLockboxMetadata()).toBeNull();
    expect(await getGeminiApiKey()).toBe('');
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
    expect(await getGeminiLockboxStatus()).toBe('locked');

    await unlockGeminiApiKey(PASSWORD);
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('validates PIN shape', () => {
    expect(isGeminiLockboxPin('12345')).toBe(false);
    expect(isGeminiLockboxPin('123456')).toBe(true);
    expect(isGeminiLockboxPin('12345678')).toBe(true);
    expect(isGeminiLockboxPin('123456789')).toBe(false);
    expect(isGeminiLockboxPin('12a456')).toBe(false);
    expect(GEMINI_LOCKBOX_PIN_MIN_LENGTH).toBe(6);
    expect(GEMINI_LOCKBOX_PIN_MAX_LENGTH).toBe(8);
  });

  it('creates and unlocks a fresh Lockbox with the PIN mode', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);

    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin', authVersion: 1, failedAttempts: 0, lockedUntil: null });
    expect(await getGeminiApiKey()).toBe(TEST_KEY);

    lockGeminiApiKey();
    await expect(unlockGeminiApiKeyWithPin('wrong1')).rejects.toThrow('Invalid PIN');
    expect(await getGeminiApiKey()).toBe('');

    await unlockGeminiApiKeyWithPin(PIN);
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
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

  it('locks an unlocked key when the idle boundary is reached', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    const startedAt = 10_000;
    touchGeminiApiKeyActivity(startedAt);

    expect(isGeminiApiKeyIdle(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS - 1)).toBe(false);
    expect(isGeminiApiKeyIdle(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(enforceGeminiApiKeyIdleTimeout(startedAt + GEMINI_LOCKBOX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(await getGeminiApiKey()).toBe('');
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
