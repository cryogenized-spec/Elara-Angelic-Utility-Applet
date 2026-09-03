import Dexie, { type Table } from 'dexie';
import { z } from 'zod';

const LOCKBOX_KEY_ID = 'gemini-key-encryption';
const GEMINI_SECRET_ID = 'gemini-api-key';
const apiKeySchema = z.string().trim().min(10).max(512);

interface StoredEncryptionKey { id: string; key: CryptoKey; }
interface StoredSecret { id: string; iv: ArrayBuffer; ciphertext: ArrayBuffer; updatedAt: number; }

class LockboxDatabase extends Dexie {
  keys!: Table<StoredEncryptionKey, string>;
  secrets!: Table<StoredSecret, string>;

  constructor() {
    super('elara-lockbox');
    this.version(1).stores({ keys: 'id', secrets: 'id, updatedAt' });
  }
}

const db = new LockboxDatabase();

async function ensureEncryptionKey(): Promise<CryptoKey> {
  const existing = await db.keys.get(LOCKBOX_KEY_ID);
  if (existing) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  try {
    await db.keys.add({ id: LOCKBOX_KEY_ID, key });
    return key;
  } catch {
    const raced = await db.keys.get(LOCKBOX_KEY_ID);
    if (!raced) throw new Error('Could not initialize the local API Lockbox.');
    return raced.key;
  }
}

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: ArrayBuffer) => new TextDecoder().decode(value);

export async function hasGeminiApiKey(): Promise<boolean> {
  return Boolean(await db.secrets.get(GEMINI_SECRET_ID));
}

export async function setGeminiApiKey(value: string): Promise<void> {
  const apiKey = apiKeySchema.parse(value);
  const key = await ensureEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encode(apiKey));

  await db.secrets.put({
    id: GEMINI_SECRET_ID,
    iv: iv.buffer,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function getGeminiApiKey(): Promise<string | null> {
  const secret = await db.secrets.get(GEMINI_SECRET_ID);
  if (!secret) return null;
  const key = await ensureEncryptionKey();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: secret.iv }, key, secret.ciphertext);
  return apiKeySchema.parse(decode(plaintext));
}

export async function clearGeminiApiKey(): Promise<void> {
  await db.secrets.delete(GEMINI_SECRET_ID);
}
