import { describe, expect, it } from 'vitest';

function validateHealth(status: number, body: string, allowOrigin: string | null, expectedOrigin: string) {
  return status === 200 && body.includes('"api":true') && body.includes('"status":"healthy"') && allowOrigin === expectedOrigin;
}

describe('worker health contract', () => {
  it('accepts a healthy response for the Pages origin', () => {
    expect(validateHealth(200, '{"api":true,"status":"healthy"}', 'https://cryogenized-spec.github.io', 'https://cryogenized-spec.github.io')).toBe(true);
  });

  it('rejects a missing or mismatched CORS origin', () => {
    expect(validateHealth(200, '{"api":true,"status":"healthy"}', null, 'https://cryogenized-spec.github.io')).toBe(false);
    expect(validateHealth(200, '{"api":true,"status":"healthy"}', 'https://example.invalid', 'https://cryogenized-spec.github.io')).toBe(false);
  });
});
