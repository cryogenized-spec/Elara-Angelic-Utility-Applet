import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeminiApiKey,
  configureGeminiApiKeyWithPin,
  lockGeminiApiKey,
} from './gemini-api-key';

const TEST_KEY = 'test-gemini-key-material';
const PIN = '284619';
const DB_NAME = 'elara-gemini-lockbox';

beforeEach(async () => {
  await clearGeminiApiKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function readSecretRecord(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('secrets', 'readonly');
      const getRequest = transaction.objectStore('secrets').get('gemini-api-key');
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        resolve(getRequest.result);
        db.close();
      };
    };
  });
}

describe('Gemini API Lockbox storage boundary', () => {
  it('does not persist the plaintext Gemini API key in IndexedDB or web storage', async () => {
    await configureGeminiApiKeyWithPin(TEST_KEY, PIN);
    lockGeminiApiKey();

    const record = await readSecretRecord();
    const serializedRecord = JSON.stringify(record);
    expect(serializedRecord).not.toContain(TEST_KEY);
    expect(window.localStorage.getItem('elara.gemini.api-key')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain(TEST_KEY);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TEST_KEY);
  });
});
