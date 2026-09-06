import Dexie, { type Table } from 'dexie';

const DB_NAME = 'elara-gemini-lockbox';
const RECORD_ID = 'gemini-api-key';
const LEGACY_STORAGE_KEY = 'elara.gemini.api-key';
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_LENGTH = 256;

export const GEMINI_LOCKBOX_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const GEMINI_LOCKBOX_PIN_MIN_LENGTH = 6;
export const GEMINI_LOCKBOX_PIN_MAX_LENGTH = 8;
export type GeminiLockboxSecurityMode = 'password' | 'pin' | 'passkey' | 'off';

export interface GeminiLockboxSecurityMetadata {
  mode: GeminiLockboxSecurityMode;
  authVersion: 1;
  configuredAt: number;
  failedAttempts?: number;
  lockedUntil?: number | null;
}

type EncryptedGeminiApiKey = {
  id: 'gemini-api-key';
  version: 2;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  updatedAt: number;
  security: GeminiLockboxSecurityMetadata;
};

class LockboxDatabase extends Dexie {
  secrets!: Table<EncryptedGeminiApiKey, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ secrets: 'id, updatedAt' });
    this.version(2).stores({ secrets: 'id, updatedAt' }).upgrade(async (tx) => {
      await tx.table<EncryptedGeminiApiKey, string>('secrets').toCollection().modify((record) => {
        record.version = 2;
        record.security = {
          mode: 'password',
          authVersion: 1,
          configuredAt: record.updatedAt,
          failedAttempts: 0,
          lockedUntil: null,
        };
      });
    });
  }
}

const db = new LockboxDatabase();
let unlockedApiKey: string | null = null;
let lastActivityAt: number | null = null;
let idleTimer: number | null = null;

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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function textEncoder(): TextEncoder { return new TextEncoder(); }
function textDecoder(): TextDecoder { return new TextDecoder(); }

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!passphrase) throw new Error('A Lockbox password is required.');
  const material = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder().encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

function defaultSecurityMetadata(now = Date.now()): GeminiLockboxSecurityMetadata {
  return { mode: 'password', authVersion: 1, configuredAt: now, failedAttempts: 0, lockedUntil: null };
}

function normalizeSecurityMetadata(record: Partial<EncryptedGeminiApiKey> | undefined, now = Date.now()): GeminiLockboxSecurityMetadata {
  const security = record?.security;
  if (!security) return defaultSecurityMetadata(now);
  const mode: GeminiLockboxSecurityMode = security.mode === 'pin' || security.mode === 'passkey' || security.mode === 'off' ? security.mode : 'password';
  const updatedAt = record?.updatedAt;
  const configuredAt = Number.isFinite(security.configuredAt)
    ? security.configuredAt
    : (updatedAt !== undefined && Number.isFinite(updatedAt) ? updatedAt : now);
  const failedAttempts = Number.isInteger(security.failedAttempts) && security.failedAttempts >= 0 ? security.failedAttempts : 0;
  const lockedUntil = typeof security.lockedUntil === 'number' && Number.isFinite(security.lockedUntil) ? security.lockedUntil : null;
  return { mode, authVersion: 1, configuredAt, failedAttempts, lockedUntil };
}

async function encryptApiKey(apiKey: string, passphrase: string, security?: GeminiLockboxSecurityMetadata): Promise<EncryptedGeminiApiKey> {
  const now = Date.now();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveEncryptionKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = textEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return {
    id: RECORD_ID,
    version: 2,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: now,
    security: security ?? defaultSecurityMetadata(now),
  };
}

async function decryptApiKey(record: EncryptedGeminiApiKey, passphrase: string): Promise<string> {
  try {
    const salt = fromBase64(record.salt);
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);
    const key = await deriveEncryptionKey(passphrase, salt, record.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
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

function clearIdleTimer(): void {
  if (idleTimer !== null && typeof window !== 'undefined') window.clearTimeout(idleTimer);
  idleTimer = null;
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('elara-gemini-lockbox-changed'));
}

function scheduleIdleLock(): void {
  clearIdleTimer();
  if (unlockedApiKey === null || typeof window === 'undefined' || lastActivityAt === null) return;
  const remaining = Math.max(0, GEMINI_LOCKBOX_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    enforceGeminiApiKeyIdleTimeout();
  }, remaining);
}

