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

/**
 * Reads a record together with the security mode that actually governs access
 * to it. For the Gemini record that is its own mode; for a secondary it is the
 * Gemini authority's, because the stored copy is only ever a copy.
 *
 * A secondary record stores a mode stamp of its own, but that stamp is only
 * ever a copy of the authority's. It goes stale whenever the authority changes
 * through a path the secondary was not migrated by, and honoring the copy is
 * what previously let a secondary stay readable with a device-local key after
 * the Lockbox had been re-armed with a PIN. Read paths therefore resolve the
 * *effective* mode from the authority and treat a disagreement as a record that
 * needs repair, never as permission to use the weaker protection.
 *
 * With no primary record at all there is no authority to inherit, so a lone
 * record falls back to its own stamp; new secondary records cannot be created
 * in that state.
 */
async function recordWithGoverningMode(id: LockboxSecretId): Promise<{ record: EncryptedLockboxSecret; mode: GeminiLockboxSecurityMode } | null> {
  const record = await db.secrets.get(id);
  if (!record) return null;
  const stamped = normalizeSecurityMetadata(record).mode;
  if (id === GEMINI_RECORD_ID) return { record, mode: stamped };
  const authority = await db.secrets.get(GEMINI_RECORD_ID);
  return { record, mode: authority ? normalizeSecurityMetadata(authority).mode : stamped };
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
  const entry = await recordWithGoverningMode(id);
  if (!entry) return 'empty';
  if (entry.mode === 'off') {
    try {
      unlockedSecrets.set(id, await decryptWithLocalKey(entry.record));
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

/** Modes whose authorization secret is a short PIN rather than a passphrase. */
function isPinMode(mode: GeminiLockboxSecurityMode): boolean {
  return mode === 'pin' || mode === 'passkey';
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
 * Opens a secondary record using the protection it is actually stored under,
 * and reports what would have to change to bring it onto the protection the
 * authority currently requires.
 */
async function openSecondary(
  record: EncryptedLockboxSecret,
  governingMode: GeminiLockboxSecurityMode,
  credential: string,
): Promise<{ plaintext: string; rewrap: 'none' | 'restamp' | 'reencrypt' } | null> {
  const security = normalizeSecurityMetadata(record);
  const plaintext = security.mode === 'off'
    ? await decryptWithLocalKey(record).catch(() => null)
    : await decryptSecret({ ...record, security }, credential).catch(() => null);
  if (!plaintext) return null;
  if ((security.mode === 'off') !== (governingMode === 'off')) return { plaintext, rewrap: 'reencrypt' };
  return { plaintext, rewrap: security.mode === governingMode ? 'none' : 'restamp' };
}

/**
 * Writes a secondary record under the protection the authority requires: a
 * device-local key while security is off, the Lockbox credential otherwise.
 */
async function storeSecondary(id: LockboxSecretId, plaintext: string, credential: string, mode: GeminiLockboxSecurityMode): Promise<void> {
  const now = Date.now();
  const security: GeminiLockboxSecurityMetadata = { mode, authVersion: 1, configuredAt: now, failedAttempts: 0, lockedUntil: null };
  if (mode === 'off') {
    const localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
    const encrypted = await encryptWithLocalKey(plaintext, localKey);
    await db.secrets.put({ id, version: 2, salt: '', iv: encrypted.iv, ciphertext: encrypted.ciphertext, iterations: PBKDF2_ITERATIONS, updatedAt: now, security, localKey });
    return;
  }
  await db.secrets.put(await encryptSecret(id, plaintext, credential, security));
}

/** The mode the Gemini authority is currently running in. */
async function authorityMode(): Promise<GeminiLockboxSecurityMode> {
  const authority = await db.secrets.get(GEMINI_RECORD_ID);
  if (authority) return normalizeSecurityMetadata(authority).mode;
  return securityMode ?? 'password';
}

/**
 * Opens every secondary credential that belongs to this Lockbox session.
 *
 * A secondary carries a copy of the authority's security mode. When that copy
 * has gone stale — the authority was re-armed while this record stayed on a
 * device-local key, or a record predates the current mode — the record is
 * repaired onto the authority's protection during the same unlock rather than
 * left readable under the weaker one. A record that cannot be opened at all is
 * reported as `mismatched` instead of failing the unlock, so the primary
 * credential remains usable.
 */
async function unlockSecondarySecrets(credential: string): Promise<void> {
  const mode = await authorityMode();
  for (const id of SECONDARY_SECRET_IDS) {
    const record = await db.secrets.get(id);
    if (!record) {
      unlockedSecrets.delete(id);
      mismatchedSecrets.delete(id);
      continue;
    }
    const opened = await openSecondary(record, mode, credential);
    if (!opened || !opened.plaintext) {
      unlockedSecrets.delete(id);
      mismatchedSecrets.add(id);
      continue;
    }
    if (opened.rewrap === 'reencrypt') await storeSecondary(id, opened.plaintext, credential, mode);
    else if (opened.rewrap === 'restamp') {
      await db.secrets.update(id, { security: { ...normalizeSecurityMetadata(record), mode }, updatedAt: Date.now() });
    }
    unlockedSecrets.set(id, opened.plaintext);
    mismatchedSecrets.delete(id);
  }
}

async function readSecret(id: LockboxSecretId): Promise<string> {
  enforceGeminiApiKeyIdleTimeout();
  if (unlocked(id) === null) {
    const entry = await recordWithGoverningMode(id);
    // A secondary whose stamp still says 'off' after the Lockbox was re-armed
    // must not be self-decrypted here: that is precisely the state where it
    // would become readable with no credential at all.
    if (entry && entry.mode === 'off') {
      securityMode = 'off';
      try {
        unlockedSecrets.set(id, await decryptWithLocalKey(entry.record));
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
  if (!credential) throw new Error(isPinMode(mode) ? 'A Lockbox PIN is required.' : 'A Lockbox password is required.');
  if (isPinMode(mode) && !isGeminiLockboxPin(credential)) {
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
  // Replacing the authority's credential is a rotation, not just a key update.
  // Secondaries are sealed with the credential rather than the key material, so
  // skipping this would orphan every one of them against the new passphrase.
  await reencryptSecondarySecrets(passphrase.trim());
}

export async function configureGeminiApiKeyWithPin(value: string, pin: string): Promise<void> {
  await saveSecretWithMode(GEMINI_RECORD_ID, value, pin, 'pin');
  // A PIN change rotates the Lockbox credential, so every other stored secret
  // must be re-encrypted with the new one or it becomes permanently unreadable.
  await reencryptSecondarySecrets(pin);
}

/**
 * Moves every stored secondary onto a new Lockbox credential. Called on
 * credential rotation and on security re-arm so a rotation never orphans a
 * secondary key — and, critically, so a secondary can never remain on a
 * device-local key after the Lockbox has been re-armed with a PIN, which would
 * leave it permanently readable without any credential.
 *
 * A record this cannot open is left byte-for-byte alone and reported as
 * mismatched: rewriting it with a credential nobody can re-derive would destroy
 * the only copy, while the read paths now consult the authority rather than the
 * record's own stale stamp, so an untouched record is never unprotected.
 */
async function reencryptSecondarySecrets(credential: string): Promise<void> {
  const mode = await authorityMode();
  for (const id of SECONDARY_SECRET_IDS) {
    const record = await db.secrets.get(id);
    if (!record) {
      mismatchedSecrets.delete(id);
      continue;
    }
    const plaintext = unlocked(id) ?? (await openSecondary(record, mode, credential))?.plaintext ?? null;
    if (!plaintext) {
      unlockedSecrets.delete(id);
      mismatchedSecrets.add(id);
      continue;
    }
    await storeSecondary(id, plaintext, credential, mode);
    unlockedSecrets.set(id, plaintext);
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

  // Every credential this can open moves to device-local key protection
  // together, so an unlocked session stays coherent. A secondary this *cannot*
  // open is deliberately left sealed under its old credential rather than
  // weakened to match the authority: it stays unusable and is reported as
  // mismatched, which is honest, instead of becoming a silently unprotected
  // copy of a key the user already lost the credential for.
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
 * Establishes that a secondary credential may be written right now, and returns
 * the protection the new record must use.
 *
 * The Lockbox previously accepted any non-empty string as the authorization
 * secret for a secondary write and encrypted the record with it. That made the
 * UI the only thing standing between a mistyped credential and a permanently
 * unreadable key, so the store enforced its own documented invariant in name
 * only. A secondary write now requires proof that the caller holds the
 * authority's *actual* current credential, and an unlocked session so that this
 * path cannot become a credential-guessing oracle around the primary's backoff.
 *
 * The Gemini record must exist: it is the security authority a secondary
 * inherits protection from, and a secondary written with no authority would be
 * an orphan that nothing can ever re-arm or decrypt.
 */
async function requireSecondaryWriteAuthority(credential: string): Promise<GeminiLockboxSecurityMode> {
  const authority = await db.secrets.get(GEMINI_RECORD_ID);
  if (!authority) throw new Error('Create the Gemini API Lockbox before storing another credential.');
  const mode = normalizeSecurityMetadata(authority).mode;
  if (mode === 'off') return 'off';
  if (!sessionUnlocked()) throw new Error('Unlock the Lockbox before storing another credential.');
  if (!credential) throw new Error(isPinMode(mode) ? 'A Lockbox PIN is required.' : 'A Lockbox password is required.');
  const opened = await decryptSecret(authority, credential).catch(() => null);
  if (opened === null) throw new Error('That does not match the current Lockbox credential.');
  return mode;
}

export async function saveYouTubeApiKey(value: string, credential: string): Promise<void> {
  const trimmed = value.trim();
  // Removing a key must always work, including from a broken state.
  if (!trimmed) {
    await clearYouTubeApiKey();
    return;
  }
  const mode = await requireSecondaryWriteAuthority(credential.trim());
  await storeSecondary(YOUTUBE_RECORD_ID, trimmed, credential.trim(), mode);
  securityMode = mode;
  unlockedSecrets.set(YOUTUBE_RECORD_ID, trimmed);
  mismatchedSecrets.delete(YOUTUBE_RECORD_ID);
  lastActivityAt = mode === 'off' ? null : Date.now();
  if (mode === 'off') clearIdleTimer(); else scheduleIdleLock();
  // Keep the security authority's metadata intact: the secondary record must
  // not reset the primary's attempt counter or configured-at timestamp.
  await db.secrets.update(GEMINI_RECORD_ID, { updatedAt: Date.now() });
  notifyChanged();
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
