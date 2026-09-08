import { useEffect, useState } from 'react';
import type { Attachment } from '../../../domain/artifact';
import { ArtifactStatus } from './ArtifactStatus';

export function ImageAttachmentPreview({ attachment, onRemove, onExtractText, compact = false }: { attachment: Attachment; onRemove?: () => void; onExtractText?: () => void; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(attachment.data);
    setUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
      setUrl(null);
    };
  }, [attachment.data]);

  return <article className={`artifact-card artifact-card--image${compact ? ' artifact-card--compact' : ''}`} aria-label={`Image attachment ${attachment.name}`}>
    <div className="artifact-card__preview">
      {url ? <img src={url} alt={attachment.name} /> : <span aria-hidden="true">Image</span>}
      {onRemove && <button type="button" className="artifact-card__remove" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>×</button>}
    </div>
    <div className="artifact-card__meta">
      <strong title={attachment.name}>{attachment.name}</strong>
      <span>{formatBytes(attachment.size)} · {attachment.mimeType}</span>
      <ArtifactStatus status={attachment.status} errorMessage={attachment.errorMessage} />
      {onExtractText && attachment.status === 'ready' && <button type="button" className="artifact-card__extract" onClick={onExtractText}>Extract text</button>}
    </div>
  </article>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
