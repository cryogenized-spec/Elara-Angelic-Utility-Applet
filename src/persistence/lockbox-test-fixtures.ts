/**
 * Test-only fixtures for Lockbox records that the public API no longer allows
 * anyone to create.
 *
 * The credential store verifies the authorization secret on every secondary
 * write and migrates records onto the authority's current protection during
 * unlock, so an unusable or stale secondary can now only arrive through legacy
 * or damaged storage. These helpers write exactly those shapes straight into
 * IndexedDB, so honest reporting and self-repair stay covered.
 *
 * The record identity is a fixed union rather than an arbitrary string, so this
 * does not reintroduce the runtime lookup by identifier that the Lockbox access
 * model forbids. Not imported by any application code.
 */

const DB_NAME = 'elara-gemini-lockbox';
const PBKDF2_ITERATIONS = 310_000;
const IV_BYTES = 12;

export type LockboxFixtureRecordId = 'gemini-api-key' | 'youtube-api-key';

export type LockboxFixtureRecord = {
  id: LockboxFixtureRecordId;
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  updatedAt: number;
  security: { mode: string };
  localKey?: CryptoKey;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function copy(source: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes.buffer;
}

function withStore<T>(mode: 'readonly' | 'readwrite', run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction('secrets', mode).objectStore('secrets'));
      request.onsuccess = () => {
        // Closing waits for the pending transaction to commit.
        db.close();
        resolve(request.result as T);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    };
  });
}

export function readLockboxFixtureRecord(id: LockboxFixtureRecordId): Promise<LockboxFixtureRecord | undefined> {
  return withStore<LockboxFixtureRecord | undefined>('readonly', (store) => store.get(id));
}

export function writeLockboxFixtureRecord(record: LockboxFixtureRecord): Promise<unknown> {
  return withStore<unknown>('readwrite', (store) => store.put(record));
}

/**
 * A secondary sealed under a credential the current one cannot open: the
 * legacy/damaged state the `mismatch` status exists to report.
 */
export function writeUnopenableSecondaryRecord(): Promise<unknown> {
  return writeLockboxFixtureRecord({
    id: 'youtube-api-key',
    version: 2,
    salt: toBase64(new Uint8Array(16)),
    iv: toBase64(new Uint8Array(IV_BYTES)),
    ciphertext: 'AA==',
    iterations: PBKDF2_ITERATIONS,
    updatedAt: Date.now(),
    security: { mode: 'password' },
  });
}

/**
 * The record shape a previous implementation could strand: sealed with a
 * device-local key and stamped `off` — which means readable with no credential
 * at all — while the Gemini authority is armed. Read paths must ignore the
 * stale stamp, and unlock must repair the record onto the credential.
 */
export async function writeOffModeSecondaryRecord(plaintext: string): Promise<void> {
  const localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: copy(iv) },
    localKey,
    copy(new TextEncoder().encode(plaintext)),
  );
  await writeLockboxFixtureRecord({
    id: 'youtube-api-key',
    version: 2,
    salt: '',
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: Date.now(),
    security: { mode: 'off' },
    localKey,
  });
}