export function isGeminiApiKeyIdle(now = Date.now()): boolean {
  return unlockedApiKey !== null && lastActivityAt !== null && now - lastActivityAt >= GEMINI_LOCKBOX_IDLE_TIMEOUT_MS;
}

export function enforceGeminiApiKeyIdleTimeout(now = Date.now()): boolean {
  if (!isGeminiApiKeyIdle(now)) return false;
  lockGeminiApiKey();
  return true;
}

export function touchGeminiApiKeyActivity(now = Date.now()): void {
  if (unlockedApiKey === null) return;
  lastActivityAt = now;
  scheduleIdleLock();
}

export function getGeminiLockboxLastActivityAt(): number | null {
  return lastActivityAt;
}

export type GeminiLockboxStatus = 'empty' | 'locked' | 'unlocked';

export async function getGeminiLockboxStatus(): Promise<GeminiLockboxStatus> {
  enforceGeminiApiKeyIdleTimeout();
  if (unlockedApiKey !== null) return unlockedApiKey ? 'unlocked' : 'empty';
  const record = await db.secrets.get(RECORD_ID);
  return record ? 'locked' : 'empty';
}

export async function getGeminiLockboxMetadata(): Promise<GeminiLockboxSecurityMetadata | null> {
  const record = await db.secrets.get(RECORD_ID);
  return record ? normalizeSecurityMetadata(record) : null;
}

export function isGeminiLockboxPin(value: string): boolean {
  return new RegExp(`^\\d{${GEMINI_LOCKBOX_PIN_MIN_LENGTH},${GEMINI_LOCKBOX_PIN_MAX_LENGTH}}$`).test(value);
}

function pinBackoffMs(failedAttempts: number): number {
  if (failedAttempts < 4) return 0;
  return Math.min(60_000, 1_000 * 2 ** Math.min(failedAttempts - 4, 6));
}

function remainingPinLockMs(security: GeminiLockboxSecurityMetadata, now = Date.now()): number {
  return security.lockedUntil ? Math.max(0, security.lockedUntil - now) : 0;
}

async function recordPinFailure(record: EncryptedGeminiApiKey): Promise<GeminiLockboxSecurityMetadata> {
  const security = normalizeSecurityMetadata(record);
  const failedAttempts = (security.failedAttempts ?? 0) + 1;
  const delay = pinBackoffMs(failedAttempts);
  const lockedUntil = delay > 0 ? Date.now() + delay : null;
  const updatedSecurity = { ...security, failedAttempts, lockedUntil };
  await db.secrets.update(RECORD_ID, { security: updatedSecurity, updatedAt: Date.now() });
  return updatedSecurity;
}

async function clearPinFailures(record: EncryptedGeminiApiKey): Promise<void> {
  const security = normalizeSecurityMetadata(record);
  if ((security.failedAttempts ?? 0) === 0 && !security.lockedUntil) return;
  await db.secrets.update(RECORD_ID, { security: { ...security, failedAttempts: 0, lockedUntil: null }, updatedAt: Date.now() });
}

export async function getGeminiApiKey(): Promise<string> {
  enforceGeminiApiKeyIdleTimeout();
  if (unlockedApiKey !== null) touchGeminiApiKeyActivity();
  return unlockedApiKey ?? '';
}

async function saveGeminiApiKeyWithMode(value: string, secret: string, mode: GeminiLockboxSecurityMode): Promise<void> {
  const apiKey = value.trim();
  if (!apiKey) {
    await clearGeminiApiKey();
    return;
  }
  const credential = secret.trim();
  if (!credential) throw new Error(mode === 'pin' ? 'A Lockbox PIN is required.' : 'A Lockbox password is required.');
  if (mode === 'pin' && !isGeminiLockboxPin(credential)) {
    throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  }
  const now = Date.now();
  const security: GeminiLockboxSecurityMetadata = { mode, authVersion: 1, configuredAt: now, failedAttempts: 0, lockedUntil: null };
  const encrypted = await encryptApiKey(apiKey, credential, security);
  await db.secrets.put(encrypted);
  removeLegacyPlaintextKey();
  unlockedApiKey = apiKey;
  lastActivityAt = now;
  scheduleIdleLock();
  notifyChanged();
}

