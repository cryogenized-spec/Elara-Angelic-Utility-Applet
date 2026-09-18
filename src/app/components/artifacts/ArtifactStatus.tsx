import type { ArtifactStatus as Status } from '../../../domain/artifact';

export function ArtifactStatus({ status, errorMessage }: { status: Status; errorMessage?: string }) {
  const label = status === 'processing' ? 'Processing' : status === 'pending' ? 'Preparing' : status === 'ready' ? 'Ready' : 'Failed';
  return <span className={`artifact-status artifact-status--${status}`} role={status === 'failed' ? 'alert' : 'status'} aria-live="polite">
    <span className="artifact-status__dot" aria-hidden="true" />
    <span>{label}</span>
    {status === 'failed' && errorMessage && <span className="artifact-status__detail">{errorMessage}</span>}
  </span>;
}
