import Dexie, { type Table } from 'dexie';

/**
 * Elara API Lockbox — the single encrypted credential store.
 *
 * The store is keyed by secret id, so it holds more than one protected
 * credential while keeping ONE unlock session and ONE security configuration.
 * The Gemini record is the security authority: it carries the mode, the failed
 * attempt counter and the backoff deadline. Secondary records (YouTube) are
 * encrypted with the same credential and are unlocked alongside it.
 *
 * No Dexie version bump is required for a second credential: the `secrets`
 * store has been keyed by `id` since version 1, so a new id is simply a new
 * record. Only the TypeScript record type widened.
 *
 * Nothing here exposes a general-purpose getSecret(). Each credential has a
 * named, narrow accessor, matching the boundary described in
 * docs/API_LOCKBOX.md.
 */

const DB_NAME = 'elara-gemini-lockbox';
const GEMINI_RECORD_ID = 'gemini-api-key';
const YOUTUBE_RECORD_ID = 'youtube-api-key';
const LEGACY_STORAGE_KEY = 'elara.gemini.api-key';
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_LENGTH = 256;

/**
 * Every credential the Lockbox can hold. The Gemini record is first because it
 * is the security authority; the rest are unlocked with the same credential.
 */
export type LockboxSecretId = 'gemini-api-key' | 'youtube-api-key';

const ALL_SECRET_IDS: readonly LockboxSecretId[] = [GEMINI_RECORD_ID, YOUTUBE_RECORD_ID];
const SECONDARY_SECRET_IDS: readonly LockboxSecretId[] = [YOUTUBE_RECORD_ID];

export const GEMINI_LOCKBOX_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const GEMINI_LOCKBOX_PIN_MIN_LENGTH = 6;
export const GEMINI_LOCKBOX_PIN_MAX_LENGTH = 8;
export type GeminiLockboxSecurityMode = 'password' | 'pin' | 'passkey' | 'off';

export interface GeminiLockboxSecurityMetadata {
  mode: GeminiLockboxSecurityMode;
  authVersion: 1;
  configuredAt: number;
  failedAttempts: number;
  lockedUntil: number | null;
}

type EncryptedLockboxSecret = {
  id: LockboxSecretId;
  version: 2;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  updatedAt: number;
  security: GeminiLockboxSecurityMetadata;
  localKey?: CryptoKey;
};

/**
 * @deprecated Retained for existing imports; the record type is now keyed by
 * `LockboxSecretId` rather than fixed to the Gemini credential.
 */
export type EncryptedGeminiApiKey = EncryptedLockboxSecret;

