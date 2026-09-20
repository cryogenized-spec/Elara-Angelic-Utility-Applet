/**
 * Narrow deterministic guard for credential-shaped material. Durable memory is
 * for personal continuity, not authentication secrets. This is deliberately
 * conservative and shared by automatic and model-initiated memory paths.
 */
export function containsCredentialMaterial(value: string): boolean {
  return /\b(?:password|passcode|pin|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b\s*(?:is|=|:)\s*\S+/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value);
}
