import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeminiApiKey,
  getGeminiApiKey,
  getGeminiLockboxStatus,
  lockGeminiApiKey,
  saveGeminiApiKey,
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
    expect(await getGeminiApiKey()).toBe('');
  });

  it('encrypts a key, keeps it available only while unlocked, and restores it with the password', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);

    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);

    lockGeminiApiKey();
    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(await getGeminiApiKey()).toBe('');

    await expect(unlockGeminiApiKey('wrong-password')).rejects.toThrow('Invalid Lockbox password.');
    expect(await getGeminiLockboxStatus()).toBe('locked');

    await unlockGeminiApiKey(PASSWORD);
    expect(await getGeminiLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });

  it('clears the encrypted record and session copy', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    await clearGeminiApiKey();

    expect(await getGeminiLockboxStatus()).toBe('empty');
    expect(await getGeminiApiKey()).toBe('');
  });
});
