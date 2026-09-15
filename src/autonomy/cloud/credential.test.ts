import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAutonomyInstallationToken,
  getAutonomyInstallationToken,
  saveAutonomyInstallationToken,
} from './credential';

const DB_NAME = 'elara-autonomy-credentials';
const RECORD_ID = 'installation-token';
const TEST_TOKEN = 'autonomy-installation-token-secret-material';

beforeEach(async () => {
  await clearAutonomyInstallationToken();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function readCredentialRecord(): Promise<{
  ciphertext?: string;
  iv?: string;
  key?: CryptoKey;
} | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error ?? new DOMException('IndexedDB open failed.', 'Error'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('credentials', 'readonly');
      const getRequest = transaction.objectStore('credentials').get(RECORD_ID);
      getRequest.onerror = () => reject(getRequest.error ?? new DOMException('IndexedDB request failed.', 'Error'));
      getRequest.onsuccess = () => {
        resolve(getRequest.result as { ciphertext?: string; iv?: string; key?: CryptoKey } | undefined);
        db.close();
      };
    };
  });
}

describe('autonomy installation credential boundary', () => {
  it('persists only sealed material and recovers the token through the named accessor', async () => {
    await saveAutonomyInstallationToken(TEST_TOKEN);

    const record = await readCredentialRecord();
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain(TEST_TOKEN);
    expect(record?.ciphertext).toBeTruthy();
    expect(record?.iv).toBeTruthy();
    expect(record?.key?.extractable).toBe(false);
    expect(window.localStorage.getItem('elara.autonomy.pairing.v1')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TEST_TOKEN);

    expect(await getAutonomyInstallationToken()).toBe(TEST_TOKEN);
  });

  it('removes the sealed credential completely when cleared', async () => {
    await saveAutonomyInstallationToken(TEST_TOKEN);
    await clearAutonomyInstallationToken();

    expect(await getAutonomyInstallationToken()).toBe('');
    expect(await readCredentialRecord()).toBeUndefined();
  });
});