export async function saveGeminiApiKey(value: string, passphrase: string): Promise<void> {
  const existing = await db.secrets.get(RECORD_ID);
  const mode = existing ? normalizeSecurityMetadata(existing).mode : 'password';
  await saveGeminiApiKeyWithMode(value, passphrase, mode);
}

export async function configureGeminiApiKeyWithPin(value: string, pin: string): Promise<void> {
  await saveGeminiApiKeyWithMode(value, pin, 'pin');
}

export async function unlockGeminiApiKey(passphrase: string): Promise<void> {
  const record = await db.secrets.get(RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  const normalized = { ...record, version: 2 as const, security: normalizeSecurityMetadata(record) };
  const apiKey = await decryptApiKey(normalized, passphrase.trim());
  if (!apiKey) throw new Error('The encrypted Gemini API key is empty.');
  await clearPinFailures(record);
  unlockedApiKey = apiKey;
  lastActivityAt = Date.now();
  scheduleIdleLock();
  removeLegacyPlaintextKey();
  notifyChanged();
}

export async function unlockGeminiApiKeyWithPin(pin: string): Promise<void> {
  if (!isGeminiLockboxPin(pin)) throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  const record = await db.secrets.get(RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  const security = normalizeSecurityMetadata(record);
  if (security.mode !== 'pin') throw new Error('This Lockbox is configured for password unlock.');
  const retryMs = remainingPinLockMs(security);
  if (retryMs > 0) throw new Error(`Too many failed PIN attempts. Try again in ${Math.ceil(retryMs / 1000)} seconds.`);
  try {
    const normalized = { ...record, version: 2 as const, security };
    const apiKey = await decryptApiKey(normalized, pin.trim());
    if (!apiKey) throw new Error('The encrypted Gemini API key is empty.');
    await clearPinFailures(record);
    unlockedApiKey = apiKey;
    lastActivityAt = Date.now();
    scheduleIdleLock();
    removeLegacyPlaintextKey();
    notifyChanged();
  } catch (error) {
    if (error instanceof Error && error.message === 'The encrypted Gemini API key is empty.') throw error;
    const updatedSecurity = await recordPinFailure(record);
    const retry = remainingPinLockMs(updatedSecurity);
    if (retry > 0) throw new Error(`Invalid PIN. Try again in ${Math.ceil(retry / 1000)} seconds.`);
    throw new Error('Invalid PIN.');
  }
}

export function lockGeminiApiKey(): void {
  clearIdleTimer();
  const wasUnlocked = unlockedApiKey !== null;
  unlockedApiKey = null;
  lastActivityAt = null;
  if (wasUnlocked) notifyChanged();
}

export async function clearGeminiApiKey(): Promise<void> {
  await db.secrets.delete(RECORD_ID);
  clearIdleTimer();
  unlockedApiKey = null;
  lastActivityAt = null;
  removeLegacyPlaintextKey();
  notifyChanged();
}

function installLifecycleController(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const enforceAndMaybeTouch = (touch = true) => {
    if (document.visibilityState !== 'visible') return;
    enforceGeminiApiKeyIdleTimeout();
    if (touch && unlockedApiKey !== null) touchGeminiApiKeyActivity();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enforceAndMaybeTouch(true);
  });
  window.addEventListener('focus', () => enforceAndMaybeTouch(true));
  window.addEventListener('pointerdown', () => enforceAndMaybeTouch(true), { passive: true });
  window.addEventListener('keydown', () => enforceAndMaybeTouch(true), { passive: true });
  window.addEventListener('touchstart', () => enforceAndMaybeTouch(true), { passive: true });
}

installLifecycleController();
removeLegacyPlaintextKey();

export function maskGeminiApiKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
