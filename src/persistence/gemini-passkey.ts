import Dexie, { type Table } from 'dexie';
import {
  getGeminiLockboxMetadata,
  isGeminiLockboxPin,
  setGeminiLockboxSecurityMode,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';

const DB_NAME = 'elara-gemini-passkey';
const RECORD_ID = 'gemini-passkey';
const PRF_SALT_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_KEY_BYTES = 32;
const RP_NAME = 'Elara';

type PasskeyRecord = {
  id: typeof RECORD_ID;
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrappedPin: string;
  rpId: string;
  createdAt: number;
  updatedAt: number;
};

class PasskeyDatabase extends Dexie {
  credentials!: Table<PasskeyRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ credentials: 'id, updatedAt' });
  }
}

const db = new PasskeyDatabase();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function secureContextAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

export function isGeminiPasskeySupported(): boolean {
  return secureContextAvailable()
    && typeof PublicKeyCredential !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.credentials?.create === 'function'
    && typeof navigator.credentials?.get === 'function';
}

export async function isGeminiPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isGeminiPasskeySupported() || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function hasGeminiPasskey(): Promise<boolean> {
  return (await db.credentials.get(RECORD_ID)) !== undefined;
}

function requireBuffer(value: ArrayBuffer | ArrayBufferView | null): ArrayBuffer {
  if (!value) throw new Error('Passkey did not return the required cryptographic material.');
  if (value instanceof ArrayBuffer) return value;
  const view = value as ArrayBufferView;
  return toArrayBuffer(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

async function deriveWrappingKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  if (prfOutput.byteLength !== AES_KEY_BYTES) throw new Error('The platform passkey did not provide a valid PRF secret.');
  return crypto.subtle.importKey('raw', prfOutput, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function wrapPin(pin: string, prfOutput: ArrayBuffer): Promise<{ iv: string; wrappedPin: string }> {
  const key = await deriveWrappingKey(prfOutput);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const plaintext = new TextEncoder().encode(pin);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return { iv: bytesToBase64Url(iv), wrappedPin: bytesToBase64Url(new Uint8Array(ciphertext)) };
}

async function unwrapPin(record: PasskeyRecord, prfOutput: ArrayBuffer): Promise<string> {
  const key = await deriveWrappingKey(prfOutput);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64UrlToBytes(record.iv)) },
    key,
    toArrayBuffer(base64UrlToBytes(record.wrappedPin)),
  );
  return new TextDecoder().decode(plaintext);
}

function createChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function registerGeminiPasskey(pin: string): Promise<void> {
  if (!isGeminiLockboxPin(pin)) throw new Error('Enter your valid 6–8 digit PIN before enabling the passkey.');
  if (!isGeminiPasskeySupported()) throw new Error('Passkeys require a secure HTTPS browser context.');
  if (!(await isGeminiPlatformAuthenticatorAvailable())) {
    throw new Error('This browser or device does not expose a user-verifying platform authenticator.');
  }

  const existing = await db.credentials.get(RECORD_ID);
  if (existing) throw new Error('A passkey is already configured for this Lockbox.');

  const rpId = window.location.hostname;
  const prfSalt = crypto.getRandomValues(new Uint8Array(PRF_SALT_BYTES));
  const creation = await navigator.credentials.create({
    publicKey: {
      challenge: createChallenge(),
      rp: { id: rpId, name: RP_NAME },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: 'local-elara-user',
        displayName: 'Elara User',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      userVerification: 'required',
      attestation: 'none',
      extensions: {
        prf: {
          eval: { first: toArrayBuffer(prfSalt) },
        },
      },
      timeout: 60_000,
    },
  });

  if (!(creation instanceof PublicKeyCredential)) throw new Error('The browser did not return a valid passkey credential.');
  const extensionResults = creation.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const creationPrf = extensionResults.prf;
  if (!creationPrf?.enabled || !creationPrf.results?.first) {
    throw new Error('This passkey authenticator does not support the PRF feature required for local Lockbox unlocking. PIN remains available.');
  }

  const credentialId = bytesToBase64Url(new Uint8Array(requireBuffer(creation.rawId)));
  const wrapped = await wrapPin(pin, requireBuffer(creationPrf.results.first));
  const now = Date.now();
  await db.credentials.put({
    id: RECORD_ID,
    credentialId,
    prfSalt: bytesToBase64Url(prfSalt),
    iv: wrapped.iv,
    wrappedPin: wrapped.wrappedPin,
    rpId,
    createdAt: now,
    updatedAt: now,
  });
  await setGeminiLockboxSecurityMode('passkey');
}

export async function unlockGeminiApiKeyWithPasskey(): Promise<void> {
  if (!isGeminiPasskeySupported()) throw new Error('Passkeys require a secure HTTPS browser context.');
  const record = await db.credentials.get(RECORD_ID);
  if (!record) throw new Error('No passkey is configured for this Lockbox.');
  const challenge = createChallenge();
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: record.rpId,
      userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(record.credentialId) }],
      extensions: {
        prf: {
          evalByCredential: {
            [record.credentialId]: { first: base64UrlToBytes(record.prfSalt) },
          },
        },
      },
      timeout: 60_000,
    },
  });

  if (!(assertion instanceof PublicKeyCredential)) throw new Error('The browser did not return a valid passkey assertion.');
  const extensionResults = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const prfOutput = extensionResults.prf?.results?.first;
  if (!prfOutput) throw new Error('The passkey authenticator did not return the required PRF secret. Use your PIN instead.');

  const pin = await unwrapPin(record, requireBuffer(prfOutput));
  if (!isGeminiLockboxPin(pin)) throw new Error('The configured passkey is invalid for this Lockbox. Use your PIN fallback.');
  await unlockGeminiApiKeyWithPin(pin);
}

export async function removeGeminiPasskey(): Promise<void> {
  await db.credentials.delete(RECORD_ID);
  const metadata = await getGeminiLockboxMetadata();
  if (metadata?.mode === 'passkey') await setGeminiLockboxSecurityMode('pin');
}

async function removeStalePasskeyWhenLockboxClears(): Promise<void> {
  if (!secureContextAvailable()) return;
  try {
    const status = await getGeminiLockboxMetadata();
    if (!status) await db.credentials.delete(RECORD_ID);
  } catch {
    // Ignore cleanup races during application startup.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('elara-gemini-lockbox-changed', () => {
    void removeStalePasskeyWhenLockboxClears();
  });
}
