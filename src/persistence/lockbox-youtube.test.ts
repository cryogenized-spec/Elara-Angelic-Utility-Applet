import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeminiApiKey,
  clearYouTubeApiKey,
  configureGeminiApiKeyWithPin,
  disableGeminiLockboxSecurity,
  getGeminiApiKey,
  getYouTubeApiKey,
  getYouTubeLockboxStatus,
  lockGeminiApiKey,
  saveGeminiApiKey,
  saveYouTubeApiKey,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';
import { changeGeminiLockboxPin } from './gemini-lockbox-settings';

const GEMINI_KEY = 'test-gemini-key-material';
const YOUTUBE_KEY = 'AIzaSy-test-youtube-data-api-key';
const PASSWORD = 'correct-horse-battery-staple';
const OTHER_PASSWORD = 'a-completely-different-passphrase';
const PIN = '284619';
const NEW_PIN = '731528';
const DB_NAME = 'elara-gemini-lockbox';

beforeEach(async () => {
  await clearGeminiApiKey();
  await clearYouTubeApiKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function readRecord(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('secrets', 'readonly');
      const getRequest = transaction.objectStore('secrets').get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        resolve(getRequest.result);
        db.close();
      };
    };
  });
}

describe('YouTube credential in the shared Lockbox', () => {
  it('starts empty and reports an empty status', async () => {
    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await getYouTubeApiKey()).toBe('');
  });

  it('stores the YouTube key encrypted and returns it only while unlocked', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);

    lockGeminiApiKey();
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getYouTubeLockboxStatus()).toBe('locked');

    await unlockGeminiApiKey(PASSWORD);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
  });

  it('opens both credentials with one Lockbox unlock', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    lockGeminiApiKey();

    await unlockGeminiApiKey(PASSWORD);

    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
  });

  it('clears the YouTube credential without disturbing the Gemini credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await clearYouTubeApiKey();

    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await readRecord('gemini-api-key')).toBeTruthy();
    expect(await readRecord('youtube-api-key')).toBeUndefined();
  });

  it('removes the YouTube credential too when the whole Lockbox is cleared', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await clearGeminiApiKey();

    // An orphaned secondary record inherits its security mode from the primary,
    // so with the primary gone it would report 'unlocked' while being
    // undecryptable. Clearing the Lockbox must remove every credential.
    expect(await readRecord('youtube-api-key')).toBeUndefined();
    expect(await readRecord('gemini-api-key')).toBeUndefined();
    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await getYouTubeApiKey()).toBe('');
  });

  it('keeps the YouTube key usable across a PIN rotation', async () => {
    // Regression guard: rotating the Lockbox credential must re-encrypt every
    // stored secret. Re-encrypting only the Gemini key would leave the YouTube
    // record permanently unreadable under the new PIN.
    await configureGeminiApiKeyWithPin(GEMINI_KEY, PIN);
    await saveYouTubeApiKey(YOUTUBE_KEY, PIN);
    lockGeminiApiKey();

    await unlockGeminiApiKeyWithPin(PIN);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);

    await changeGeminiLockboxPin(PIN, NEW_PIN);
    lockGeminiApiKey();

    await unlockGeminiApiKeyWithPin(NEW_PIN);
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
  });

  it('refuses a secondary write sealed under a credential that is not the Lockbox', async () => {
    // The persistence boundary enforces this, not the Settings UI: accepting an
    // arbitrary string would let a mistyped credential silently produce a
    // record nothing can ever open again.
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);

    await expect(saveYouTubeApiKey(YOUTUBE_KEY, OTHER_PASSWORD)).rejects.toThrow(/does not match/i);
    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await readRecord('youtube-api-key')).toBeUndefined();
  });


  it('moves every credential to device-local protection when security is turned off', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await disableGeminiLockboxSecurity();
    lockGeminiApiKey();

    // Mode 'off' records decrypt with their device-local key, no credential.
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
  });

  it('never persists the plaintext YouTube key', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    lockGeminiApiKey();

    const record = await readRecord('youtube-api-key');
    expect(record).toBeTruthy();
    expect(JSON.stringify(record)).not.toContain(YOUTUBE_KEY);
    expect(JSON.stringify(window.localStorage)).not.toContain(YOUTUBE_KEY);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(YOUTUBE_KEY);
  });

  it('stores a YouTube key added while security is off so it stays readable', async () => {
    // Regression guard: a secondary record written under mode 'off' must use a
    // device-local key. Encrypting it with a passphrase while stamping it 'off'
    // would produce a record nothing can ever decrypt.
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await disableGeminiLockboxSecurity();
    lockGeminiApiKey();

    await saveYouTubeApiKey(YOUTUBE_KEY, '');
    lockGeminiApiKey();

    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
  });

  it('rejects an empty YouTube key by clearing the stored credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await saveYouTubeApiKey('   ', PASSWORD);

    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await readRecord('youtube-api-key')).toBeUndefined();
  });
});
