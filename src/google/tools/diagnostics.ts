export type GoogleToolFailureKind =
  | 'validation'
  | 'authorization'
  | 'confirmation'
  | 'network'
  | 'rate-limit'
  | 'provider'
  | 'unknown';

export interface GoogleToolFailure {
  readonly kind: GoogleToolFailureKind;
  readonly retryable: boolean;
  readonly requiresUserAction: boolean;
  readonly message: string;
}

export function classifyGoogleToolFailure(input: { status?: number; kind?: GoogleToolFailureKind }): GoogleToolFailure {
  if (input.kind === 'validation') return { kind: 'validation', retryable: false, requiresUserAction: true, message: 'The Google operation arguments were invalid.' };
  if (input.kind === 'authorization') return { kind: 'authorization', retryable: false, requiresUserAction: true, message: 'Google authorization is required for this operation.' };
  if (input.kind === 'confirmation') return { kind: 'confirmation', retryable: false, requiresUserAction: true, message: 'User confirmation is required before this operation can run.' };
  if (input.status === 401 || input.status === 403) return { kind: 'authorization', retryable: false, requiresUserAction: true, message: 'Google authorization does not permit this operation.' };
  if (input.status === 429 || input.status === 503) return { kind: input.status === 429 ? 'rate-limit' : 'network', retryable: true, requiresUserAction: false, message: 'Google is temporarily unavailable for this operation.' };
  if (input.status && input.status >= 500) return { kind: 'provider', retryable: true, requiresUserAction: false, message: 'Google returned a temporary provider error.' };
  return { kind: input.kind ?? 'unknown', retryable: false, requiresUserAction: false, message: 'The Google operation failed.' };
}
