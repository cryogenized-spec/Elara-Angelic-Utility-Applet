import type { NormalizedProviderError } from '../../gemini/errors';
import './generation-error.css';

function providerDetail(structured: NormalizedProviderError): string | null {
  const parts: string[] = [];
  if (structured.providerStatus !== undefined) parts.push(`provider status ${structured.providerStatus}`);
  if (structured.providerCode) parts.push(structured.providerCode);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function lockboxGuidance(structured: NormalizedProviderError): string | null {
  if (structured.code === 'GEMINI_LOCKBOX_LOCKED' || structured.category === 'configuration') {
    return 'Unlock the Lockbox to continue.';
  }
  if (structured.category === 'authentication' || structured.category === 'authorization') {
    return 'Gemini rejected the request. Check the API key in the Lockbox.';
  }
  return null;
}

export function GenerationError({
  message,
  structured,
  onRetry,
  onOpenLockbox,
}: {
  message: string;
  structured: NormalizedProviderError | null;
  onRetry: (() => void) | null;
  onOpenLockbox: (() => void) | null;
}) {
  const detail = structured ? providerDetail(structured) : null;
  const guidance = structured ? lockboxGuidance(structured) : null;
  const showActions = onRetry !== null || onOpenLockbox !== null;

  return (
    <div className="error generation-error" role="alert" data-error-code={structured?.code ?? 'UNKNOWN'}>
      <div className="generation-error__message">{message}</div>
      {(detail || guidance || structured?.retryable) && (
        <div className="generation-error__meta">
          {detail && <span className="generation-error__detail">{detail}</span>}
          {guidance && <span className="generation-error__guidance">{guidance}</span>}
          {!guidance && structured?.retryable && <span className="generation-error__guidance">You can retry this request.</span>}
        </div>
      )}
      {showActions && (
        <div className="generation-error__actions">
          {onRetry && (
            <button className="generation-error__button" type="button" onClick={onRetry}>
              Retry
            </button>
          )}
          {onOpenLockbox && (
            <button className="generation-error__button generation-error__button--primary" type="button" onClick={onOpenLockbox}>
              Open Lockbox
            </button>
          )}
        </div>
      )}
    </div>
  );
}
