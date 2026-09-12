/**
 * The Lockbox's generalized-credential invariants, enforced at the persistence
 * boundary rather than by the Settings UI.
 *
 * These cover the gaps found while auditing the multi-credential Lockbox: a
 * secondary write accepted any string as its authorization secret; re-arming
 * security could leave a secondary permanently readable with no credential; and
 * a secondary could be created with no security authority behind it.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeminiApiKey,
  clearYouTubeApiKey,
  configureGeminiApiKeyWithPin,
  disableGeminiLockboxSecurity,
  enableGeminiLockboxWithPin,
  getGeminiApiKey,
  getGeminiLockboxStatus,
  getYouTubeApiKey,
  getYouTubeLockboxStatus,
  lockGeminiApiKey,
  saveGeminiApiKey,
  saveYouTubeApiKey,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';
import { readLockboxFixtureRecord, writeOffModeSecondaryRecord, writeUnopenableSecondaryRecord } from './lockbox-test-fixtures';

const GEMINI_KEY = 'authority-probe-gemini-key';
const YOUTUBE_KEY = 'AIzaSy-authority-probe-youtube';
const PASSWORD = 'correct-horse-battery-staple';
const WRONG_PASSWORD = 'a-completely-different-passphrase';
const PIN = '284619';
const REARM_PIN = '731528';

beforeEach(async () => {
  await clearGeminiApiKey();
  await clearYouTubeApiKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Lockbox secondary credential authority', () => {
  it('refuses a secondary write whose credential does not match the Lockbox', async () => {
    // The store, not the UI, makes a mismatched authorization secret impossible:
    // encrypting a secondary under an arbitrary string produces a record
    // nothing can ever open again.
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);

    await expect(saveYouTubeApiKey(YOUTUBE_KEY, WRONG_PASSWORD)).rejects.toThrow(/does not match/i);

    expect(await getYouTubeLockboxStatus()).toBe('empty');
    expect(await readLockboxFixtureRecord('youtube-api-key')).toBeUndefined();
  });

  it('refuses a secondary write from a locked session', async () => {
    // Verifying a credential is a guessing oracle; a locked session has no
    // legitimate reason to be writing credentials.
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    lockGeminiApiKey();

    await expect(saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD)).rejects.toThrow(/unlock/i);
    expect(await readLockboxFixtureRecord('youtube-api-key')).toBeUndefined();
  });

  it('refuses a secondary credential with no security authority behind it', async () => {
    // A secondary inherits its protection from the Gemini record. With no
    // primary there is nothing to inherit, and the record would report itself
    // usable while being impossible to re-arm or decrypt.
    await expect(saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD)).rejects.toThrow(/Lockbox/i);
    expect(await readLockboxFixtureRecord('youtube-api-key')).toBeUndefined();
    expect(await getYouTubeLockboxStatus()).toBe('empty');
  });

  it('accepts the matching credential and keeps the key locked when the session is', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    lockGeminiApiKey();

    expect(await getYouTubeApiKey()).toBe('');
    expect(await getYouTubeLockboxStatus()).toBe('locked');

    await unlockGeminiApiKey(PASSWORD);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
  });

  it('re-seals every secondary under the PIN when security is re-armed', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await disableGeminiLockboxSecurity();
    lockGeminiApiKey();
    await enableGeminiLockboxWithPin(REARM_PIN);
    lockGeminiApiKey();

    // The whole point: turning security back on must not leave a secondary
    // readable with no credential.
    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(await getGeminiApiKey()).toBe('');
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getYouTubeLockboxStatus()).not.toBe('unlocked');

    expect((await readLockboxFixtureRecord('youtube-api-key'))?.security.mode).toBe('pin');
    expect((await readLockboxFixtureRecord('youtube-api-key'))?.localKey).toBeUndefined();

    await unlockGeminiApiKeyWithPin(REARM_PIN);
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
  });

  it('ignores a stale device-local stamp while locked and repairs it on unlock', async () => {
    await configureGeminiApiKeyWithPin(GEMINI_KEY, PIN);
    lockGeminiApiKey();
    await writeOffModeSecondaryRecord(YOUTUBE_KEY);

    // A stale `off` stamp is not permission: the authority governs access.
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getYouTubeLockboxStatus()).not.toBe('unlocked');

    // Unlocking repairs the record onto the authority's protection.
    await unlockGeminiApiKeyWithPin(PIN);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect((await readLockboxFixtureRecord('youtube-api-key'))?.security.mode).toBe('pin');
    expect((await readLockboxFixtureRecord('youtube-api-key'))?.localKey).toBeUndefined();

    lockGeminiApiKey();
    expect(await getYouTubeApiKey()).toBe('');
  });

  it('surfaces an unopenable secondary without blocking the primary credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    lockGeminiApiKey();
    await writeUnopenableSecondaryRecord();

    await unlockGeminiApiKey(PASSWORD);

    // The primary stays usable; the secondary is honestly reported as unusable
    // rather than silently returning an empty key.
    expect(await getGeminiApiKey()).toBe(GEMINI_KEY);
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getYouTubeLockboxStatus()).toBe('mismatch');

    // And the documented remediation works: re-save under the current credential.
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
  });

  it('carries secondaries across a primary credential replacement', async () => {
    // Rotating the authority's credential is also a re-seal for every
    // secondary; skipping it would strand them against the old passphrase.
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    const rotated = 'a-replacement-passphrase';
    lockGeminiApiKey();
    await unlockGeminiApiKey(PASSWORD);
    await saveGeminiApiKey('replaced-gemini-key', rotated);
    lockGeminiApiKey();

    await unlockGeminiApiKey(rotated);
    expect(await getYouTubeApiKey()).toBe(YOUTUBE_KEY);
    expect(await getYouTubeLockboxStatus()).toBe('unlocked');
  });

  it('clearing the Lockbox removes every credential and leaves no orphan', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);

    await clearGeminiApiKey();

    expect(await readLockboxFixtureRecord('youtube-api-key')).toBeUndefined();
    expect(await readLockboxFixtureRecord('gemini-api-key')).toBeUndefined();
    expect(await getYouTubeApiKey()).toBe('');
    expect(await getGeminiApiKey()).toBe('');
  });

  it('never persists plaintext for either credential, in any mode', async () => {
    for (const arm of ['password', 'pin', 'off'] as const) {
      await clearGeminiApiKey();
      if (arm === 'password') {
        await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
        await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
      } else if (arm === 'pin') {
        await configureGeminiApiKeyWithPin(GEMINI_KEY, PIN);
        await saveYouTubeApiKey(YOUTUBE_KEY, PIN);
      } else {
        await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
        await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
        await disableGeminiLockboxSecurity();
      }
      lockGeminiApiKey();

      const serialized = JSON.stringify([await readLockboxFixtureRecord('gemini-api-key'), await readLockboxFixtureRecord('youtube-api-key')]);
      expect(serialized, arm).not.toContain(YOUTUBE_KEY);
      expect(serialized, arm).not.toContain(GEMINI_KEY);
      expect(JSON.stringify(window.localStorage), arm).not.toContain(YOUTUBE_KEY);
      expect(JSON.stringify(window.sessionStorage), arm).not.toContain(YOUTUBE_KEY);
    }
  });
});
