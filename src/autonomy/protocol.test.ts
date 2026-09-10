import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  deriveInstallationId,
  internalWakeMarker,
  newNonce,
  signWrite,
  signedWriteMessage,
  verifyBearerToken,
  verifySignedWrite,
} from './protocol';

const TOKEN = 'installation-secret-token-for-tests';
const NOW = 1_700_000_000_000;

describe('installation identity', () => {
  it('derives a stable 32-char identity from the token (never the token itself)', async () => {
    const id = await deriveInstallationId(TOKEN);
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await deriveInstallationId(TOKEN)).toBe(id);
    expect(await deriveInstallationId('different-token')).not.toBe(id);
  });
});

describe('signed writes', () => {
  it('round-trips: a correctly signed write verifies', async () => {
    const body = JSON.stringify({ generation: 4, routines: [] });
    const timestamp = NOW;
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', timestamp, nonce, body);
    const result = await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(timestamp), nonce, signature, body }, TOKEN, NOW);
    expect(result.ok).toBe(true);
    expect(result.installationId).toBe(await deriveInstallationId(TOKEN));
  });

  it('method and path are bound into the signature (no path transplantation)', async () => {
    const body = '{}';
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, nonce, body);
    const moved = await verifySignedWrite({ method: 'POST', path: '/autonomy/context', timestamp: String(NOW), nonce, signature, body }, TOKEN, NOW);
    expect(moved).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('a tampered body fails verification', async () => {
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, nonce, '{"a":1}');
    const result = await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW), nonce, signature, body: '{"a":2}' }, TOKEN, NOW);
    expect(result).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('changing the nonce invalidates the signature', async () => {
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, nonce, '{}');
    const result = await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW), nonce: newNonce(), signature, body: '{}' }, TOKEN, NOW);
    expect(result).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('changing the timestamp invalidates the signature', async () => {
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, nonce, '{}');
    const result = await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW + 1), nonce, signature, body: '{}' }, TOKEN, NOW);
    expect(result).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('a newly generated nonce requires a newly generated signature', async () => {
    const firstNonce = newNonce();
    const secondNonce = newNonce();
    const firstSig = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, firstNonce, '{}');
    expect(await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW), nonce: secondNonce, signature: firstSig, body: '{}' }, TOKEN, NOW)).toEqual({ ok: false, code: 'bad-signature' });
    const secondSig = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, secondNonce, '{}');
    expect((await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW), nonce: secondNonce, signature: secondSig, body: '{}' }, TOKEN, NOW)).ok).toBe(true);
  });

  it('a timestamp outside the ±5-minute window is rejected before signature comparison', async () => {
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/autonomy/config', NOW - 6 * 60_000, nonce, '{}');
    const result = await verifySignedWrite({ method: 'POST', path: '/autonomy/config', timestamp: String(NOW - 6 * 60_000), nonce, signature, body: '{}' }, TOKEN, NOW);
    expect(result).toEqual({ ok: false, code: 'stale-timestamp' });
  });

  it('the canonical message format includes the nonce', () => {
    expect(signedWriteMessage('post', '/x', '123', 'nonce-1', 'body')).toBe('POST\n/x\n123\nnonce-1\nbody');
  });
});

describe('bearer verification', () => {
  it('accepts the correct token and rejects missing/wrong tokens', async () => {
    expect(await verifyBearerToken(TOKEN, TOKEN)).toBe(true);
    expect(await verifyBearerToken(null, TOKEN)).toBe(false);
    expect(await verifyBearerToken('wrong-token', TOKEN)).toBe(false);
    expect(await verifyBearerToken(`${TOKEN}x`, TOKEN)).toBe(false);
  });
});

describe('internal wake marker', () => {
  it('is stable and distinct from write signatures', async () => {
    const marker = await internalWakeMarker(TOKEN);
    expect(await internalWakeMarker(TOKEN)).toBe(marker);
    expect(marker).not.toBe(await signWrite(TOKEN, 'POST', '/autonomy/config', NOW, newNonce(), '{}'));
    expect(await internalWakeMarker('other-token')).not.toBe(marker);
  });
});

describe('nonces', () => {
  it('are unguessable and unique per call', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(seen.size).toBe(200);
  });
});

describe('constantTimeEqual', () => {
  it('compares plainly for the obvious cases', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
