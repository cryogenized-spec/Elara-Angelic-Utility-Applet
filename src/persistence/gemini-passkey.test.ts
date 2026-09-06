import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGeminiApiKey, configureGeminiApiKeyWithPin, getGeminiLockboxMetadata, lockGeminiApiKey } from './gemini-api-key';
import {
  hasGeminiPasskey,
  isGeminiPasskeySupported,
  isGeminiPlatformAuthenticatorAvailable,
  removeGeminiPasskey,
} from './gemini-passkey';

const TEST_KEY = 'test-gemini-key-only';
const PIN = '284619';

beforeEach(async () => {
  await clearGeminiApiKey();
  await removeGeminiPasskey();
});

describe('Gemini passkey Lockbox support', () => {
  it('reports unsupported passkeys in a non-WebAuthn test environment', async () => {
    expect(isGeminiPasskeySupported()).toBe(false);
    expect(await isGeminiPlatformAuthenticatorAvailable()).toBe(false);
    expect(await hasGeminiPasskey()).toBe(false);
  });

  it('keeps PIN mode usable before a passkey is configured', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    lockGeminiApiKey();
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin' });
    expect(await hasGeminiPasskey()).toBe(false);
  });

  it('removes passkey metadata without disturbing an existing Lockbox', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    await removeGeminiPasskey();
    expect(await getGeminiLockboxMetadata()).toMatchObject({ mode: 'pin' });
  });
});
