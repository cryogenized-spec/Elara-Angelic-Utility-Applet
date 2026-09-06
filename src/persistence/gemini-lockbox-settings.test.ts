import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeminiApiKey,
  configureGeminiApiKeyWithPin,
  getGeminiApiKey,
  lockGeminiApiKey,
  getGeminiLockboxMetadata,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';
import { changeGeminiLockboxPin, switchGeminiLockboxToPin } from './gemini-lockbox-settings';

const TEST_KEY = 'test-gemini-key-material';
const PIN = '284619';
const NEW_PIN = '731528';

beforeEach(async () => {
  await clearGeminiApiKey();
});

describe('Gemini Lockbox PIN management', () => {
  it('changes the PIN and invalidates the old PIN', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    await changeGeminiLockboxPin(PIN, NEW_PIN);

    lockGeminiApiKey();
    await expect(unlockGeminiApiKeyWithPin(PIN)).rejects.toThrow('Invalid PIN');
    await unlockGeminiApiKeyWithPin(NEW_PIN);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin', failedAttempts: 0, lockedUntil: null });
  });

  it('rejects a PIN change that reuses the current PIN', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    await expect(changeGeminiLockboxPin(PIN, PIN)).rejects.toThrow('different Lockbox PIN');
  });

  it('switches a passkey-mode Lockbox back to PIN without changing the PIN', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    // Simulate the persisted passkey mode produced after successful passkey registration.
    const { setGeminiLockboxSecurityMode } = await import('./gemini-api-key');
    await setGeminiLockboxSecurityMode('passkey');

    await switchGeminiLockboxToPin(PIN);
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin' });
    lockGeminiApiKey();
    await unlockGeminiApiKeyWithPin(PIN);
    expect(await getGeminiApiKey()).toBe(TEST_KEY);
  });
});
