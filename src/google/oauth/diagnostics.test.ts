import { describe, expect, it } from 'vitest';
import { classifyGoogleOAuthFailure } from './diagnostics';

describe('Google OAuth failure diagnostics', () => {
  it('distinguishes revoked or expired grants from retryable outages', () => {
    expect(classifyGoogleOAuthFailure({ error: 'invalid_grant' }).kind).toBe('invalid-grant');
    expect(classifyGoogleOAuthFailure({ status: 503 }).retryable).toBe(true);
  });

  it('requires user action for denied consent', () => {
    const result = classifyGoogleOAuthFailure({ error: 'access_denied' });
    expect(result.requiresUserAction).toBe(true);
    expect(result.retryable).toBe(false);
  });
});
