import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, reset } from 'cloudflare:test';
import { signedWrite } from './helpers';

const ALLOWED_ORIGIN = 'https://cryogenized-spec.github.io';

describe('Google OAuth Worker boundary', () => {
  beforeEach(async () => {
    await reset();
  });

  it('exposes only the approved authenticated CORS headers', async () => {
    const response = await SELF.fetch('https://worker.example/google/oauth/token', {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    const allowedHeaders = response.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowedHeaders).toContain('Authorization');
    expect(allowedHeaders).toContain('X-Elara-Signature');
    expect(allowedHeaders).toContain('X-Requested-With');
  });

  it('rejects a disallowed browser origin before the vault is reached', async () => {
    const response = await SELF.fetch('https://worker.example/google/oauth/status', {
      headers: { Origin: 'https://evil.example', Authorization: 'Bearer anything' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects unsigned writes and admits a correctly signed write to the vault', async () => {
    const unsigned = await SELF.fetch('https://worker.example/google/oauth/token', {
      method: 'POST',
      headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(unsigned.status).toBe(401);

    const signed = await signedWrite('/google/oauth/token', '{}');
    const admitted = await SELF.fetch('https://worker.example/google/oauth/token', {
      method: 'POST',
      headers: signed.headers,
      body: '{}',
    });
    expect(admitted.status).toBe(409);
    expect(await admitted.json()).toEqual(expect.objectContaining({ code: 'not_connected' }));
  });
});
