import Dexie, { type Table } from 'dexie';

const DB_NAME = 'elara-gemini-lockbox';
const RECORD_ID = 'gemini-api-key';
const LEGACY_STORAGE_KEY = 'elara.gemini.api-key';
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_LENGTH = 256;

type EncryptedGeminiApiKey = {
  id: 'gemini-api-key';
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  updatedAt: number;
};

class LockboxDatabase extends Dexie {
  secrets!: Table<EncryptedGeminiApiKey, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ secrets: 'id, updatedAt' });
  }
}

const db = new LockboxDatabase();
let unlockedApiKey: string | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function textDecoder(): TextDecoder {
  return new TextDecoder();
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!passphrase) throw new Error('A Lockbox password is required.');
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptApiKey(apiKey: string, passphrase: string): Promise<EncryptedGeminiApiKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveEncryptionKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = textEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    id: RECORD_ID,
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: Date.now(),
  };
}

async function decryptApiKey(record: EncryptedGeminiApiKey, passphrase: string): Promise<string> {
  try {
    const salt = fromBase64(record.salt);
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);
    const key = await deriveEncryptionKey(passphrase, salt, record.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return textDecoder().decode(plaintext);
  } catch {
    throw new Error('Invalid Lockbox password.');
  }
}

function removeLegacyPlaintextKey(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore unavailable localStorage; the encrypted Lockbox remains authoritative.
  }
}

export type GeminiLockboxStatus = 'empty' | 'locked' | 'unlocked';

export async function getGeminiLockboxStatus(): Promise<GeminiLockboxStatus> {
  if (unlockedApiKey !== null) return unlockedApiKey ? 'unlocked' : 'empty';
  const record = await db.secrets.get(RECORD_ID);
  return record ? 'locked' : 'empty';
}

export async function getGeminiApiKey(): Promise<string> {
  return unlockedApiKey ?? '';
}

export async function saveGeminiApiKey(value: string, passphrase: string): Promise<void> {
  const apiKey = value.trim();
  if (!apiKey) {
    await clearGeminiApiKey();
    return;
  }
  const password = passphrase.trim();
  if (!password) throw new Error('A Lockbox password is required.');
  const encrypted = await encryptApiKey(apiKey, password);
  await db.secrets.put(encrypted);
  removeLegacyPlaintextKey();
  unlockedApiKey = apiKey;
}

export async function unlockGeminiApiKey(passphrase: string): Promise<void> {
  const record = await db.secrets.get(RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  const apiKey = await decryptApiKey(record, passphrase.trim());
  if (!apiKey) throw new Error('The encrypted Gemini API key is empty.');
  unlockedApiKey = apiKey;
  removeLegacyPlaintextKey();
}

export function lockGeminiApiKey(): void {
  unlockedApiKey = null;
}

export async function clearGeminiApiKey(): Promise<void> {
  await db.secrets.delete(RECORD_ID);
  unlockedApiKey = null;
  removeLegacyPlaintextKey();
}

export function maskGeminiApiKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
