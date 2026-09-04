import { describe, expect, it } from 'vitest';
import { classifyGoogleToolFailure } from './diagnostics';

describe('Google tool diagnostics', () => {
  it('classifies authorization failures as user-actionable', () => {
    expect(classifyGoogleToolFailure({ status: 403 })).toMatchObject({ kind: 'authorization', requiresUserAction: true, retryable: false });
  });

  it('classifies throttling as retryable without requesting consent', () => {
    expect(classifyGoogleToolFailure({ status: 429 })).toMatchObject({ kind: 'rate-limit', requiresUserAction: false, retryable: true });
  });

  it('does not expose provider error details', () => {
    const result = classifyGoogleToolFailure({ kind: 'provider' });
    expect(result.message).not.toContain('token');
    expect(result.message).not.toContain('authorization');
  });
});
