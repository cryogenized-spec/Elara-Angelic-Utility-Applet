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
import { readLockboxFixtureRecord, writeLockboxFixtureRecord } from './lockbox-test-fixtures';

const TEST_KEY = 'adversarial-primary-lockbox-key';
const PASSWORD = 'correct-horse-battery-staple';

beforeEach(async () => {
  await clearGeminiApiKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('primary Lockbox corruption adversarial boundary', () => {
  it('fails closed when the primary ciphertext is corrupted at rest', async () => {
    await saveGeminiApiKey(TEST_KEY, PASSWORD);
    lockGeminiApiKey();

    const record = await readLockboxFixtureRecord('gemini-api-key');
    expect(record).toBeDefined();
    await writeLockboxFixtureRecord({ ...record!, ciphertext: 'AA==' });

    await expect(unlockGeminiApiKey(PASSWORD)).rejects.toBeDefined();
    expect(await getGeminiApiKey()).toBe('');
    expect(await getGeminiLockboxStatus()).toBe('locked');
    expect(JSON.stringify(window.localStorage)).not.toContain(TEST_KEY);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TEST_KEY);
  });
});
