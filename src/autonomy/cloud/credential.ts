import Dexie, { type Table } from 'dexie';

const DB_NAME = 'elara-autonomy-credentials';
const RECORD_ID = 'installation-token';
const IV_BYTES = 12;

interface AutonomyCredentialRecord {
  id: typeof RECORD_ID;
  version: 1;
  iv: string;
  ciphertext: string;
  key: CryptoKey;
  updatedAt: number;
}

class AutonomyCredentialDatabase extends Dexie {
  credentials!: Table<AutonomyCredentialRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ credentials: 'id, updatedAt' });
  }
}

const db = new AutonomyCredentialDatabase();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8_192, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * The autonomy installation token must survive reloads so scheduled cloud sync
 * can resume, but it must never be durable plaintext. It is therefore sealed
 * with a non-extractable device-local AES-GCM key. This is deliberately a
 * named, single-purpose credential boundary rather than a generic secret vault.
 */
export async function saveAutonomyInstallationToken(value: string): Promise<void> {
  const token = value.trim();
  if (!token) {
    await clearAutonomyInstallationToken();
    return;
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(token);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv) }, key, arrayBuffer(plaintext));

  await db.credentials.put({
    id: RECORD_ID,
    version: 1,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    key,
    updatedAt: Date.now(),
  });
}

export async function getAutonomyInstallationToken(): Promise<string> {
  const record = await db.credentials.get(RECORD_ID);
  if (!record) return '';
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: arrayBuffer(fromBase64(record.iv)) },
      record.key,
      arrayBuffer(fromBase64(record.ciphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return '';
  }
}

export async function clearAutonomyInstallationToken(): Promise<void> {
  await db.credentials.delete(RECORD_ID);
}