class LockboxDatabase extends Dexie {
  secrets!: Table<EncryptedLockboxSecret, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ secrets: 'id, updatedAt' });
    this.version(2).stores({ secrets: 'id, updatedAt' }).upgrade(async (tx) => {
      await tx.table<EncryptedLockboxSecret, string>('secrets').toCollection().modify((record) => {
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

/** The single unlocked session: every credential the current unlock yielded. */
const unlockedSecrets = new Map<LockboxSecretId, string>();
/** Secondary records whose stored credential did not match the last unlock. */
const mismatchedSecrets = new Set<LockboxSecretId>();
let lastActivityAt: number | null = null;
let idleTimer: number | null = null;
let securityMode: GeminiLockboxSecurityMode | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

function unlocked(id: LockboxSecretId): string | null {
  return unlockedSecrets.get(id) ?? null;
}

function sessionUnlocked(): boolean {
  return unlockedSecrets.size > 0;
}

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

function normalizeSecurityMetadata(record: Partial<EncryptedLockboxSecret> | undefined, now = Date.now()): GeminiLockboxSecurityMetadata {
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

async function encryptSecret(id: LockboxSecretId, value: string, passphrase: string, security?: GeminiLockboxSecurityMetadata): Promise<EncryptedLockboxSecret> {
  const now = Date.now();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveEncryptionKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = textEncoder().encode(value);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return {
    id,
    version: 2,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: now,
    security: security ?? defaultSecurityMetadata(now),
  };
}

async function encryptWithLocalKey(value: string, localKey: CryptoKey): Promise<Pick<EncryptedLockboxSecret, 'iv' | 'ciphertext'>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = textEncoder().encode(value);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, localKey, toArrayBuffer(plaintext));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function decryptSecret(record: EncryptedLockboxSecret, passphrase: string): Promise<string> {
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

async function decryptWithLocalKey(record: EncryptedLockboxSecret): Promise<string> {
  if (!record.localKey) throw new Error('The local Lockbox key is unavailable. Re-enable Lockbox security.');
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(record.iv)) },
      record.localKey,
      toArrayBuffer(fromBase64(record.ciphertext)),
    );
    return textDecoder().decode(plaintext);
  } catch {
    throw new Error('The local Lockbox key could not decrypt the stored credential.');
  }
}

function readLegacyPlaintextKey(): string {
  try {
    return window.localStorage.getItem(LEGACY_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function removeLegacyPlaintextKey(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore unavailable localStorage; the encrypted Lockbox remains authoritative.
  }
}

async function migrateLegacyPlaintextKey(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (legacyMigrationPromise) return legacyMigrationPromise;
  legacyMigrationPromise = (async () => {
    const existing = await db.secrets.get(GEMINI_RECORD_ID);
    if (existing) {
      removeLegacyPlaintextKey();
      return;
    }

    const legacyKey = readLegacyPlaintextKey();
    if (!legacyKey) return;

    const localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
    const encrypted = await encryptWithLocalKey(legacyKey, localKey);
    const now = Date.now();
    await db.secrets.put({
      id: GEMINI_RECORD_ID,
      version: 2,
      salt: '',
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      iterations: PBKDF2_ITERATIONS,
      updatedAt: now,
      security: { mode: 'off', authVersion: 1, configuredAt: now, failedAttempts: 0, lockedUntil: null },
      localKey,
    });
    securityMode = 'off';
    unlockedSecrets.set(GEMINI_RECORD_ID, legacyKey);
    lastActivityAt = null;
    clearIdleTimer();
    removeLegacyPlaintextKey();
    notifyChanged();
  })().catch(() => {
    // Keep the legacy value intact if migration cannot be completed; retry on the next access.
  }).finally(() => {
    legacyMigrationPromise = null;
  });
  return legacyMigrationPromise;
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
  if (securityMode === 'off' || !sessionUnlocked() || typeof window === 'undefined' || lastActivityAt === null) return;
  const remaining = Math.max(0, GEMINI_LOCKBOX_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    enforceGeminiApiKeyIdleTimeout();
  }, remaining);
}

export function isGeminiApiKeyIdle(now = Date.now()): boolean {
  return securityMode !== 'off' && sessionUnlocked() && lastActivityAt !== null && now - lastActivityAt >= GEMINI_LOCKBOX_IDLE_TIMEOUT_MS;
}

export function enforceGeminiApiKeyIdleTimeout(now = Date.now()): boolean {
  if (!isGeminiApiKeyIdle(now)) return false;
  lockGeminiApiKey();
  return true;
}

export function touchGeminiApiKeyActivity(now = Date.now()): void {
  if (!sessionUnlocked() || securityMode === 'off') return;
  lastActivityAt = now;
  scheduleIdleLock();
}

export function getGeminiLockboxLastActivityAt(): number | null {
  return lastActivityAt;
}

export type GeminiLockboxStatus = 'empty' | 'locked' | 'unlocked';

/**
 * A secondary credential can additionally be `mismatched`: the record exists
 * but was stored under a different Lockbox credential, so the current unlock
 * could not open it. Surfacing this is what stops a silently unusable key.
 */
export type LockboxSecretStatus = GeminiLockboxStatus | 'mismatch';

async function getSecretStatus(id: LockboxSecretId): Promise<LockboxSecretStatus> {
  enforceGeminiApiKeyIdleTimeout();
  if (unlocked(id) !== null) return 'unlocked';
  const record = await db.secrets.get(id);
  if (!record) return 'empty';
  const security = normalizeSecurityMetadata(record);
  if (security.mode === 'off') {
    try {
      unlockedSecrets.set(id, await decryptWithLocalKey(record));
      mismatchedSecrets.delete(id);
      return 'unlocked';
    } catch {
      return 'locked';
    }
  }
  return mismatchedSecrets.has(id) ? 'mismatch' : 'locked';
}

export async function getGeminiLockboxStatus(): Promise<GeminiLockboxStatus> {
  await migrateLegacyPlaintextKey();
  const status = await getSecretStatus(GEMINI_RECORD_ID);
  if (status === 'unlocked') return 'unlocked';
  if (status === 'empty') return 'empty';
  const record = await db.secrets.get(GEMINI_RECORD_ID);
  if (record) securityMode = normalizeSecurityMetadata(record).mode;
  return 'locked';
}

export async function getGeminiLockboxMetadata(): Promise<GeminiLockboxSecurityMetadata | null> {
  const record = await db.secrets.get(GEMINI_RECORD_ID);
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

async function recordPinFailure(record: EncryptedLockboxSecret): Promise<GeminiLockboxSecurityMetadata> {
  const security = normalizeSecurityMetadata(record);
  const failedAttempts = security.failedAttempts + 1;
  const delay = pinBackoffMs(failedAttempts);
  const lockedUntil = delay > 0 ? Date.now() + delay : null;
  const updatedSecurity = { ...security, failedAttempts, lockedUntil };
  await db.secrets.update(GEMINI_RECORD_ID, { security: updatedSecurity, updatedAt: Date.now() });
  return updatedSecurity;
}

async function clearPinFailures(record: EncryptedLockboxSecret): Promise<void> {
  const security = normalizeSecurityMetadata(record);
  if (security.failedAttempts === 0 && !security.lockedUntil) return;
  await db.secrets.update(GEMINI_RECORD_ID, { security: { ...security, failedAttempts: 0, lockedUntil: null }, updatedAt: Date.now() });
}

/**
 * Opens every secondary credential that the same credential can open. A record
 * stored under a different credential is recorded as mismatched instead of
 * failing the unlock — the primary credential is still usable.
 */
async function unlockSecondarySecrets(credential: string): Promise<void> {
  for (const id of SECONDARY_SECRET_IDS) {
    const record = await db.secrets.get(id);
    if (!record) {
      unlockedSecrets.delete(id);
      mismatchedSecrets.delete(id);
      continue;
    }
    const security = normalizeSecurityMetadata(record);
    try {
      const value = security.mode === 'off'
        ? await decryptWithLocalKey(record)
        : await decryptSecret({ ...record, security }, credential);
      if (!value) throw new Error('empty');
      unlockedSecrets.set(id, value);
      mismatchedSecrets.delete(id);
    } catch {
      unlockedSecrets.delete(id);
      mismatchedSecrets.add(id);
    }
  }
}

async function readSecret(id: LockboxSecretId): Promise<string> {
  enforceGeminiApiKeyIdleTimeout();
  if (unlocked(id) === null) {
    const record = await db.secrets.get(id);
    if (record && normalizeSecurityMetadata(record).mode === 'off') {
      securityMode = 'off';
      try {
        unlockedSecrets.set(id, await decryptWithLocalKey(record));
        if (id === GEMINI_RECORD_ID) lastActivityAt = null;
      } catch {
        // An unreadable local-key record stays locked rather than throwing here.
      }
    }
  }
  if (sessionUnlocked()) touchGeminiApiKeyActivity();
  return unlocked(id) ?? '';
}

export async function getGeminiApiKey(): Promise<string> {
  await migrateLegacyPlaintextKey();
  return readSecret(GEMINI_RECORD_ID);
}

async function saveSecretWithMode(id: LockboxSecretId, value: string, secret: string, mode: GeminiLockboxSecurityMode): Promise<void> {
  const credentialValue = value.trim();
  if (!credentialValue) {
    if (id === GEMINI_RECORD_ID) await clearGeminiApiKey();
    else await clearYouTubeApiKey();
    return;
  }
  const credential = secret.trim();
  if (!credential) throw new Error(mode === 'pin' || mode === 'passkey' ? 'A Lockbox PIN is required.' : 'A Lockbox password is required.');
  if ((mode === 'pin' || mode === 'passkey') && !isGeminiLockboxPin(credential)) {
    throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  }
  const now = Date.now();
  const security: GeminiLockboxSecurityMetadata = { mode, authVersion: 1, configuredAt: now, failedAttempts: 0, lockedUntil: null };
  await db.secrets.put(await encryptSecret(id, credentialValue, credential, security));
  removeLegacyPlaintextKey();
  securityMode = mode;
  unlockedSecrets.set(id, credentialValue);
  mismatchedSecrets.delete(id);
  lastActivityAt = mode === 'off' ? null : now;
  if (mode === 'off') clearIdleTimer(); else scheduleIdleLock();
  notifyChanged();
}

export async function saveGeminiApiKey(value: string, passphrase: string): Promise<void> {
  const existing = await db.secrets.get(GEMINI_RECORD_ID);
  const mode = existing ? normalizeSecurityMetadata(existing).mode : 'password';
  if (mode === 'off') {
    await enableGeminiLockboxWithPin(passphrase);
    return;
  }
  await saveSecretWithMode(GEMINI_RECORD_ID, value, passphrase, mode);
}

export async function configureGeminiApiKeyWithPin(value: string, pin: string): Promise<void> {
  await saveSecretWithMode(GEMINI_RECORD_ID, value, pin, 'pin');
  // A PIN change rotates the Lockbox credential, so every other stored secret
  // must be re-encrypted with the new one or it becomes permanently unreadable.
  await reencryptSecondarySecrets(pin);
}

/**
 * Re-encrypts each currently-unlocked secondary credential under a new Lockbox
 * credential. Called on credential rotation so a PIN or password change never
 * orphans a secondary key.
 */
async function reencryptSecondarySecrets(credential: string): Promise<void> {
  for (const id of SECONDARY_SECRET_IDS) {
    const record = await db.secrets.get(id);
    const plaintext = unlocked(id);
    if (!record || plaintext === null) continue;
    const security = normalizeSecurityMetadata(record);
    if (security.mode === 'off') continue;
    await db.secrets.put(await encryptSecret(id, plaintext, credential, security));
    mismatchedSecrets.delete(id);
  }
}

export async function setGeminiLockboxSecurityMode(mode: Exclude<GeminiLockboxSecurityMode, 'off'>): Promise<void> {
  const record = await db.secrets.get(GEMINI_RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  if (!sessionUnlocked()) throw new Error('Unlock the Lockbox before changing its security mode.');
  if (normalizeSecurityMetadata(record).mode === 'off') throw new Error('Re-enable Lockbox security with a PIN before selecting another mode.');
  const security = normalizeSecurityMetadata(record);
  await db.secrets.update(GEMINI_RECORD_ID, {
    security: { ...security, mode },
    updatedAt: Date.now(),
  });
  securityMode = mode;
  scheduleIdleLock();
  notifyChanged();
}

export async function disableGeminiLockboxSecurity(): Promise<void> {
  const geminiKey = unlocked(GEMINI_RECORD_ID);
  if (geminiKey === null) throw new Error('Unlock the Lockbox before turning security off.');
  const record = await db.secrets.get(GEMINI_RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  const security = normalizeSecurityMetadata(record);
  if (security.mode === 'off') return;

  // Every credential moves to device-local key protection together, so the
  // session stays coherent: either all are 'off' or none are.
  const now = Date.now();
  const offSecurity: GeminiLockboxSecurityMetadata = { ...security, mode: 'off', configuredAt: now, failedAttempts: 0, lockedUntil: null };
  for (const id of ALL_SECRET_IDS) {
    const target = id === GEMINI_RECORD_ID ? record : await db.secrets.get(id);
    const plaintext = id === GEMINI_RECORD_ID ? geminiKey : unlocked(id);
    if (!target || plaintext === null) continue;
    const localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
    const encrypted = await encryptWithLocalKey(plaintext, localKey);
    await db.secrets.put({
      ...target,
      version: 2,
      salt: '',
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      updatedAt: now,
      security: offSecurity,
      localKey,
    });
    mismatchedSecrets.delete(id);
  }
  securityMode = 'off';
  lastActivityAt = null;
  clearIdleTimer();
  removeLegacyPlaintextKey();
  notifyChanged();
}

export async function enableGeminiLockboxWithPin(pin: string): Promise<void> {
  if (!isGeminiLockboxPin(pin)) throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('The Gemini API Lockbox is not configured.');
  await saveSecretWithMode(GEMINI_RECORD_ID, apiKey, pin, 'pin');
  await reencryptSecondarySecrets(pin);
}

async function unlockWithCredential(credential: string, requirePinMode: boolean): Promise<void> {
  const record = await db.secrets.get(GEMINI_RECORD_ID);
  if (!record) throw new Error('The Gemini API Lockbox is not configured.');
  const security = normalizeSecurityMetadata(record);
  securityMode = security.mode;
  if (security.mode === 'off') {
    unlockedSecrets.set(GEMINI_RECORD_ID, await decryptWithLocalKey(record));
    mismatchedSecrets.delete(GEMINI_RECORD_ID);
    lastActivityAt = null;
    clearIdleTimer();
    await unlockSecondarySecrets(credential);
    notifyChanged();
    return;
  }
  if (requirePinMode && security.mode !== 'pin' && security.mode !== 'passkey') {
    throw new Error('This Lockbox is configured for password unlock.');
  }
  if (requirePinMode) {
    const retryMs = remainingPinLockMs(security);
    if (retryMs > 0) throw new Error(`Too many failed PIN attempts. Try again in ${Math.ceil(retryMs / 1000)} seconds.`);
  }
  try {
    const apiKey = await decryptSecret({ ...record, version: 2 as const, security }, credential);
    if (!apiKey) throw new Error('The encrypted Gemini API key is empty.');
    await clearPinFailures(record);
    unlockedSecrets.set(GEMINI_RECORD_ID, apiKey);
    mismatchedSecrets.delete(GEMINI_RECORD_ID);
    lastActivityAt = Date.now();
    scheduleIdleLock();
    removeLegacyPlaintextKey();
    await unlockSecondarySecrets(credential);
    notifyChanged();
  } catch (error) {
    if (!requirePinMode) throw error;
    if (error instanceof Error && error.message === 'The encrypted Gemini API key is empty.') throw error;
    const updatedSecurity = await recordPinFailure(record);
    const retry = remainingPinLockMs(updatedSecurity);
    if (retry > 0) throw new Error(`Invalid PIN. Try again in ${Math.ceil(retry / 1000)} seconds.`);
    throw new Error('Invalid PIN.');
  }
}

export async function unlockGeminiApiKey(passphrase: string): Promise<void> {
  await unlockWithCredential(passphrase.trim(), false);
}

export async function unlockGeminiApiKeyWithPin(pin: string): Promise<void> {
  if (!isGeminiLockboxPin(pin)) throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  await unlockWithCredential(pin.trim(), true);
}

export function lockGeminiApiKey(): void {
  clearIdleTimer();
  const wasUnlocked = sessionUnlocked();
  unlockedSecrets.clear();
  mismatchedSecrets.clear();
  lastActivityAt = null;
  if (wasUnlocked) notifyChanged();
}

export async function clearGeminiApiKey(): Promise<void> {
  // Removing the Lockbox removes every credential it holds. Leaving a secondary
  // record behind would orphan it: its security mode is inherited from the
  // primary, so with the primary gone it would report 'unlocked' forever while
  // being impossible to decrypt.
  await db.secrets.bulkDelete([GEMINI_RECORD_ID, YOUTUBE_RECORD_ID]);
  clearIdleTimer();
  unlockedSecrets.clear();
  mismatchedSecrets.clear();
  lastActivityAt = null;
  securityMode = null;
  removeLegacyPlaintextKey();
  notifyChanged();
}

/* -------------------------------------------------------------------------
   YouTube Data API credential
   -------------------------------------------------------------------------
   A secondary credential: it shares the Lockbox's single unlock session and
   takes its security mode from the Gemini record, which remains the security
   authority. Saving it therefore requires the current Lockbox credential.
   ------------------------------------------------------------------------- */

/**
 * Stores a secret under a freshly generated device-local key. Used when the
 * Lockbox security mode is 'off': those records decrypt with `localKey` and no
 * credential, so encrypting one with a passphrase would make it unreadable.
 */
async function saveSecretWithLocalKey(id: LockboxSecretId, value: string, security: GeminiLockboxSecurityMetadata): Promise<void> {
  const now = Date.now();
  const localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
  const encrypted = await encryptWithLocalKey(value, localKey);
  await db.secrets.put({
    id,
    version: 2,
    salt: '',
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    iterations: PBKDF2_ITERATIONS,
    updatedAt: now,
    security: { ...security, mode: 'off', configuredAt: now, failedAttempts: 0, lockedUntil: null },
    localKey,
  });
  unlockedSecrets.set(id, value);
  mismatchedSecrets.delete(id);
}

export async function saveYouTubeApiKey(value: string, credential: string): Promise<void> {
  const primary = await db.secrets.get(GEMINI_RECORD_ID);
  const mode = primary ? normalizeSecurityMetadata(primary).mode : 'password';
  const trimmed = value.trim();
  if (!trimmed) {
    await clearYouTubeApiKey();
    return;
  }
  if (mode === 'off') {
    // Security off: match the primary record's device-local protection rather
    // than writing a passphrase-encrypted record stamped as 'off'.
    const security = primary ? normalizeSecurityMetadata(primary) : defaultSecurityMetadata();
    await saveSecretWithLocalKey(YOUTUBE_RECORD_ID, trimmed, security);
    securityMode = 'off';
    lastActivityAt = null;
    clearIdleTimer();
    notifyChanged();
    return;
  }
  await saveSecretWithMode(YOUTUBE_RECORD_ID, trimmed, credential, mode);
  // Keep the security authority's metadata intact: the secondary record must
  // not reset the primary's attempt counter or configured-at timestamp.
  if (primary) {
    await db.secrets.update(GEMINI_RECORD_ID, { updatedAt: Date.now() });
  }
}

export async function getYouTubeApiKey(): Promise<string> {
  return readSecret(YOUTUBE_RECORD_ID);
}

export async function getYouTubeLockboxStatus(): Promise<LockboxSecretStatus> {
  await migrateLegacyPlaintextKey();
  return getSecretStatus(YOUTUBE_RECORD_ID);
}

export async function clearYouTubeApiKey(): Promise<void> {
  await db.secrets.delete(YOUTUBE_RECORD_ID);
  unlockedSecrets.delete(YOUTUBE_RECORD_ID);
  mismatchedSecrets.delete(YOUTUBE_RECORD_ID);
  notifyChanged();
}

function installLifecycleController(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const enforceAndMaybeTouch = (touch = true) => {
    if (document.visibilityState !== 'visible') return;
    enforceGeminiApiKeyIdleTimeout();
    if (touch && sessionUnlocked()) touchGeminiApiKeyActivity();
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

export function maskGeminiApiKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/** Shared masking for any Lockbox credential; never returns the full value. */
export const maskLockboxSecret = maskGeminiApiKey;
