// ---------------------------------------------------------------------------
// Workflow identity — Phase C0.
//
// Canonical logical identity remains routineRunKey(routineId, mode, occurrence).
// Cloudflare Workflow instance IDs are a platform representation: they must be
// a deterministic, charset-safe bijection of that key (create() IDs are ≤ 100
// characters and cannot carry colons / `#abandoned-` tombstones).
//
// Pure: browser, Worker, and tests all import this. No Cloudflare APIs.
// ---------------------------------------------------------------------------

const IDENTITY_NAMESPACE = 'elara-routine-run-v1:';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic Workflow instance id for one runKey. Prefix `rr` + SHA-256 hex
 * (66 chars, `[a-z0-9]`). The same runKey always maps to the same id so a
 * crash between SQLite claim and create() recovers onto the same instance.
 */
export async function workflowInstanceIdForRunKey(runKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${IDENTITY_NAMESPACE}${runKey}`));
  return `rr${toHex(new Uint8Array(digest))}`;
}
