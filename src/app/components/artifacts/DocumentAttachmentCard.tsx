import type { Attachment } from '../../../domain/artifact';
import { ArtifactStatus } from './ArtifactStatus';

export function DocumentAttachmentCard({ attachment, onRemove, onExtractText }: { attachment: Attachment; onRemove?: () => void; onExtractText?: () => void }) {
  return <article className="artifact-card artifact-card--document" aria-label={`Document attachment ${attachment.name}`}>
    <div className="artifact-card__document-icon" aria-hidden="true">{attachment.mimeType === 'application/pdf' ? 'PDF' : 'DOC'}</div>
    <div className="artifact-card__meta">
      <strong title={attachment.name}>{attachment.name}</strong>
      <span>{formatBytes(attachment.size)} · {attachment.mimeType}</span>
      <ArtifactStatus status={attachment.status} errorMessage={attachment.errorMessage} />
      <div className="artifact-card__actions">
        {onExtractText && attachment.status === 'ready' && <button type="button" onClick={onExtractText}>Extract text</button>}
        {onRemove && <button type="button" onClick={onRemove}>Remove</button>}
      </div>
    </div>
  </article>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
