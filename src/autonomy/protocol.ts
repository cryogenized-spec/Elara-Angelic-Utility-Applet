// ---------------------------------------------------------------------------
// App ↔ Worker authentication protocol (design doc §10) — SHARED contract.
//
// The browser client and the Worker both import exactly these definitions, so
// the signature format can never drift between signer and verifier:
// - Reads:      `Authorization: Bearer <installation token>`
// - Writes:     HMAC-SHA256 over `method\npath\ntimestamp\nbody` with the
//               installation token, a ±5-minute timestamp window, and a
//               per-request nonce (strict replay rejection via the Durable
//               Object's nonce ledger).
// - Internal:   the cron heartbeat reaches the Durable Object through the
//   Worker-to-DO binding only — there is no public wake endpoint — and
//   carries an internal marker derived from the same token so the DO can
//   distinguish binding-internal maintenance calls from forwarded app calls.
//
// The token is a client credential by design (scoped to the user's own worker
// deployment, set as ELARA_INSTALLATION_TOKEN via wrangler secret). No Google
// credential, Lockbox key, or OAuth material ever crosses this boundary.
// ---------------------------------------------------------------------------

export const ELARA_AUTH_TIMESTAMP_HEADER = 'X-Elara-Timestamp';
export const ELARA_AUTH_NONCE_HEADER = 'X-Elara-Nonce';
export const ELARA_AUTH_SIGNATURE_HEADER = 'X-Elara-Signature';
export const ELARA_INTERNAL_HEADER = 'X-Elara-Internal';

/** ± window for signed-write timestamps. */
export const ELARA_AUTH_TIMESTAMP_WINDOW_MS = 5 * 60_000;

const INSTALLATION_ID_MESSAGE = 'elara-installation-id-v1';
const INTERNAL_MARKER_MESSAGE = 'elara-internal-wake-v1';

export type AuthFailureCode = 'missing-token' | 'bad-token' | 'stale-timestamp' | 'bad-signature' | 'replayed-nonce';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
}

/** Constant-time equality over the raw byte representations. */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) {
    // Still burn a comparison so length differences do not leak via timing.
    let dummy = 0;
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) dummy |= (left[index] ?? 0) ^ (right[index] ?? 0);
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/**
 * Stable installation identity derived from the token: one deployment = one
 * token = one installationId = one Durable Object instance (idFromName).
 * Never the token itself.
 */
export async function deriveInstallationId(token: string): Promise<string> {
  return (await hmacSha256(token, INSTALLATION_ID_MESSAGE)).slice(0, 32);
}

/** The canonical signed-write message: exact bytes both sides must agree on. */
export function signedWriteMessage(method: string, path: string, timestamp: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
}

/** Sign a write exactly the way the app client does. */
export async function signWrite(token: string, method: string, path: string, timestamp: number, nonce: string, body: string): Promise<string> {
  return hmacSha256(token, signedWriteMessage(method, path, String(timestamp), body));
}

export interface SignedWriteVerification {
  ok: boolean;
  code?: AuthFailureCode;
  installationId?: string;
}

/**
 * Verify a signed write: timestamp within the window, signature matching the
 * canonical message. Nonce-ledger replay rejection is enforced by the Durable
 * Object (it owns the durable ledger); this check is stateless so both the
 * Worker boundary and the DO can run it independently.
 */
export async function verifySignedWrite(input: {
  method: string;
  path: string;
  timestamp: string;
  signature: string;
  body: string;
}, token: string, now: number): Promise<SignedWriteVerification> {
  if (!input.timestamp || !input.signature) return { ok: false, code: 'bad-signature' };
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > ELARA_AUTH_TIMESTAMP_WINDOW_MS) {
    return { ok: false, code: 'stale-timestamp' };
  }
  const expected = await hmacSha256(token, signedWriteMessage(input.method, input.path, input.timestamp, input.body));
  if (!constantTimeEqual(expected, input.signature)) return { ok: false, code: 'bad-signature' };
  return { ok: true, installationId: await deriveInstallationId(token) };
}

/** Verify a bearer token without leaking comparisons (both sides hash to fixed-width digests first). */
export async function verifyBearerToken(presented: string | null, token: string): Promise<boolean> {
  if (!presented) return false;
  const presentedDigest = await hmacSha256(presented, 'elara-bearer-check-v1');
  const expectedDigest = await hmacSha256(token, 'elara-bearer-check-v1');
  return constantTimeEqual(presentedDigest, expectedDigest);
}

/** Marker proving a request originated inside the Worker (cron → DO binding), not from the public internet. */
export async function internalWakeMarker(token: string): Promise<string> {
  return hmacSha256(token, INTERNAL_MARKER_MESSAGE);
}

/** Fresh nonce (crypto-quality; unguessable per-request replay protection). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
