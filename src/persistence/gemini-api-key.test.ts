import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GEMINI_LOCKBOX_IDLE_TIMEOUT_MS,
  clearGeminiApiKey,
  enforceGeminiApiKeyIdleTimeout,
  getGeminiApiKey,
  getGeminiLockboxMetadata,
  getGeminiLockboxStatus,
  isGeminiApiKeyIdle,
  lockGeminiApiKey,
  saveGeminiApiKey,
  touchGeminiApiKeyActivity,
  unlockGeminiApiKey,
} from './gemini-api-key';

const TEST_KEY = 'AIzaSyDUMMY_TEST_KEY_123456789';
const PASSWORD = 'correct-horse-battery-staple';

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
