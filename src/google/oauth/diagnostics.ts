export type GoogleOAuthFailureKind =
  | 'interaction-required'
  | 'invalid-grant'
  | 'access-denied'
  | 'invalid-client'
  | 'temporarily-unavailable'
  | 'network'
  | 'unknown';

export interface GoogleOAuthFailure {
  readonly kind: GoogleOAuthFailureKind;
  readonly retryable: boolean;
  readonly requiresUserAction: boolean;
  readonly message: string;
}

export function classifyGoogleOAuthFailure(input: {
  error?: string;
  errorDescription?: string;
  status?: number;
}): GoogleOAuthFailure {
  const code = input.error?.toLowerCase();

  if (code === 'access_denied') return {
    kind: 'access-denied', retryable: false, requiresUserAction: true,
    message: 'Google authorization was denied.',
  };

  if (code === 'invalid_grant') return {
    kind: 'invalid-grant', retryable: false, requiresUserAction: true,
    message: 'Google authorization is no longer valid and must be reauthorized.',
  };

  if (code === 'invalid_client') return {
    kind: 'invalid-client', retryable: false, requiresUserAction: true,
    message: 'Google OAuth client configuration is invalid.',
  };

  if (code === 'temporarily_unavailable' || input.status === 429 || input.status === 503) return {
    kind: 'temporarily-unavailable', retryable: true, requiresUserAction: false,
    message: 'Google authorization is temporarily unavailable. Please retry.',
  };

  if (code === 'interaction_required' || input.errorDescription?.toLowerCase().includes('interaction required')) return {
    kind: 'interaction-required', retryable: false, requiresUserAction: true,
    message: 'Google requires the user to authorize again.',
  };

  if (input.status === 0) return {
    kind: 'network', retryable: true, requiresUserAction: false,
    message: 'The Google authorization request could not reach the provider.',
  };

  return {
    kind: 'unknown', retryable: false, requiresUserAction: false,
    message: 'Google authorization failed.',
  };
}
