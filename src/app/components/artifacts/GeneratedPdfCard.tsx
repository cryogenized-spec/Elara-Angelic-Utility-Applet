import { useEffect, useState } from 'react';
import type { GeneratedArtifact } from '../../../domain/artifact';
import { ArtifactStatus } from './ArtifactStatus';

export function GeneratedPdfCard({ artifact }: { artifact: GeneratedArtifact }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact.outputBlob) return undefined;
    const nextUrl = URL.createObjectURL(artifact.outputBlob);
    setUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
      setUrl(null);
    };
  }, [artifact.outputBlob]);

  return <article className="artifact-card artifact-card--generated" aria-label={`Generated PDF ${artifact.name}`}>
    <div className="artifact-card__meta">
      <strong>{artifact.name}</strong>
      <span>{formatBytes(artifact.size)} · {artifact.mimeType}</span>
      <ArtifactStatus status={artifact.status} errorMessage={artifact.errorMessage} />
      {artifact.compilationLog && <details><summary>Compilation log</summary><pre>{artifact.compilationLog}</pre></details>}
      {url && <div className="artifact-card__actions"><a href={url} download={artifact.name}>Download PDF</a></div>}
    </div>
    {url && <iframe className="artifact-card__pdf" title={`Preview of ${artifact.name}`} src={url} />}
  </article>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
